package app.depressify.core.nudge

import app.depressify.core.LocalMinutes
import app.depressify.core.QuietHours
import kotlinx.datetime.TimeZone

/** Quiet hours as the Patient record stores them: `quietHoursStart` and `quietHoursEnd`, whole hours 0..23. */
data class ContractQuietHours(val startHour: Int, val endHour: Int)

/** Why quiet hours were rejected. */
enum class QuietHoursProblem {
    /** Start and end are the same time, which is no window at all. */
    SameStartAndEnd,

    /** A time is not on the hour; the Patient record stores whole hours only. */
    NotOnTheHour,
}

sealed interface QuietHoursCheck {
    data class Valid(val quietHours: QuietHours) : QuietHoursCheck

    data class Invalid(val problem: QuietHoursProblem) : QuietHoursCheck
}

/**
 * Rules for the Patient's quiet hours, on top of [QuietHours] and [LocalMinutes] in `Schedule.kt`.
 * The screen edits [LocalMinutes]; the Patient record stores whole hours ([ContractQuietHours]).
 */
object QuietHoursRules {
    private const val MINUTES_PER_HOUR = 60

    /** Accepts any two different whole-hour times, including an overnight range such as 21:00 to 09:00. */
    fun validate(start: LocalMinutes, end: LocalMinutes): QuietHoursCheck = when {
        !QuietHours(start, end).isValid -> QuietHoursCheck.Invalid(QuietHoursProblem.SameStartAndEnd)
        start.value % MINUTES_PER_HOUR != 0 || end.value % MINUTES_PER_HOUR != 0 ->
            QuietHoursCheck.Invalid(QuietHoursProblem.NotOnTheHour)
        else -> QuietHoursCheck.Valid(QuietHours(start, end))
    }

    /**
     * Reads `quietHoursStart` and `quietHoursEnd` from the Patient record. Hours outside 0..23 or
     * identical endpoints can't be quiet hours, so they give [QuietHours.Default] (21:00 to 09:00, the
     * record's own defaults).
     */
    fun fromContract(stored: ContractQuietHours): QuietHours {
        if (stored.startHour !in 0..23 || stored.endHour !in 0..23) return QuietHours.Default
        return QuietHours(LocalMinutes(stored.startHour * MINUTES_PER_HOUR), LocalMinutes(stored.endHour * MINUTES_PER_HOUR))
            .takeIf { it.isValid } ?: QuietHours.Default
    }

    /** The values to write to the Patient record, or null when [quietHours] doesn't pass [validate]. */
    fun toContract(quietHours: QuietHours): ContractQuietHours? =
        when (validate(quietHours.start, quietHours.end)) {
            is QuietHoursCheck.Invalid -> null
            is QuietHoursCheck.Valid -> ContractQuietHours(
                startHour = quietHours.start.value / MINUTES_PER_HOUR,
                endHour = quietHours.end.value / MINUTES_PER_HOUR,
            )
        }

    /** For the screen, with the time zone the times are in: `21:00–09:00 (Europe/Helsinki)`. */
    fun display(quietHours: QuietHours, zone: TimeZone): String =
        "${quietHours.start.label()}–${quietHours.end.label()} (${zone.id})"
}
