package app.depressify.core

/** A kind of Signal the Patient can consent to separately (system design, "Signals"). */
enum class SignalId(val label: String, val source: String, val unit: String) {
    Sleep("Sleep", "Health Connect", "h"),
    Steps("Steps", "Health Connect", "steps"),
    HeartRate("Heart rate", "Health Connect", "bpm"),
    RestingHeartRate("Resting heart rate", "Health Connect", "bpm"),
    Hrv("Heart rate variability", "Health Connect", "ms"),
    TimeAtHome("Time at home", "Location on this phone", "h"),
    MovementRadius("Movement radius", "Location on this phone", "km"),
    Calendar("Calendar free time", "Your calendar", "h"),
    LateScreen("Late-night screen time", "Usage access", "min"),
    Ratings("Mood, energy and sleep ratings", "Your Check-ins", ""),
    VoiceObservations("Voice observations", "Your Check-ins", ""),
}

/** What a Signal shows today. Missing data is its own state and is never shown as zero. */
sealed interface SignalReading {
    data object NotCollected : SignalReading
    data object NoDataYet : SignalReading
    data object Unavailable : SignalReading
    data class Value(val amount: Double) : SignalReading
}

/** Baseline is the median of the Patient's own previous 14 days, once at least 5 days are valid. */
object Baseline {
    const val WINDOW_DAYS = 14
    const val MIN_VALID_DAYS = 5

    sealed interface Result {
        data class Building(val validDays: Int) : Result
        data class Ready(val median: Double, val validDays: Int) : Result
    }

    fun of(previousDays: List<Double?>): Result {
        val valid = previousDays.takeLast(WINDOW_DAYS).filterNotNull().sorted()
        if (valid.size < MIN_VALID_DAYS) return Result.Building(valid.size)
        val mid = valid.size / 2
        val median = if (valid.size % 2 == 1) valid[mid] else (valid[mid - 1] + valid[mid]) / 2
        return Result.Ready(median, valid.size)
    }
}
