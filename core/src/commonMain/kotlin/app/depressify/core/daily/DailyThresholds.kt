package app.depressify.core.daily

/**
 * Every threshold of the phone's Signal rules for the Attention flag, in one place (spec #5,
 * "Attention flag"). Values marked STARTING VALUE are the spec's starred values: starting points to
 * tune on the Demo Patients, not settled clinical cut-offs. The seed places its flags with the same
 * values (`THRESHOLDS` in `firebase/seed/src/flags.js`); change both together.
 */
object DailyThresholds {
    /** STARTING VALUE. Red `sleep_collapse` when last night's sleep is under this many minutes. */
    const val SLEEP_COLLAPSE_MINUTES: Double = 180.0

    /** STARTING VALUE. Red `sleep_collapse` when oriented sleep is at or below this. */
    const val SLEEP_COLLAPSE_ORIENTED: Double = -2.5

    /** STARTING VALUE. Amber `poor_sleep` when oriented sleep is at or below this on each night. */
    const val POOR_SLEEP_ORIENTED: Double = -1.0

    /** Amber `poor_sleep` needs this many nights in a row, all present. */
    const val POOR_SLEEP_NIGHTS: Int = 3

    /** Amber `low_mood` when each of the last Check-ins rated mood at or below this. */
    const val LOW_MOOD_AT_MOST: Int = 2

    /** Amber `low_mood` looks at this many of the latest finished Check-ins, none missing. */
    const val LOW_MOOD_CHECK_INS: Int = 3

    /** STARTING VALUE. Amber `drift` when the composite is at or below this on each day. */
    const val DRIFT_COMPOSITE: Double = -1.0

    /** STARTING VALUE. Amber `drift` needs this many days in a row. */
    const val DRIFT_DAYS: Int = 3

    /**
     * How many previous daily records the job needs: the Baseline window for the earliest day of the
     * longest run. Fewer still work; the earlier days then simply have no comparison.
     */
    val HISTORY_DAYS_NEEDED: Int = SignalBaseline.WINDOW_DAYS + maxOf(POOR_SLEEP_NIGHTS, DRIFT_DAYS) - 1
}
