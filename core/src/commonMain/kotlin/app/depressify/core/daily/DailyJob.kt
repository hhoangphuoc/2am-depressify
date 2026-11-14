package app.depressify.core.daily

import app.depressify.core.model.CheckIn
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.DateKeys
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.Signal
import app.depressify.core.model.sharingStamp
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus

/**
 * Everything one run of the daily job decides from, as plain values. The app reads these (Health
 * Connect, usage statistics, Firestore) and passes them in; the pipeline does no I/O and reads no
 * clock.
 */
data class DailyJobInputs(
    /** Today's date key (`yyyy-MM-dd`, device time zone; `DateKeys.today`). */
    val date: String,
    /** The run's time: the new flags' `raisedAtMillis` and the sign of life. */
    val nowMillis: Long,
    /** The Patient record, read fresh (ideally in the write transaction). */
    val patient: PatientDoc,
    /** The Signals the Patient has consented to (`consents/{signalKey}` granted). Others are null. */
    val consentedSignals: Set<Signal>,
    /** Today's readings. Absent or null means no value: never pass zero for "no data". */
    val readings: Map<Signal, Double?>,
    /** Steps in the last 24 hours (for `inactive`), or null when unknown. Needs Steps consent. */
    val stepsLast24h: Double?,
    /** Screen-on minutes in the last 24 hours (for `inactive`), or null when unknown. Needs the usage consent (`lateNightScreenMinutes`). */
    val screenMinutesLast24h: Double?,
    /** Earlier daily records, any order; at least [DailyThresholds.HISTORY_DAYS_NEEDED] days back. Records on or after [date] are ignored. */
    val previousDays: List<DailyDoc>,
    /** Today's record if an earlier run (or a demo control) already wrote it. */
    val existingToday: DailyDoc? = null,
    /** The Patient's recent Check-ins, any order. Only finished ones (`endedAtMillis` set, not after now) count. */
    val checkIns: List<CheckIn>,
    /** The Patient's flags with their ids: at least the uncleared ones and any raised today. */
    val flags: List<StoredFlag>,
    /** Demo control values that replace today's readings (and skip Consent); marks the record `demoOverride`. */
    val demoOverrides: Map<Signal, Double?> = emptyMap(),
)

/** What one run writes. Nothing here is ever shown to the Patient. */
data class DailyJobResult(
    /** `patients/{id}/daily/{date}`: write it whole (set), keeping the stamp it carries. */
    val daily: DailyDoc,
    /** Flags to create at `patients/{id}/flags/{id}`; uncleared and stamped. Create, never overwrite. */
    val newFlags: List<StoredFlag>,
    /** The record's new `flagLevel` and `flagReasons`, or null to leave them alone. */
    val attention: AttentionUpdate?,
    /** The record's new `lastSeenAtMillis` (the sign of life). */
    val lastSeenAtMillis: Long,
    /** Every flag the rules found today, new or not (for the debug action). */
    val drafts: List<FlagDraft>,
    /** The drafts not written, and why (for the debug action and logs; carries no health data in the reason code). */
    val skipped: List<SkippedDraft>,
)

/**
 * The phone's daily job as one pure pipeline (#26): today's record from the consented Signals with
 * nulls for missing ones, the comparison with Baseline and the composite, the sign of life, the five
 * Signal rules for the Attention flag, and the write plan under the three write rules.
 *
 * The app's part (not here): the periodic work about every six hours and the debug action, reading
 * the inputs, and writing the result: the daily record, the new flags, and the record's
 * `lastSeenAtMillis` with `flagLevel` / `flagReasons` (when [DailyJobResult.attention] is set),
 * ideally in one transaction with the Patient record and flags read inside it.
 *
 * Not here, by decision: `objectiveChange` and `outcomeScore` on Suggestions are function-only and
 * written by Finish Check-in (#21, PR #65), not by this job.
 */
object DailyJob {

    fun run(inputs: DailyJobInputs): DailyJobResult {
        require(DateKeys.isDateKey(inputs.date)) { "date must be yyyy-MM-dd" }
        val date = inputs.date
        val existing = inputs.existingToday?.takeIf { it.date == date }

        // Today's values. A demo record stays a demo record: a later device run does not overwrite it.
        val demoOverride = inputs.demoOverrides.isNotEmpty() || existing?.demoOverride == true
        val values: Map<Signal, Double?> = when {
            inputs.demoOverrides.isNotEmpty() -> {
                val base = if (existing?.demoOverride == true) DayValues.of(existing).values
                else DailyRecordBuilder.values(inputs.readings, inputs.consentedSignals)
                base + inputs.demoOverrides
            }
            existing?.demoOverride == true -> DayValues.of(existing).values
            else -> DailyRecordBuilder.values(inputs.readings, inputs.consentedSignals)
        }

        // A record rewritten later in the day keeps the stamp it was created with.
        val stamp = existing?.sharedWithClinician ?: inputs.patient.sharingStamp()
        val previous = inputs.previousDays.filter { it.date < date }.distinctBy { it.date }.map(DayValues::of)
        val daily = DailyRecordBuilder.build(date, values, previous, stamp, demoOverride)

        // One entry per calendar date, oldest first, ending today; a date without a record is null.
        val runDays = maxOf(DailyThresholds.POOR_SLEEP_NIGHTS, DailyThresholds.DRIFT_DAYS)
        val today = LocalDate.parse(date)
        val byDate = previous.associateBy { it.date }
        val orientedSleep = mutableListOf<Double?>()
        val composites = mutableListOf<Double?>()
        for (ago in runDays - 1 downTo 0) {
            if (ago == 0) {
                orientedSleep += SignalBaseline.oriented(Signal.SLEEP_MINUTES, daily.vsBaseline[Signal.SLEEP_MINUTES.key])
                composites += daily.composite
            } else {
                val day = byDate[today.minus(ago, DateTimeUnit.DAY).toString()]
                val vs = day?.let { SignalBaseline.comparisons(previous, it) }
                orientedSleep += SignalBaseline.oriented(Signal.SLEEP_MINUTES, vs?.get(Signal.SLEEP_MINUTES))
                composites += vs?.let(SignalBaseline::composite)
            }
        }

        val finished = inputs.checkIns
            .filter { it.endedAtMillis != null && it.endedAtMillis <= inputs.nowMillis }
            .sortedBy { it.endedAtMillis }
            .takeLast(DailyThresholds.LOW_MOOD_CHECK_INS)

        val drafts = SignalFlagRules.evaluate(
            SignalFlagInput(
                sleepMinutesToday = daily.values[Signal.SLEEP_MINUTES.key],
                orientedSleep = orientedSleep,
                composites = composites,
                stepsLast24h = inputs.stepsLast24h?.takeIf { Signal.STEPS in inputs.consentedSignals },
                screenMinutesLast24h = inputs.screenMinutesLast24h?.takeIf { Signal.LATE_NIGHT_SCREEN_MINUTES in inputs.consentedSignals },
                recentMoods = finished.map { it.mood },
                newestMoodAtMillis = finished.lastOrNull()?.endedAtMillis,
            ),
        )
        val plan = FlagWriteRules.plan(drafts, inputs.flags, inputs.patient, date, inputs.nowMillis)

        return DailyJobResult(
            daily = daily,
            newFlags = plan.newFlags,
            attention = plan.attention,
            lastSeenAtMillis = FlagWriteRules.signOfLife(inputs.patient.lastSeenAtMillis, inputs.nowMillis),
            drafts = drafts,
            skipped = plan.skipped,
        )
    }
}
