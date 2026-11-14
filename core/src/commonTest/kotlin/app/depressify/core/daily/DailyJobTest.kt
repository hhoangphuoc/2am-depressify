package app.depressify.core.daily

import app.depressify.core.daily.DailyTestData.NOW
import app.depressify.core.daily.DailyTestData.TODAY
import app.depressify.core.daily.DailyTestData.patient
import app.depressify.core.daily.DailyTestData.previousDays
import app.depressify.core.model.CheckIn
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.FlagKind
import app.depressify.core.model.FlagLevel
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import app.depressify.core.model.Signal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The whole decision, end to end, from plain inputs. */
class DailyJobTest {

    private val usualToday = mapOf(Signal.SLEEP_MINUTES to 420.0, Signal.STEPS to 6000.0)

    private fun inputs(
        readings: Map<Signal, Double?> = usualToday,
        previous: List<DailyDoc> = previousDays(),
        patient: PatientDoc = patient(),
        consented: Set<Signal> = Signal.entries.toSet(),
        steps24h: Double? = 6000.0,
        screen24h: Double? = 120.0,
        checkIns: List<CheckIn> = emptyList(),
        flags: List<StoredFlag> = emptyList(),
        existingToday: DailyDoc? = null,
        demoOverrides: Map<Signal, Double?> = emptyMap(),
    ) = DailyJobInputs(
        date = TODAY,
        nowMillis = NOW,
        patient = patient,
        consentedSignals = consented,
        readings = readings,
        stepsLast24h = steps24h,
        screenMinutesLast24h = screen24h,
        previousDays = previous,
        existingToday = existingToday,
        checkIns = checkIns,
        flags = flags,
        demoOverrides = demoOverrides,
    )

    private fun DailyJobResult.kinds() = newFlags.map { it.flag.kind }

    @Test
    fun anOrdinaryDayWritesTheRecordAndTheSignOfLifeAndRaisesNothing() {
        val result = DailyJob.run(inputs(patient = patient(lastSeen = NOW - 60_000)))
        assertEquals(TODAY, result.daily.date)
        assertEquals(420.0, result.daily.values["sleepMinutes"])
        assertNull(result.daily.values["hrv"])
        assertTrue(result.daily.vsBaseline.containsKey("hrv"))
        assertEquals(true, result.daily.sharedWithClinician)
        assertEquals(false, result.daily.demoOverride)
        assertEquals(NOW, result.lastSeenAtMillis)
        assertEquals(emptyList(), result.newFlags)
        assertNull(result.attention)
    }

    @Test
    fun aMissingNightIsNullAndNeverRaisesAFlag() {
        val rough = previousDays { ago, v -> if (ago <= 2) v[Signal.SLEEP_MINUTES] = 385.0 }
        val result = DailyJob.run(inputs(readings = mapOf(Signal.SLEEP_MINUTES to null, Signal.STEPS to 6000.0), previous = rough))
        assertNull(result.daily.values["sleepMinutes"])
        assertNull(result.daily.vsBaseline["sleepMinutes"])
        assertEquals(emptyList(), result.newFlags)

        // A night with no record at all (yesterday missing) breaks the run too.
        val gap = rough.filter { it.date != DailyTestData.dateAgo(1) }
        assertEquals(emptyList(), DailyJob.run(inputs(readings = mapOf(Signal.SLEEP_MINUTES to 385.0), previous = gap)).newFlags)
    }

    // ---- demo cases ----------------------------------------------------------------------

    @Test
    fun threeRoughNightsTurnAmber() {
        val twoRough = previousDays { ago, v -> if (ago <= 2) v[Signal.SLEEP_MINUTES] = 385.0 }
        val result = DailyJob.run(inputs(readings = mapOf(Signal.SLEEP_MINUTES to 385.0, Signal.STEPS to 6000.0), previous = twoRough))
        assertEquals(listOf(FlagKind.poor_sleep), result.kinds())
        val flag = result.newFlags.single()
        assertEquals("poor_sleep-$TODAY", flag.id)
        assertEquals(FlagLevel.amber, flag.flag.level)
        assertEquals(null, flag.flag.clearedAtMillis)
        assertEquals(true, flag.flag.sharedWithClinician)
        assertEquals(NOW, flag.flag.raisedAtMillis)
        assertEquals(AttentionUpdate(FlagLevel.amber, listOf(FlagReasons.POOR_SLEEP)), result.attention)
    }

    @Test
    fun twoRoughNightsAloneAreNotYetAFlag() {
        // Poor sleep needs three nights; two are the Nudge's "rough nights" (#27), not a flag.
        val oneRough = previousDays { ago, v -> if (ago == 1) v[Signal.SLEEP_MINUTES] = 385.0 }
        val result = DailyJob.run(inputs(readings = mapOf(Signal.SLEEP_MINUTES to 385.0, Signal.STEPS to 6000.0), previous = oneRough))
        assertEquals(emptyList(), result.newFlags)
    }

    @Test
    fun roughNightsAfterAnAlreadyPoorNightTurnAmber() {
        // The demo's "two rough nights" give amber when the night before was already poor.
        val poorThenRough = previousDays { ago, v -> if (ago <= 2) v[Signal.SLEEP_MINUTES] = if (ago == 2) 395.0 else 380.0 }
        val result = DailyJob.run(inputs(readings = mapOf(Signal.SLEEP_MINUTES to 380.0, Signal.STEPS to 6000.0), previous = poorThenRough))
        assertEquals(listOf(FlagKind.poor_sleep), result.kinds())
    }

    @Test
    fun aForcedCollapseTurnsRed() {
        val result = DailyJob.run(inputs(demoOverrides = mapOf(Signal.SLEEP_MINUTES to 120.0)))
        assertEquals(120.0, result.daily.values["sleepMinutes"])
        assertEquals(true, result.daily.demoOverride)
        assertEquals(listOf(FlagKind.sleep_collapse), result.kinds())
        assertEquals(FlagLevel.red, result.newFlags.single().flag.level)
        assertEquals(AttentionUpdate(FlagLevel.red, listOf("Slept under 3 hours last night.")), result.attention)
    }

    @Test
    fun aLaterRunKeepsTheDemoRecord() {
        val forced = DailyJob.run(inputs(demoOverrides = mapOf(Signal.SLEEP_MINUTES to 120.0)))
        val later = DailyJob.run(
            inputs(
                existingToday = forced.daily,
                flags = forced.newFlags,
                patient = patient(level = FlagLevel.red, reasons = forced.attention!!.flagReasons),
            ),
        )
        assertEquals(120.0, later.daily.values["sleepMinutes"])
        assertEquals(true, later.daily.demoOverride)
        assertEquals(emptyList(), later.newFlags)
        assertEquals(SkipReason.already_open, later.skipped.single().why)
        assertNull(later.attention)
    }

    // ---- the other rules end to end ------------------------------------------------------

    @Test
    fun noStepsAndNoScreenTimeTurnRed() {
        val result = DailyJob.run(inputs(steps24h = 0.0, screen24h = 0.0))
        assertEquals(listOf(FlagKind.inactive), result.kinds())
        assertEquals(FlagLevel.red, result.attention!!.flagLevel)
    }

    @Test
    fun inactiveNeedsBothSignalsConsentedAndPresent() {
        assertEquals(emptyList(), DailyJob.run(inputs(steps24h = 0.0, screen24h = null)).newFlags)
        val noSteps = Signal.entries.toSet() - Signal.STEPS
        assertEquals(emptyList(), DailyJob.run(inputs(steps24h = 0.0, screen24h = 0.0, consented = noSteps)).newFlags)
        val noUsage = Signal.entries.toSet() - Signal.LATE_NIGHT_SCREEN_MINUTES
        assertEquals(emptyList(), DailyJob.run(inputs(steps24h = 0.0, screen24h = 0.0, consented = noUsage)).newFlags)
    }

    @Test
    fun threeLowMoodsInARowTurnAmberAndAMissingRatingBreaksTheRun() {
        fun checkIn(n: Int, mood: Int?, ended: Boolean = true) =
            CheckIn("c$n", startedAtMillis = NOW - 100_000L * (10 - n), endedAtMillis = if (ended) NOW - 100_000L * (10 - n) + 50_000 else null, mood = mood, sharedWithClinician = true)
        val low = listOf(checkIn(1, 4), checkIn(2, 2), checkIn(3, 1), checkIn(4, 2), checkIn(5, null, ended = false))
        val result = DailyJob.run(inputs(checkIns = low))
        assertEquals(listOf(FlagKind.low_mood), result.kinds())

        val broken = listOf(checkIn(1, 2), checkIn(2, 1), checkIn(3, null), checkIn(4, 2))
        assertEquals(emptyList(), DailyJob.run(inputs(checkIns = broken)).newFlags)

        // Once the Clinician clears it, the same three Check-ins do not raise it again.
        val cleared = result.newFlags.single().let { it.copy(id = "low_mood-2026-11-13", flag = it.flag.copy(clearedAtMillis = NOW + 1)) }
        val tomorrow = DailyJob.run(inputs(checkIns = low, flags = listOf(cleared)))
        assertEquals(emptyList(), tomorrow.newFlags)
    }

    @Test
    fun aCompositeLowOnThreeDaysRunningIsDrift() {
        val low = previousDays { ago, v -> if (ago <= 2) { v[Signal.SLEEP_MINUTES] = 405.0; v[Signal.STEPS] = 5400.0 } }
        val result = DailyJob.run(inputs(readings = mapOf(Signal.SLEEP_MINUTES to 405.0, Signal.STEPS to 5400.0), previous = low))
        assertEquals(listOf(FlagKind.drift), result.kinds())
        assertTrue(result.daily.composite!! <= DailyThresholds.DRIFT_COMPOSITE)
    }

    @Test
    fun aConstantHistoryNeverRaisesDrift() {
        val constant = previousDays { _, v -> v[Signal.SLEEP_MINUTES] = 420.0; v[Signal.STEPS] = 6000.0 }
        val result = DailyJob.run(inputs(readings = mapOf(Signal.SLEEP_MINUTES to 420.0, Signal.STEPS to 6000.0), previous = constant))
        assertEquals(0.0, result.daily.composite)
        assertEquals(emptyList(), result.newFlags)
    }

    @Test
    fun aShortHistoryNeverRaisesDrift() {
        val short = previousDays(count = 5) { ago, v -> if (ago <= 2) v[Signal.STEPS] = 1000.0 }
        val result = DailyJob.run(inputs(readings = mapOf(Signal.STEPS to 1000.0), previous = short))
        assertTrue(result.daily.composite!! <= DailyThresholds.DRIFT_COMPOSITE)
        assertEquals(emptyList(), result.newFlags)
        // With only four days there is no comparison at all.
        val shorter = DailyJob.run(inputs(readings = mapOf(Signal.STEPS to 1000.0), previous = short.drop(1)))
        assertNull(shorter.daily.composite)
        assertEquals(emptyList(), shorter.newFlags)
    }

    // ---- write rules ---------------------------------------------------------------------

    @Test
    fun theLevelSetByAFunctionIsNeverLowered() {
        val record = patient(level = FlagLevel.red, reasons = listOf("The phone has been quiet: it has not connected for over 24 hours."))
        val twoRough = previousDays { ago, v -> if (ago <= 2) v[Signal.SLEEP_MINUTES] = 385.0 }
        val result = DailyJob.run(inputs(readings = mapOf(Signal.SLEEP_MINUTES to 385.0, Signal.STEPS to 6000.0), previous = twoRough, patient = record))
        assertEquals(AttentionUpdate(FlagLevel.red, record.flagReasons + FlagReasons.POOR_SLEEP), result.attention)

        // With nothing new, the record is left alone: no level or reasons to write.
        assertNull(DailyJob.run(inputs(patient = record)).attention)
    }

    @Test
    fun whileNotSharingFlagsAreStampedFalseAndTheLevelIsLeftAlone() {
        val result = DailyJob.run(inputs(patient = patient(sharing = SharingConsent.declined), demoOverrides = mapOf(Signal.SLEEP_MINUTES to 120.0)))
        assertEquals(false, result.daily.sharedWithClinician)
        assertEquals(false, result.newFlags.single().flag.sharedWithClinician)
        assertNull(result.attention)
        assertEquals(NOW, result.lastSeenAtMillis)
    }

    @Test
    fun aRecordRewrittenLaterInTheDayKeepsItsStamp() {
        val morning = DailyJob.run(inputs()).daily
        val afternoon = DailyJob.run(inputs(existingToday = morning, patient = patient(sharing = SharingConsent.declined)))
        assertEquals(true, afternoon.daily.sharedWithClinician)
    }

    @Test
    fun aSecondRunTheSameDayRaisesNothingNew() {
        val first = DailyJob.run(inputs(steps24h = 0.0, screen24h = 0.0))
        val second = DailyJob.run(
            inputs(
                steps24h = 0.0,
                screen24h = 0.0,
                existingToday = first.daily,
                flags = first.newFlags,
                patient = first.attention!!.let { patient(level = it.flagLevel, reasons = it.flagReasons) },
            ),
        )
        assertEquals(emptyList(), second.newFlags)
        assertNull(second.attention)
    }

    @Test
    fun thePipelineIsDeterministic() {
        val i = inputs(steps24h = 0.0, screen24h = 0.0, demoOverrides = mapOf(Signal.SLEEP_MINUTES to 100.0))
        assertEquals(DailyJob.run(i), DailyJob.run(i))
    }
}
