package app.depressify.core.daily

import app.depressify.core.model.Signal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SignalBaselineTest {

    private fun r(date: String, value: Double?) = SignalBaseline.Reading(date, value)

    private val fiveDays = listOf(
        r("2026-11-09", 420.0), r("2026-11-10", 420.0), r("2026-11-11", 420.0),
        r("2026-11-12", 420.0), r("2026-11-13", 420.0),
    )

    @Test
    fun constantHistoryUsesTheSpreadFloor() {
        // Five days of 420, today 399: spread floor 0.05 x 420 = 21, so (399 - 420) / 21 = -1.
        assertEquals(-1.0, SignalBaseline.compare(fiveDays, r("2026-11-14", 399.0))!!, 1e-9)
    }

    @Test
    fun fewerThanFiveValidDaysGivesNoComparison() {
        assertNull(SignalBaseline.compare(fiveDays.drop(1), r("2026-11-14", 399.0)))
        assertNull(SignalBaseline.compare(fiveDays.drop(1) + r("2026-11-08", null), r("2026-11-14", 399.0)))
    }

    @Test
    fun aMissingTodayGivesNoComparisonNeverZero() {
        assertNull(SignalBaseline.compare(fiveDays, r("2026-11-14", null)))
        assertNull(SignalBaseline.compare(fiveDays, r("2026-11-14", Double.NaN)))
    }

    @Test
    fun onlyTheFourteenCalendarDatesStrictlyBeforeTodayCount() {
        val old = listOf(r("2026-10-30", 1.0), r("2026-10-29", 1.0), r("2026-10-28", 1.0))
        val todaysOwn = r("2026-11-14", 1.0)
        val later = r("2026-11-15", 1.0)
        val history = fiveDays + old + todaysOwn + later
        assertEquals(-1.0, SignalBaseline.compare(history, r("2026-11-14", 399.0))!!, 1e-9)
        // 2026-10-31 is exactly 14 days before: it counts.
        assertEquals(6, SignalBaseline.baselineFor(fiveDays + r("2026-10-31", 420.0), "2026-11-14")!!.validDays)
    }

    @Test
    fun orientedFlipsLowerIsBetterAndDropsNoDirection() {
        assertEquals(-1.5, SignalBaseline.oriented(Signal.SLEEP_MINUTES, -1.5))
        assertEquals(-2.0, SignalBaseline.oriented(Signal.RESTING_HEART_RATE, 2.0))
        assertEquals(1.0, SignalBaseline.oriented(Signal.LATE_NIGHT_SCREEN_MINUTES, -1.0))
        assertNull(SignalBaseline.oriented(Signal.MEAN_HEART_RATE, 3.0))
        assertNull(SignalBaseline.oriented(Signal.CALENDAR_BUSY_MINUTES, 3.0))
        assertNull(SignalBaseline.oriented(Signal.STEPS, null))
    }

    @Test
    fun compositeIsTheMeanOfOrientedComparisonsAndIgnoresMissingValues() {
        val vs = mapOf(
            Signal.SLEEP_MINUTES to -1.0,
            Signal.STEPS to -2.0,
            Signal.MEAN_HEART_RATE to 5.0,
            Signal.RESTING_HEART_RATE to 1.0,
            Signal.HRV to null,
            Signal.CALENDAR_BUSY_MINUTES to -4.0,
        )
        assertEquals(-4.0 / 3.0, SignalBaseline.composite(vs)!!, 1e-9)
        assertNull(SignalBaseline.composite(mapOf(Signal.MEAN_HEART_RATE to 1.0, Signal.SLEEP_MINUTES to null)))
        assertNull(SignalBaseline.composite(emptyMap()))
    }

    @Test
    fun comparisonsCoverEverySignalWithNullsForMissingOnes() {
        val history = (9..13).map { d -> DayValues("2026-11-${d.toString().padStart(2, '0')}", mapOf(Signal.SLEEP_MINUTES to 420.0, Signal.STEPS to null)) }
        val today = DayValues("2026-11-14", mapOf(Signal.SLEEP_MINUTES to 399.0, Signal.STEPS to 4000.0))
        val vs = SignalBaseline.comparisons(history, today)
        assertEquals(Signal.entries.toSet(), vs.keys)
        assertEquals(-1.0, vs[Signal.SLEEP_MINUTES]!!, 1e-9)
        assertNull(vs[Signal.STEPS])
        assertNull(vs[Signal.HRV])
    }
}
