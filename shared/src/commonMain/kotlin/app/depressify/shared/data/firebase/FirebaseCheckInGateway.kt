package app.depressify.shared.data.firebase

import app.depressify.core.model.Collections
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Flag
import app.depressify.core.model.Suggestion
import app.depressify.core.model.Summary
import app.depressify.core.model.VoiceCue
import app.depressify.shared.data.CheckInDraft
import app.depressify.shared.data.CheckInGateway
import app.depressify.shared.data.LiveStart
import app.depressify.shared.data.MusicClip
import app.depressify.shared.data.NearbyPlace
import app.depressify.shared.data.PatientLocation
import app.depressify.shared.data.Weather
import app.depressify.shared.data.TodaySuggestions
import dev.gitlive.firebase.firestore.Direction
import dev.gitlive.firebase.firestore.FirebaseFirestore
import dev.gitlive.firebase.functions.FirebaseFunctions
import kotlinx.serialization.Serializable
import kotlin.io.encoding.Base64
import kotlin.time.Duration.Companion.seconds

/**
 * Start and Finish Check-in through the callables (the contract is in the README, "Check-in"),
 * and the Patient's records through Firestore (GitLive SDK).
 */
class FirebaseCheckInGateway(private val db: FirebaseFirestore, private val functions: FirebaseFunctions) : CheckInGateway {
    @Serializable
    private data class StartRequest(val patientId: String, val brief: String, val mode: String)

    @Serializable
    private data class StartResponse(val checkInId: String, val token: String, val model: String, val endpoint: String)

    @Serializable
    private data class Turn(val speaker: String, val text: String)

    @Serializable
    private data class DraftSuggestion(val id: String, val kind: String, val details: String, val status: String)

    @Serializable
    private data class Draft(val turns: List<Turn>, val voiceCues: List<VoiceCue>, val suggestions: List<DraftSuggestion>, val crisis: Boolean)

    @Serializable
    private data class FinishRequest(val patientId: String, val checkInId: String, val draft: Draft)

    @Serializable
    private data class FinishResponse(val checkInId: String, val summary: Summary, val minimal: Boolean = false)

    @Serializable
    private data class MapRequest(val patientId: String, val tool: String, val latitude: Double, val longitude: Double, val query: String? = null)

    @Serializable
    private data class PlacesResponse(val places: List<NearbyPlace>)

    @Serializable
    private data class WeatherResponse(val weather: Weather)

    @Serializable
    private data class SuggestRequest(val patientId: String)

    @Serializable
    private data class MusicRequest(val patientId: String, val mood: String)

    @Serializable
    private data class MusicResponse(val mimeType: String, val audioBase64: String)

    private fun patient(patientId: String) = db.collection(Collections.PATIENTS).document(patientId)

    override suspend fun startCheckIn(patientId: String, brief: String, typed: Boolean): LiveStart {
        val response = functions.httpsCallable("startCheckIn")
            .invoke(StartRequest.serializer(), StartRequest(patientId, brief, if (typed) "typed" else "spoken"))
            .data(StartResponse.serializer())
        return LiveStart(response.checkInId, response.token, response.model, response.endpoint)
    }

    override suspend fun finishCheckIn(patientId: String, checkInId: String, draft: CheckInDraft): Summary {
        val request = FinishRequest(
            patientId,
            checkInId,
            Draft(
                turns = draft.turns.map { Turn(if (it.fromPatient) "patient" else "companion", it.text) },
                voiceCues = emptyList(),
                suggestions = draft.suggestions.map { DraftSuggestion(it.id, it.kind.name, it.details, it.status.name) },
                crisis = draft.crisis,
            ),
        )
        return functions.httpsCallable("finishCheckIn").invoke(FinishRequest.serializer(), request) { encodeDefaults = true }
            .data(FinishResponse.serializer()).summary
    }

    private suspend fun mapTool(patientId: String, tool: String, near: PatientLocation, query: String? = null) =
        functions.httpsCallable("mapTool").invoke(MapRequest.serializer(), MapRequest(patientId, tool, near.latitude, near.longitude, query))

    override suspend fun findPlaces(patientId: String, query: String, near: PatientLocation): List<NearbyPlace> =
        mapTool(patientId, "find_places", near, query).data(PlacesResponse.serializer()).places

    override suspend fun weather(patientId: String, near: PatientLocation): Weather =
        mapTool(patientId, "get_weather", near).data(WeatherResponse.serializer()).weather

    override suspend fun generateMusic(patientId: String, mood: String): MusicClip {
        // Generation takes about 25 s; the SDK's default call timeout is close to that.
        val response = functions.httpsCallable("generateMusic", timeout = 120.seconds)
            .invoke(MusicRequest.serializer(), MusicRequest(patientId, mood))
            .data(MusicResponse.serializer())
        return MusicClip(response.mimeType, Base64.decode(response.audioBase64))
    }

    override suspend fun recentDays(patientId: String, count: Int): List<DailyDoc> =
        patient(patientId).collection(Collections.DAILY).orderBy("date", Direction.DESCENDING).limit(count).get()
            .documents.map { it.data(DailyDoc.serializer()) }

    override suspend fun recentSummaries(patientId: String, count: Int): List<Summary> =
        patient(patientId).collection(Collections.SUMMARIES).orderBy("createdAtMillis", Direction.DESCENDING).limit(count).get()
            .documents.map { it.data(Summary.serializer()) }

    override suspend fun lastSuggestion(patientId: String): Suggestion? =
        patient(patientId).collection(Collections.SUGGESTIONS).orderBy("suggestedAtMillis", Direction.DESCENDING).limit(1).get()
            .documents.firstOrNull()?.data(Suggestion.serializer())

    override suspend fun saveSuggestion(patientId: String, suggestion: Suggestion) {
        patient(patientId).collection(Collections.SUGGESTIONS).document(suggestion.id)
            .set(Suggestion.serializer(), suggestion) { encodeDefaults = true }
    }

    override suspend fun raiseFlag(patientId: String, flagId: String, flag: Flag) {
        patient(patientId).collection(Collections.FLAGS).document(flagId).set(Flag.serializer(), flag) { encodeDefaults = true }
    }

    override suspend fun suggestToday(patientId: String): TodaySuggestions =
        functions.httpsCallable("suggestToday").invoke(SuggestRequest.serializer(), SuggestRequest(patientId)).data(TodaySuggestions.serializer())
}
