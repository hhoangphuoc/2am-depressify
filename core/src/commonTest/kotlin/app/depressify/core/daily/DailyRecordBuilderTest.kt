package app.depressify.core.daily

import app.depressify.core.daily.DailyTestData.TODAY
import app.depressify.core.daily.DailyTestData.previousDays
import app.depressify.core.model.FirestoreJson
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Signal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DailyRecordBuilderTest {

    private val history = previousDays().map(DayValues::of)

    @Test
    fun everySignalIsWrittenWithNullForMissingNeverZero() {
        val values = DailyRecordBuilder.values(
            readings = mapOf(Signal.SLEEP_MINUTES to 400.0, Signal.STEPS to null, Signal.HRV to Double.NaN),
            consented = Signal.entries.toSet(),
        )
        assertEquals(Signal.entries.toSet(), values.keys)
        assertEquals(400.0, values[Signal.SLEEP_MINUTES])
        assertNull(values[Signal.STEPS])
        assertNull(values[Signal.HRV])
        assertNull(values[Signal.RESTING_HEART_RATE])

        val doc = DailyRecordBuilder.build(TODAY, values, history, sharedWithClinician = true)
        assertEquals(Signal.entries.map { it.key }.toSet(), doc.values.keys)
        assertEquals(Signal.entries.map { it.key }.toSet(), doc.vsBaseline.keys)
        assertTrue(doc.values.filterKeys { it != "sleepMinutes" }.values.all { it == null })

        // The nulls survive serialisation: they are written explicitly, never dropped or zeroed.
        val fields = FirestoreJson.encode(DailyDoc.serializer(), doc)
        val stored = fields["values"] as Map<*, *>
        assertTrue(stored.containsKey("steps"))
        assertNull(stored["steps"])
        assertTrue(fields.containsKey("composite"))
    }

    @Test
    fun aRealZeroStaysZero() {
        val values = DailyRecordBuilder.values(mapOf(Signal.STEPS to 0.0), Signal.entries.toSet())
        assertEquals(0.0, values[Signal.STEPS])
    }

    @Test
    fun aSignalWithoutConsentIsNull() {
        val values = DailyRecordBuilder.values(
            readings = mapOf(Signal.SLEEP_MINUTES to 400.0, Signal.STEPS to 5000.0),
            consented = setOf(Signal.STEPS),
        )
        assertNull(values[Signal.SLEEP_MINUTES])
        assertEquals(5000.0, values[Signal.STEPS])
    }

    @Test
    fun comparisonsAndCompositeComeFromTheBaseline() {
        val values = DailyRecordBuilder.values(mapOf(Signal.SLEEP_MINUTES to 378.0, Signal.STEPS to 6000.0), Signal.entries.toSet())
        val doc = DailyRecordBuilder.build(TODAY, values, history, sharedWithClinician = false, demoOverride = true)
        val sleep = doc.vsBaseline["sleepMinutes"]!!
        assertTrue(sleep < -1.9 && sleep > -2.1, "sleep $sleep")
        val steps = doc.vsBaseline["steps"]!!
        assertEquals((sleep + steps) / 2, doc.composite!!, 1e-9)
        assertNull(doc.vsBaseline["hrv"])
        assertEquals(false, doc.sharedWithClinician)
        assertEquals(true, doc.demoOverride)
        assertEquals(TODAY, doc.date)
    }

    @Test
    fun aShortHistoryGivesNoComparisonAndNoComposite() {
        val values = DailyRecordBuilder.values(mapOf(Signal.SLEEP_MINUTES to 100.0), Signal.entries.toSet())
        val doc = DailyRecordBuilder.build(TODAY, values, history.takeLast(4), sharedWithClinician = true)
        assertNull(doc.vsBaseline["sleepMinutes"])
        assertNull(doc.composite)
    }
}
