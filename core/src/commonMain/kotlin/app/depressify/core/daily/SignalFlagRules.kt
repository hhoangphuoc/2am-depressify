package app.depressify.core.daily

import app.depressify.core.model.FlagKind
import app.depressify.core.model.FlagLevel

/**
 * A flag a rule would raise, before the write rules decide whether it is new.
 *
 * [evidenceAtMillis] is the time of the newest observation the draft rests on, when that is not
 * simply today's Signals (the latest Check-in for `low_mood`): a flag of the same kind raised at or
 * after it already covered this evidence, so the draft is not raised again (see [FlagWriteRules]).
 */
data class FlagDraft(
    val level: FlagLevel,
    val kind: FlagKind,
    val reason: String,
    val evidenceAtMillis: Long? = null,
)

/**
 * The plain sentences on the phone's flags (ADR 0009): no score, no decimal number. They match the
 * seed's `REASONS` (`firebase/seed/src/flags.js`) so seeded and live flags read the same.
 */
object FlagReasons {
    const val SLEEP_FAR_BELOW_USUAL: String = "Slept far less than usual last night."
    const val INACTIVE: String = "No steps and no screen use in the last 24 hours."
    val POOR_SLEEP: String = "Slept much less than usual on each of the last ${words(DailyThresholds.POOR_SLEEP_NIGHTS)} nights."
    val LOW_MOOD: String = "Rated mood low at each of the last ${words(DailyThresholds.LOW_MOOD_CHECK_INS)} Check-ins."
    val DRIFT: String = "Several Signals have stayed below their usual range for ${words(DailyThresholds.DRIFT_DAYS)} days."

    /** "Slept under 3 hours last night." for 180 minutes; whole minutes when not a whole hour. */
    fun sleepUnder(minutes: Double): String {
        val whole = minutes.toLong()
        val amount = if (whole % 60 == 0L) "${whole / 60} hours" else "$whole minutes"
        return "Slept under $amount last night."
    }

    /** Every fixed reason, for tests. */
    val all: List<String>
        get() = listOf(sleepUnder(DailyThresholds.SLEEP_COLLAPSE_MINUTES), SLEEP_FAR_BELOW_USUAL, INACTIVE, POOR_SLEEP, LOW_MOOD, DRIFT)

    private fun words(n: Int): String =
        listOf("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten").getOrNull(n) ?: n.toString()
}

/**
 * What the Signal rules look at on one run. Series are one entry per calendar date, oldest first,
 * ending today, with null for a date that has no value or no record.
 */
data class SignalFlagInput(
    /** Last night's sleep, credited to today (the date the Patient woke). */
    val sleepMinutesToday: Double?,
    /** Oriented sleep comparisons, ending today. */
    val orientedSleep: List<Double?>,
    /** Composites, ending today. */
    val composites: List<Double?>,
    /** Steps in the last 24 hours, or null when not consented or not known. */
    val stepsLast24h: Double?,
    /** Screen-on minutes in the last 24 hours, or null when not consented or not known. */
    val screenMinutesLast24h: Double?,
    /** Mood ratings of the latest finished Check-ins, oldest first, newest last; null when unrated. */
    val recentMoods: List<Int?>,
    /** When the newest of [recentMoods] was given. */
    val newestMoodAtMillis: Long? = null,
)

/**
 * The phone's five Signal rules for the Attention flag (spec #5). Each rule is a pure function that
 * returns a draft or null. A missing value never raises a flag: every rule needs all of its inputs.
 * Thresholds are in [DailyThresholds]. Crisis, decline, unassessed and silent are raised elsewhere.
 */
object SignalFlagRules {

    /** Red: sleep under 180 minutes, or oriented sleep at or below -2.5. Only when sleep is present. */
    fun sleepCollapse(sleepMinutesToday: Double?, orientedSleepToday: Double?): FlagDraft? {
        if (sleepMinutesToday == null || !sleepMinutesToday.isFinite()) return null
        return when {
            sleepMinutesToday < DailyThresholds.SLEEP_COLLAPSE_MINUTES ->
                FlagDraft(FlagLevel.red, FlagKind.sleep_collapse, FlagReasons.sleepUnder(DailyThresholds.SLEEP_COLLAPSE_MINUTES))
            orientedSleepToday != null && orientedSleepToday <= DailyThresholds.SLEEP_COLLAPSE_ORIENTED ->
                FlagDraft(FlagLevel.red, FlagKind.sleep_collapse, FlagReasons.SLEEP_FAR_BELOW_USUAL)
            else -> null
        }
    }

    /** Red: zero steps and zero screen minutes in the last 24 hours, both present. */
    fun inactive(stepsLast24h: Double?, screenMinutesLast24h: Double?): FlagDraft? =
        if (stepsLast24h == 0.0 && screenMinutesLast24h == 0.0) {
            FlagDraft(FlagLevel.red, FlagKind.inactive, FlagReasons.INACTIVE)
        } else {
            null
        }

    /** Amber: oriented sleep at or below -1.0 on each of the last 3 nights, all present. */
    fun poorSleep(orientedSleep: List<Double?>): FlagDraft? =
        if (lastRunAtOrBelow(orientedSleep, DailyThresholds.POOR_SLEEP_NIGHTS, DailyThresholds.POOR_SLEEP_ORIENTED)) {
            FlagDraft(FlagLevel.amber, FlagKind.poor_sleep, FlagReasons.POOR_SLEEP)
        } else {
            null
        }

    /** Amber: mood 2 or lower at each of the last 3 Check-ins; a missing rating breaks the run. */
    fun lowMood(recentMoods: List<Int?>, newestAtMillis: Long?): FlagDraft? {
        val run = recentMoods.takeLast(DailyThresholds.LOW_MOOD_CHECK_INS)
        val low = run.size == DailyThresholds.LOW_MOOD_CHECK_INS &&
            run.all { it != null && it <= DailyThresholds.LOW_MOOD_AT_MOST }
        return if (low) FlagDraft(FlagLevel.amber, FlagKind.low_mood, FlagReasons.LOW_MOOD, newestAtMillis) else null
    }

    /** Amber: the composite at or below -1.0 on each of the last 3 days, all present. */
    fun drift(composites: List<Double?>): FlagDraft? =
        if (lastRunAtOrBelow(composites, DailyThresholds.DRIFT_DAYS, DailyThresholds.DRIFT_COMPOSITE)) {
            FlagDraft(FlagLevel.amber, FlagKind.drift, FlagReasons.DRIFT)
        } else {
            null
        }

    /** Every rule, red ones first, in a fixed order. */
    fun evaluate(input: SignalFlagInput): List<FlagDraft> = listOfNotNull(
        sleepCollapse(input.sleepMinutesToday, input.orientedSleep.lastOrNull()),
        inactive(input.stepsLast24h, input.screenMinutesLast24h),
        poorSleep(input.orientedSleep),
        lowMood(input.recentMoods, input.newestMoodAtMillis),
        drift(input.composites),
    )

    private fun lastRunAtOrBelow(series: List<Double?>, days: Int, threshold: Double): Boolean {
        val run = series.takeLast(days)
        return run.size == days && run.all { it != null && it <= threshold }
    }
}
