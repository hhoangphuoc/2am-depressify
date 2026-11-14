package app.depressify.core.daily

import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Signal
import app.depressify.core.model.SignalDirection
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt
import kotlinx.datetime.LocalDate
import kotlinx.datetime.daysUntil

/** One day's Signal values, by calendar date (`yyyy-MM-dd`). A missing value is null. */
data class DayValues(val date: String, val values: Map<Signal, Double?>) {
    companion object {
        /** The values of a stored daily record. */
        fun of(doc: DailyDoc): DayValues = DayValues(doc.date, Signal.entries.associateWith { doc.values[it.key] })
    }
}

/**
 * The contract's comparison with Baseline (`docs/firestore-schema.md`, "Baseline"), pinned by the
 * shared fixture `fixtures/baseline/baseline-cases.json` (checked by `BaselineFixtureTest`, and by
 * the seed and dashboard tests through `firebase/hosting/js/lib/baseline.js`):
 *
 * - the window is the 14 calendar dates strictly before the day, counting only dates with a value;
 * - fewer than 5 such dates, or no value on the day, gives no comparison (null, never zero);
 * - the centre is the median, the spread `max(sample SD (n - 1), 0.05 x |median|, 0.001)`;
 * - the comparison keeps the sign as measured; [oriented] flips lower-is-better Signals so that
 *   negative always means worse, and is null for Signals with no direction;
 * - the composite is the mean of the oriented comparisons that exist.
 *
 * The screens' older `app.depressify.core.Baseline` (median only, counted in records, no spread
 * floor) is left in place for `CoreRulesTest`; the two should become one (#16).
 */
object SignalBaseline {
    const val WINDOW_DAYS: Int = 14
    const val MIN_VALID_DAYS: Int = 5
    const val SPREAD_FLOOR_FRACTION: Double = 0.05
    const val SPREAD_FLOOR_ABSOLUTE: Double = 0.001

    /** One Signal's value on a date. */
    data class Reading(val date: String, val value: Double?)

    /** A Signal's Baseline on a date: the median, the spread used (with its floor), and how many days. */
    data class Centre(val median: Double, val spread: Double, val validDays: Int)

    /** The valid values on the 14 calendar dates strictly before [date]. Other dates are ignored. */
    fun baselineValues(history: List<Reading>, date: String): List<Double> {
        val today = LocalDate.parse(date)
        return history.mapNotNull { reading ->
            val value = reading.value?.takeIf { it.isFinite() } ?: return@mapNotNull null
            val day = parseOrNull(reading.date) ?: return@mapNotNull null
            val age = day.daysUntil(today)
            if (age in 1..WINDOW_DAYS) value else null
        }
    }

    /** The Baseline for one Signal on [date], or null with fewer than [MIN_VALID_DAYS] valid days. */
    fun baselineFor(history: List<Reading>, date: String): Centre? {
        val valid = baselineValues(history, date)
        if (valid.size < MIN_VALID_DAYS) return null
        val median = median(valid)
        val spread = max(max(sampleSd(valid), SPREAD_FLOOR_FRACTION * abs(median)), SPREAD_FLOOR_ABSOLUTE)
        return Centre(median, spread, valid.size)
    }

    /** Today's distance from Baseline in units of the spread, sign as measured; null when there is none. */
    fun compare(history: List<Reading>, today: Reading): Double? {
        val value = today.value?.takeIf { it.isFinite() } ?: return null
        val baseline = baselineFor(history, today.date) ?: return null
        return (value - baseline.median) / baseline.spread
    }

    /** The comparison oriented so that negative means worse; null for no direction or no comparison. */
    fun oriented(signal: Signal, comparison: Double?): Double? = when {
        comparison == null -> null
        signal.direction == SignalDirection.none -> null
        signal.direction == SignalDirection.lower_is_better -> -comparison
        else -> comparison
    }

    /** Mean of the oriented comparisons that exist; null if there are none. Missing values are skipped. */
    fun composite(vsBaseline: Map<Signal, Double?>): Double? {
        val oriented = Signal.entries.mapNotNull { oriented(it, vsBaseline[it]) }
        return if (oriented.isEmpty()) null else oriented.sum() / oriented.size
    }

    /** Every Signal's comparison for [today] against [history] (other days; any order). */
    fun comparisons(history: List<DayValues>, today: DayValues): Map<Signal, Double?> =
        Signal.entries.associateWith { signal ->
            compare(history.map { Reading(it.date, it.values[signal]) }, Reading(today.date, today.values[signal]))
        }

    private fun parseOrNull(date: String): LocalDate? = try {
        LocalDate.parse(date)
    } catch (_: IllegalArgumentException) {
        null
    }

    private fun median(values: List<Double>): Double {
        val sorted = values.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[mid] else (sorted[mid - 1] + sorted[mid]) / 2
    }

    /** Sample standard deviation (n - 1); 0 for a single value. */
    private fun sampleSd(values: List<Double>): Double {
        if (values.size < 2) return 0.0
        val mean = values.sum() / values.size
        return sqrt(values.sumOf { (it - mean) * (it - mean) } / (values.size - 1))
    }
}
