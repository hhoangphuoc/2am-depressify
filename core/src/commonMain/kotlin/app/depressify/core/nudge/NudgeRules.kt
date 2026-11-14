package app.depressify.core.nudge

import app.depressify.core.LocalMinutes
import app.depressify.core.QuietHours
import app.depressify.core.daily.SignalBaseline
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Signal
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.daysUntil
import kotlinx.datetime.minus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

// The Nudge rules (spec #5, "Nudges"; issue #27). Pure: the daily job on the phone gathers the
// inputs, calls NudgeDecision.decide, posts the local notification for a Nudge, and records the
// time it posted so the next run that day gives no Nudge.

/**
 * Every threshold and time the Nudge rules use. **All are starting values**, to tune on the Demo
 * Patients (the spec stars them).
 */
object NudgeThresholds {
    /** A night is rough when its oriented sleep comparison with Baseline is at or below this (spec: "at or below minus 1"). */
    const val ROUGH_NIGHT_SLEEP_AT_OR_BELOW: Double = -1.0

    /**
     * Time at home or late-night screen time is "more than usual" when its comparison with Baseline is
     * above this (implementation plan, Task 5: "above 1*"). The comparison keeps the sign as measured,
     * so positive means more than usual.
     */
    const val MORE_THAN_USUAL_ABOVE: Double = 1.0

    /** The evening invitation goes out from this local time when there has been no Check-in today (spec: 17:00*). */
    val EVENING_FROM: LocalMinutes = LocalMinutes(17 * 60)

    /** The "free hour": the app reads the calendar from now for this many minutes. */
    const val FREE_WINDOW_MINUTES: Int = 60

    /**
     * A daily record dated more than this many days before today is stale and never used as evidence.
     * At 1, the two nights are last night (today's record) and the night before (yesterday's).
     */
    const val STALE_AFTER_DAYS: Int = 1
}

/** What the calendar shows for the coming window ([NudgeThresholds.FREE_WINDOW_MINUTES] from now). */
enum class CalendarAvailability {
    Busy,
    Free,

    /** Not read: calendar sensing is off, the read failed, or there is no reading. Never treated as free. */
    Unknown,
    ;

    companion object {
        /**
         * Classifies Google Calendar free/busy intervals for the window from [now]. Null [busy] means the
         * calendar could not be read, which is [Unknown]. An interval that only touches the window's edge
         * does not count.
         */
        fun forWindow(
            busy: List<OpenEndRange<Instant>>?,
            now: Instant,
        ): CalendarAvailability {
            if (busy == null) return Unknown
            val end = now + NudgeThresholds.FREE_WINDOW_MINUTES.minutes
            return if (busy.any { it.start < end && it.endExclusive > now }) Busy else Free
        }
    }
}

/** The weather for the coming window, as the Map tool judges it for a walk. */
enum class WeatherOutlook {
    Good,
    Bad,

    /** Not read, or the read failed. Never treated as good. */
    Unknown,
}

/** Why a Nudge goes out. The order of the entries is the order the rules are tried; the first that applies wins. */
enum class NudgeReason {
    /** Both of the last two nights rough, with more time at home or more late-night screen time than usual. */
    RoughNights,

    /** A free hour ahead and weather known to be good. */
    FreeHourGoodWeather,

    /** No Check-in yet today, and it is [NudgeThresholds.EVENING_FROM] or later. */
    NoCheckInByEvening,
}

/** Why no Nudge goes out, in the order the checks run. */
enum class NoNudgeReason {
    /** The Patient switched Nudges off (or the notification permission is denied). */
    NudgesOff,

    /** A Nudge was already sent today (local date). */
    AlreadySentToday,

    /** Now is inside the Patient's quiet hours. */
    QuietHours,

    /** The calendar shows the Patient busy in the coming window. */
    CalendarBusy,

    /** None of the reasons applies. */
    NothingApplies,
}

sealed interface NudgeOutcome {
    data class None(val why: NoNudgeReason) : NudgeOutcome

    data class Nudge(val reason: NudgeReason) : NudgeOutcome
}

/**
 * Everything the Nudge rules need, gathered by the app's daily job.
 *
 * @property now when the job runs.
 * @property timeZone the Patient's (device) time zone; Europe/Helsinki in the demo. "Today", quiet hours
 *   and 17:00 are all local.
 * @property nudgesEnabled the Patient's own choice for Nudges, and false when the notification permission
 *   is denied or revoked.
 * @property lastNudgeAt when the app last posted a Nudge, or null if never. Kept on the phone.
 * @property quietHours the Patient's quiet hours. Invalid ones (identical endpoints) count as the default.
 * @property recentDays the latest daily records with their stored `vsBaseline` comparisons, in any order.
 *   A few days is enough; the rules use at most the last two.
 * @property lastCheckInAt the end of the last Check-in, or null if none (`PatientDoc.lastCheckInAtMillis`).
 * @property calendar the calendar for the coming window; see [CalendarAvailability.forWindow].
 * @property weather the weather for the coming window.
 */
data class NudgeInput(
    val now: Instant,
    val timeZone: TimeZone,
    val nudgesEnabled: Boolean,
    val lastNudgeAt: Instant?,
    val quietHours: QuietHours,
    val recentDays: List<DailyDoc>,
    val lastCheckInAt: Instant?,
    val calendar: CalendarAvailability,
    val weather: WeatherOutlook,
)

object NudgeDecision {

    /**
     * Decides whether to post a Nudge now and why. At most one a day: once the app records the time it
     * posted, every later run on the same local date gives [NoNudgeReason.AlreadySentToday].
     */
    fun decide(input: NudgeInput): NudgeOutcome {
        val local = input.now.toLocalDateTime(input.timeZone)
        val today = local.date
        val time = LocalMinutes(local.hour * 60 + local.minute)
        val quietHours = if (input.quietHours.isValid) input.quietHours else QuietHours.Default

        val suppressed = when {
            !input.nudgesEnabled -> NoNudgeReason.NudgesOff
            input.lastNudgeAt != null && input.lastNudgeAt.localDate(input.timeZone) >= today -> NoNudgeReason.AlreadySentToday
            quietHours.contains(time) -> NoNudgeReason.QuietHours
            input.calendar == CalendarAvailability.Busy -> NoNudgeReason.CalendarBusy
            else -> null
        }
        if (suppressed != null) return NudgeOutcome.None(suppressed)

        val reason = when {
            roughNights(input.recentDays, today) -> NudgeReason.RoughNights
            input.calendar == CalendarAvailability.Free && input.weather == WeatherOutlook.Good -> NudgeReason.FreeHourGoodWeather
            time.value >= NudgeThresholds.EVENING_FROM.value &&
                (input.lastCheckInAt == null || input.lastCheckInAt.localDate(input.timeZone) < today) -> NudgeReason.NoCheckInByEvening
            else -> null
        }
        return if (reason != null) NudgeOutcome.Nudge(reason) else NudgeOutcome.None(NoNudgeReason.NothingApplies)
    }

    /**
     * The last two nights are the newest daily record that is not dated in the future, and the record for
     * the day before it. Both records must be there, both no older than [NudgeThresholds.STALE_AFTER_DAYS], both with an
     * oriented sleep comparison at or below [NudgeThresholds.ROUGH_NIGHT_SLEEP_AT_OR_BELOW]; and on either
     * of those two days, time at home or late-night screen time must be above
     * [NudgeThresholds.MORE_THAN_USUAL_ABOVE]. A missing value never counts.
     */
    private fun roughNights(days: List<DailyDoc>, today: LocalDate): Boolean {
        val byDate = days
            .mapNotNull { doc -> runCatching { LocalDate.parse(doc.date) }.getOrNull()?.let { it to doc } }
            .filter { (date, _) -> date <= today }
            .toMap()
        val lastNight = byDate.keys.maxOrNull() ?: return false
        val nightBefore = lastNight.minus(1, DateTimeUnit.DAY)
        if (nightBefore.daysUntil(today) > NudgeThresholds.STALE_AFTER_DAYS) return false
        val nights = listOf(nightBefore, lastNight).map { byDate[it] ?: return false }
        val bothRough = nights.all { night ->
            val sleep = SignalBaseline.oriented(Signal.SLEEP_MINUTES, night.vsBaseline[Signal.SLEEP_MINUTES.key])
            sleep != null && sleep <= NudgeThresholds.ROUGH_NIGHT_SLEEP_AT_OR_BELOW
        }
        val moreThanUsual = nights.any { day ->
            listOf(Signal.TIME_AT_HOME_MINUTES, Signal.LATE_NIGHT_SCREEN_MINUTES).any { signal ->
                val more = day.vsBaseline[signal.key]
                more != null && more > NudgeThresholds.MORE_THAN_USUAL_ABOVE
            }
        }
        return bothRough && moreThanUsual
    }

    private fun Instant.localDate(zone: TimeZone): LocalDate = toLocalDateTime(zone).date
}
