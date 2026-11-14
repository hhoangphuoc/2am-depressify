package app.depressify.shared.data

import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Flag
import app.depressify.core.model.Suggestion
import app.depressify.core.model.Summary

/** The token and model for one Gemini Live connection, from the Start Check-in function. */
data class LiveStart(val token: String, val model: String)

/** What a Check-in needs from the backend: the Live token, and the Patient's records the Companion's tools read and write. */
interface CheckInGateway {
    /** Asks Start Check-in for a single-use Live token. The Gemini key never reaches the phone. */
    suspend fun startCheckIn(patientId: String): LiveStart

    /** The most recent daily records, newest first. */
    suspend fun recentDays(patientId: String, count: Int): List<DailyDoc>

    /** The most recent Summaries, newest first. */
    suspend fun recentSummaries(patientId: String, count: Int): List<Summary>

    suspend fun lastSuggestion(patientId: String): Suggestion?

    suspend fun saveSuggestion(patientId: String, suggestion: Suggestion)

    suspend fun raiseFlag(patientId: String, flagId: String, flag: Flag)
}
