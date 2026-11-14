package app.depressify.shared.voice.live

import app.depressify.core.model.Flag
import app.depressify.core.model.FlagKind
import app.depressify.core.model.FlagLevel
import app.depressify.core.model.Signal
import app.depressify.core.model.Suggestion
import app.depressify.core.model.SuggestionKind
import app.depressify.core.model.sharingStamp
import app.depressify.shared.data.CheckInGateway
import app.depressify.shared.data.MusicClip
import app.depressify.shared.data.NearbyPlace
import app.depressify.shared.data.PatientLocation
import app.depressify.shared.data.PatientStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/** Actionable results a tool call puts on the Check-in screen; context lookups stay with Gemini. */
sealed interface ToolCard {
    /** Music being made for [mood]: [clip] once ready, or [failed]. Held in memory only. */
    data class Music(val mood: String, val clip: MusicClip? = null, val failed: Boolean = false) : ToolCard

    /** A kind of place to go; [url] opens the search in Google Maps. [places] are the results found, shown and never stored. */
    data class Places(val query: String, val url: String, val places: List<NearbyPlace> = emptyList()) : ToolCard

    /** The weather near the Patient in one line, with its Google source. */
    data class Weather(val line: String, val sourceTitle: String, val sourceUrl: String) : ToolCard
}

/** What a tool call changes on screen. Called on the session's coroutine. */
interface ToolEffects {
    fun show(card: ToolCard)
    fun offer(suggestion: Suggestion)
    fun wrapUp()
    fun crisis()
}

/**
 * Runs the Companion's tools on the phone, where the Patient's data already is. The names and
 * arguments mirror COMPANION_TOOLS in firebase/functions/src/checkIn.ts, which locks them into the
 * Live token. Never throws: the model gets a named error and the Check-in goes on.
 */
class CompanionTools(
    private val patients: PatientStore,
    private val checkIns: CheckInGateway,
    private val patientId: String,
    private val nowMillis: () -> Long,
    private val effects: ToolEffects,
    /** Runs the music generation after the tool has answered; cancelled with the Check-in. */
    private val scope: CoroutineScope,
    private val location: PatientLocation = PatientLocation.Sample,
) {
    suspend fun dispatch(name: String, args: JsonObject): JsonObject = try {
        when (name) {
            "get_patient_context" -> patientContext()
            "get_health_summary" -> healthSummary(args.int("days")?.coerceIn(1, 14) ?: 7)
            "get_recent_summaries" -> recentSummaries(args.int("count")?.coerceIn(1, 5) ?: 3)
            "get_last_suggestion" -> lastSuggestion()
            "record_suggestion" -> recordSuggestion(args.string("kind"), args.string("details"))
            // "query" is the argument of the earlier declaration, still locked into tokens minted before it changed.
            "suggest_music" -> makeMusic(args.string("mood") ?: args.string("query"))
            "find_places" -> findPlaces(args.string("query"))
            "get_weather" -> weather()
            "wrap_up" -> ok().also { effects.wrapUp() }
            "raise_crisis" -> raiseCrisis()
            else -> error("unknown_tool")
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        error("backend_failed")
    }

    private suspend fun patientContext(): JsonObject {
        val patient = patients.get(patientId)
        return buildJsonObject {
            put("background", patient?.intakeHighlights?.ifBlank { null } ?: "none yet")
            put("first_check_in", patient?.lastCheckInAtMillis == null && checkIns.recentSummaries(patientId, 1).isEmpty())
            patient?.tmsEndDate?.let { put("treatment_course_ended_on", it) }
            put("currently_near", location.label)
        }
    }

    private suspend fun healthSummary(days: Int): JsonObject {
        val records = checkIns.recentDays(patientId, days)
        // The comparison with the Patient's own Baseline, in words. Missing days are missing, never zero.
        val lines = Signal.entries.mapNotNull { signal ->
            val compared = records.mapNotNull { it.vsBaseline[signal.key] }
            if (compared.isEmpty()) return@mapNotNull null
            val mean = compared.average()
            SIGNAL_LABELS.getValue(signal) + ": " + when { mean <= -1 -> "lower than usual"; mean >= 1 -> "higher than usual"; else -> "about the same as usual" }
        }
        if (lines.isEmpty()) return buildJsonObject { put("status", "no_data"); put("days_with_records", records.size) }
        return buildJsonObject {
            put("days_with_records", records.size)
            put("compared_with_their_own_usual", buildJsonArray { lines.forEach { add(JsonPrimitive(it)) } })
        }
    }

    private suspend fun recentSummaries(count: Int): JsonObject {
        val summaries = checkIns.recentSummaries(patientId, count)
        if (summaries.isEmpty()) return buildJsonObject { put("status", "no_check_ins_yet") }
        return buildJsonObject {
            put("summaries", buildJsonArray {
                summaries.forEach { s ->
                    add(buildJsonObject {
                        s.mood?.let { put("mood_1_to_5", it) }
                        s.energy?.let { put("energy_1_to_5", it) }
                        s.sleepQuality?.let { put("sleep_quality_1_to_5", it) }
                        put("sleep", s.sleepLine)
                        put("themes", s.themes.joinToString(", "))
                        s.suggestion?.let { put("suggestion", it) }
                        s.previousOutcome?.let { put("previous_outcome", it) }
                    })
                }
            })
        }
    }

    private suspend fun lastSuggestion(): JsonObject {
        val s = checkIns.lastSuggestion(patientId) ?: return buildJsonObject { put("status", "none_yet") }
        return buildJsonObject {
            put("kind", s.kind.name)
            put("details", s.details)
            put("status", s.status.name)
            s.tried?.let { put("tried", it) }
            s.felt?.let { put("felt_1_to_5", it) }
        }
    }

    private suspend fun recordSuggestion(kindName: String?, details: String?): JsonObject {
        val kind = SuggestionKind.entries.firstOrNull { it.name == kindName }
        if (kind == null || details.isNullOrBlank()) return error("invalid_args")
        val patient = patients.get(patientId) ?: return error("backend_failed")
        val now = nowMillis()
        val suggestion = Suggestion(id = "s" + now, kind = kind, details = details.trim(), suggestedAtMillis = now, sharedWithClinician = patient.sharingStamp())
        // On screen first: the card does not wait for the write.
        effects.offer(suggestion)
        checkIns.saveSuggestion(patientId, suggestion)
        return ok()
    }

    /** Answers at once and makes the music in the background, so the conversation does not wait. */
    private fun makeMusic(mood: String?): JsonObject {
        if (mood.isNullOrBlank()) return error("invalid_args")
        val m = mood.trim()
        effects.show(ToolCard.Music(m))
        scope.launch {
            val clip = try {
                checkIns.generateMusic(patientId, m)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
            effects.show(ToolCard.Music(m, clip, failed = clip == null))
        }
        return buildJsonObject {
            put("ok", true)
            put("status", "being_made")
            put("shown", "a card that gets a play button in about half a minute")
        }
    }

    private suspend fun findPlaces(query: String?): JsonObject {
        if (query.isNullOrBlank()) return error("invalid_args")
        val q = query.trim()
        // A failed lookup still leaves the card that opens the search, and the Check-in goes on.
        val places = try {
            checkIns.findPlaces(patientId, q, location)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
        effects.show(ToolCard.Places(q, "https://www.google.com/maps/search/?api=1&query=" + q.encode(), places.orEmpty()))
        return buildJsonObject {
            when {
                places == null -> put("error", "lookup_failed")
                places.isEmpty() -> put("status", "none_found")
                else -> {
                    put("near", location.label)
                    put("places_from_google_maps", buildJsonArray {
                        places.forEach { p ->
                            add(buildJsonObject {
                                put("name", p.name)
                                if (p.walkMinutes != null) put("minutes_on_foot", p.walkMinutes) else put("straight_line_distance", distanceLabel(p.distanceMeters))
                            })
                        }
                    })
                }
            }
            put("shown", "a card with links that open in Google Maps")
        }
    }

    /** A failed lookup throws, and dispatch answers the model with a named error. */
    private suspend fun weather(): JsonObject {
        val w = checkIns.weather(patientId, location)
        effects.show(ToolCard.Weather(w.conditions + ", " + w.temperatureC + " °C, feels like " + w.feelsLikeC + " °C", w.sourceTitle, w.sourceUrl))
        return buildJsonObject {
            put("near", location.label)
            put("conditions", w.conditions)
            put("temperature_c", w.temperatureC)
            put("feels_like_c", w.feelsLikeC)
            put("chance_of_precipitation_percent", w.precipitationPercent)
            put("wind_kmh", w.windKmh)
            put("good_for_a_walk", w.goodForAWalk)
        }
    }

    private suspend fun raiseCrisis(): JsonObject {
        // The Crisis notice first, before any network call.
        effects.crisis()
        try {
            val now = nowMillis()
            patients.get(patientId)?.let { patient ->
                checkIns.raiseFlag(
                    patientId,
                    "crisis-" + now,
                    Flag(FlagLevel.red, FlagKind.crisis, "The Companion heard signs of a crisis in a Check-in.", now, sharedWithClinician = patient.sharingStamp()),
                )
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // shortcut: a flag that fails to save is dropped while the notice stays up; queue and retry it with the daily job (#22).
        }
        return buildJsonObject { put("ok", true); put("crisis_notice_shown", true) }
    }

    private fun ok() = buildJsonObject { put("ok", true) }
    private fun error(code: String) = buildJsonObject { put("error", code) }
    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

    companion object {
        /** "350 m" or "1.2 km". */
        fun distanceLabel(meters: Int): String =
            if (meters < 1000) meters.toString() + " m" else (meters / 1000).toString() + "." + (meters % 1000 / 100) + " km"

        /** A short line for the screen while a tool runs. */
        fun label(name: String): String = when (name) {
            "get_patient_context" -> "Remembering your background"
            "get_health_summary" -> "Looking at your recent days"
            "get_recent_summaries" -> "Reading your last Check-ins"
            "get_last_suggestion" -> "Recalling your last Suggestion"
            "record_suggestion" -> "Noting a Suggestion"
            "suggest_music" -> "Starting some music for you"
            "find_places" -> "Looking for a place nearby"
            "get_weather" -> "Checking the weather"
            else -> "One moment"
        }

        private val SIGNAL_LABELS = mapOf(
            Signal.SLEEP_MINUTES to "Sleep",
            Signal.STEPS to "Steps",
            Signal.MEAN_HEART_RATE to "Heart rate",
            Signal.RESTING_HEART_RATE to "Resting heart rate",
            Signal.HRV to "Heart rate variability",
            Signal.TIME_AT_HOME_MINUTES to "Time at home",
            Signal.MOVEMENT_RADIUS_KM to "How far you moved",
            Signal.CALENDAR_BUSY_MINUTES to "Busy time in your calendar",
            Signal.LATE_NIGHT_SCREEN_MINUTES to "Late-night screen time",
        )
    }
}

/** A link that opens a search for [query] in the Patient's own music app or browser. */
fun musicSearchUrl(query: String): String = "https://music.youtube.com/search?q=" + query.encode()

/** A link that opens a search for [query] in Google Maps. */
fun mapsSearchUrl(query: String): String = "https://www.google.com/maps/search/?api=1&query=" + query.encode()

/** Percent-encodes everything but ASCII letters, digits and -_.~, for a search link. */
private fun String.encode(): String = encodeToByteArray().joinToString("") { b ->
    val c = b.toInt().toChar()
    if (b >= 0 && (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c in "-_.~")) c.toString()
    else "%" + (b.toInt() and 0xFF).toString(16).uppercase().padStart(2, '0')
}
