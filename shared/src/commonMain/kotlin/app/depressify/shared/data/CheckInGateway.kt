package app.depressify.shared.data

import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Flag
import app.depressify.core.model.Suggestion
import app.depressify.core.model.Summary

/** One started Check-in: its id, and the single-use token, model and endpoint for the Gemini Live connection. */
data class LiveStart(val checkInId: String, val token: String, val model: String, val endpoint: String)

/** One thing said in a Check-in, kept in memory until Finish Check-in (ADR 0006). */
data class DraftTurn(val fromPatient: Boolean, val text: String)

/** What the phone hands Finish Check-in: the conversation, the Suggestions made and whether a crisis was raised. */
data class CheckInDraft(val turns: List<DraftTurn>, val suggestions: List<Suggestion>, val crisis: Boolean)

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

    /** The most recent daily records, newest first. */
    suspend fun recentDays(patientId: String, count: Int): List<DailyDoc>

    /** The most recent Summaries, newest first. */
    suspend fun recentSummaries(patientId: String, count: Int): List<Summary>

    suspend fun lastSuggestion(patientId: String): Suggestion?

    suspend fun saveSuggestion(patientId: String, suggestion: Suggestion)

    suspend fun raiseFlag(patientId: String, flagId: String, flag: Flag)
}
