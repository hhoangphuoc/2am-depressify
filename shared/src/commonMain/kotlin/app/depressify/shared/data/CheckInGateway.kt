package app.depressify.shared.data

import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Flag
import app.depressify.core.model.Suggestion
import app.depressify.core.model.Summary
import kotlinx.serialization.Serializable

/** One started Check-in: its id, and the single-use token, model and endpoint for the Gemini Live connection. */
data class LiveStart(val checkInId: String, val token: String, val model: String, val endpoint: String)

/** One thing said in a Check-in, kept in memory until Finish Check-in (ADR 0006). */
data class DraftTurn(val fromPatient: Boolean, val text: String)

/** What the phone hands Finish Check-in: the conversation, the Suggestions made and whether a crisis was raised. */
data class CheckInDraft(val turns: List<DraftTurn>, val suggestions: List<Suggestion>, val crisis: Boolean)

/** Where the Patient is, for a place lookup. Sent only with that lookup and never stored. */
data class PatientLocation(val label: String, val latitude: Double, val longitude: Double) {
    companion object {
        // shortcut: every Patient is at the Junction venue (Dipoli, Aalto University); replace with the phone's last known location once location Consent and sampling exist (#18).
        val Sample = PatientLocation("Otaniemi, Espoo", 60.1850, 24.8324)
    }
}

/** One Google Maps result near the Patient. [distanceMeters] is a straight line; [walkMinutes] is on foot, when known. */
@Serializable
data class NearbyPlace(val name: String, val mapsUrl: String, val distanceMeters: Int, val walkMinutes: Int? = null)

/** The current weather near the Patient, with its Google source to show beside it. */
@Serializable
data class Weather(
    val conditions: String,
    val temperatureC: Int,
    val feelsLikeC: Int,
    val precipitationPercent: Int,
    val windKmh: Int,
    val goodForAWalk: Boolean,
    val sourceTitle: String,
    val sourceUrl: String,
)

/** About a minute of generated music, held in memory only and never saved. */
class MusicClip(val mimeType: String, val bytes: ByteArray)

/** What a Check-in needs from the backend: the Live token, and the Patient's records the Companion's tools read and write. */
interface CheckInGateway {
    /**
     * Asks Start Check-in for a single-use Live token locked to [brief] plus the server's safety
     * rules and tools. The Gemini key never reaches the phone.
     */
    suspend fun startCheckIn(patientId: String, brief: String, typed: Boolean): LiveStart

    /**
     * Hands the draft to Finish Check-in, which writes the Summary and drops the transcript. A retry
     * with the same [checkInId] overwrites the same Summary.
     */
    suspend fun finishCheckIn(patientId: String, checkInId: String, draft: CheckInDraft): Summary

    /** Up to five real places matching [query] near [near], nearest first. The Maps key never reaches the phone. */
    suspend fun findPlaces(patientId: String, query: String, near: PatientLocation): List<NearbyPlace>

    /** The current weather at [near]. */
    suspend fun weather(patientId: String, near: PatientLocation): Weather

    /** About a minute of calm instrumental music matched to [mood], from Lyria. Takes about half a minute. */
    suspend fun generateMusic(patientId: String, mood: String): MusicClip

    /** The most recent daily records, newest first. */
    suspend fun recentDays(patientId: String, count: Int): List<DailyDoc>

    /** The most recent Summaries, newest first. */
    suspend fun recentSummaries(patientId: String, count: Int): List<Summary>

    suspend fun lastSuggestion(patientId: String): Suggestion?

    suspend fun saveSuggestion(patientId: String, suggestion: Suggestion)

    suspend fun raiseFlag(patientId: String, flagId: String, flag: Flag)
}
