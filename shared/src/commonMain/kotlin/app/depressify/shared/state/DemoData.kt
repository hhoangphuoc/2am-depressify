package app.depressify.shared.state

import app.depressify.core.Outcome
import app.depressify.core.Ratings
import app.depressify.core.SignalId
import app.depressify.core.SignalReading
import app.depressify.core.Summary
import app.depressify.core.SuggestionKind

/** Synthetic, local demo data. No real Patient, Clinician or service is involved. */
object DemoData {
    const val PatientName = "Alex"
    const val ClinicianName = "Dr. Leena Aalto"
    const val TodayShort = "Fri 13 Nov"

    val consents: Map<SignalId, Boolean> = SignalId.entries.associateWith {
        it !in setOf(SignalId.HeartRate, SignalId.Hrv, SignalId.TimeAtHome, SignalId.MovementRadius, SignalId.LateScreen)
    }

    val readings: Map<SignalId, String> = mapOf(
        SignalId.Sleep to "7 h 10 min last night",
        SignalId.Steps to "4,820 steps today",
        SignalId.RestingHeartRate to "61 bpm this morning",
        SignalId.Calendar to "2 free hours today",
        SignalId.Ratings to "Last rated yesterday",
        SignalId.VoiceObservations to "Noted in your Summaries",
    )

    val details: Map<SignalId, String> = mapOf(
        SignalId.Sleep to "Sleep duration, not a sleep score. Daily totals are shared.",
        SignalId.Steps to "Daily steps help the Companion notice quieter days.",
        SignalId.HeartRate to "Average heart rate across the day.",
        SignalId.RestingHeartRate to "Resting heart rate, compared with your own usual.",
        SignalId.Hrv to "Heart rate variability, where your watch provides it.",
        SignalId.TimeAtHome to "Hours at home. Your exact location stays on this phone.",
        SignalId.MovementRadius to "How far you moved from home. Places are never shared.",
        SignalId.Calendar to "Free time only, so a Suggestion fits your day.",
        SignalId.LateScreen to "Minutes of screen use after 23:00. Optional and off by default.",
        SignalId.Ratings to "Your 1 to 5 mood, energy and sleep ratings.",
        SignalId.VoiceObservations to "Things the Companion noticed in your voice, as observations only.",
    )

    fun reading(id: SignalId, consented: Boolean, scenario: Scenario): SignalReading = when {
        !consented -> SignalReading.NotCollected
        id == SignalId.LateScreen -> SignalReading.Unavailable
        scenario == Scenario.BaselineBuilding -> SignalReading.NoDataYet
        else -> SignalReading.Value(0.0)
    }

    const val SharedSummary = "You felt a little low on energy. A short walk felt manageable. You chose ten minutes outside tomorrow."

    val history = listOf(
        Summary("s12", "12 November", "A little time outside", SharedSummary, Ratings(3, 2, 3), SuggestionKind.Walk, Outcome.Tried(3), "Long pauses"),
        Summary("s10", "10 November", "A little music", "A slow morning. One favourite song felt like enough for the evening.", Ratings(2, 2, null), SuggestionKind.Music, Outcome.NotThisTime, null),
        Summary("s08", "8 November", "A call to someone close", "You mentioned missing a friend. You chose to call them on Sunday.", Ratings(3, 3, 4), SuggestionKind.Call, null, "Gentle pace"),
        Summary("s07", "7 November", "A slow start", "You talked about a tired week. You chose some music for the evening.", Ratings(3, 3, 3), SuggestionKind.Music, null, null),
    )

    /** The seven days ending today. A day is done once a Check-in exists for it; other days are simply not done. */
    fun week(history: List<Summary>): List<WeekDay> =
        listOf("S" to "7", "S" to "8", "M" to "9", "T" to "10", "W" to "11", "T" to "12", "F" to "13")
            .map { (letter, day) -> WeekDay(letter, day, done = history.any { it.date == "$day November" }, today = day == "13") }

    /** Synthetic places near the demo location; x and y place each pin on the map image as fractions. */
    val places = listOf(
        Place("Park", "Töölönlahti Park", "9 min walk", 0.37f, 0.24f, "https://www.google.com/maps/search/?api=1&query=T%C3%B6%C3%B6l%C3%B6nlahti+park+Helsinki"),
        Place("Yoga", "Quiet Room Yoga", "12 min walk · demo place", 0.76f, 0.36f, "https://www.google.com/maps/search/?api=1&query=yoga+near+T%C3%B6%C3%B6l%C3%B6nlahti+Helsinki"),
        Place("Meditation", "Still Point Meditation", "15 min walk · demo place", 0.66f, 0.76f, "https://www.google.com/maps/search/?api=1&query=meditation+near+T%C3%B6%C3%B6l%C3%B6nlahti+Helsinki"),
    )
}

data class WeekDay(val letter: String, val day: String, val done: Boolean, val today: Boolean = false)

data class Place(val kind: String, val name: String, val detail: String, val x: Float, val y: Float, val mapsUrl: String)
