package app.depressify.core

/** Minutes after midnight, local time. */
data class LocalMinutes(val value: Int) {
    init { require(value in 0 until 24 * 60) }
    fun plus(minutes: Int) = LocalMinutes(((value + minutes) % (24 * 60) + 24 * 60) % (24 * 60))
    fun label(): String = (value / 60).toString().padStart(2, '0') + ":" + (value % 60).toString().padStart(2, '0')
}

/** No Nudges between start and end. Overnight ranges are allowed; equal endpoints are not. */
data class QuietHours(val start: LocalMinutes, val end: LocalMinutes) {
    val isValid get() = start != end
    fun contains(time: LocalMinutes): Boolean =
        if (start.value < end.value) time.value >= start.value && time.value < end.value
        else time.value >= start.value || time.value < end.value

    companion object {
        val Default = QuietHours(LocalMinutes(21 * 60), LocalMinutes(9 * 60))
    }
}

/** A calendar plan the Patient agrees to. Durations are the three the design offers. */
data class BookingPlan(val dayLabel: String, val time: LocalMinutes, val durationMinutes: Int) {
    init { require(durationMinutes in AllowedDurations) }
    companion object {
        val AllowedDurations = listOf(10, 15, 20)
    }
}

/** Night theme runs from 22:00 to 05:00 local time. */
fun isNightHour(hour: Int): Boolean = hour >= 22 || hour < 5

fun greetingFor(hour: Int, name: String): String = when {
    isNightHour(hour) -> "Still up, $name?"
    hour < 11 -> "Good morning, $name"
    hour < 17 -> "Hi, $name"
    else -> "Good evening, $name"
}
