package app.depressify.core.daily

import app.depressify.core.model.FlagKind
import app.depressify.core.model.FlagLevel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SignalFlagRulesTest {

    // ---- sleep collapse (red) ----------------------------------------------------------------

    @Test
    fun sleepUnderThreeHoursIsRed() {
        val draft = SignalFlagRules.sleepCollapse(sleepMinutesToday = 150.0, orientedSleepToday = null)!!
        assertEquals(FlagLevel.red, draft.level)
        assertEquals(FlagKind.sleep_collapse, draft.kind)
        assertEquals(FlagReasons.sleepUnder(DailyThresholds.SLEEP_COLLAPSE_MINUTES), draft.reason)
    }

    @Test
    fun sleepFarBelowUsualIsRed() {
        val draft = SignalFlagRules.sleepCollapse(sleepMinutesToday = 300.0, orientedSleepToday = -2.5)!!
        assertEquals(FlagLevel.red, draft.level)
        assertEquals(FlagReasons.SLEEP_FAR_BELOW_USUAL, draft.reason)
        assertNull(SignalFlagRules.sleepCollapse(sleepMinutesToday = 300.0, orientedSleepToday = -2.4))
        assertNull(SignalFlagRules.sleepCollapse(sleepMinutesToday = 180.0, orientedSleepToday = null))
    }

    @Test
    fun missingSleepNeverRaisesSleepCollapse() {
        assertNull(SignalFlagRules.sleepCollapse(sleepMinutesToday = null, orientedSleepToday = -9.0))
        assertNull(SignalFlagRules.sleepCollapse(sleepMinutesToday = null, orientedSleepToday = null))
    }

    // ---- inactive (red) ----------------------------------------------------------------------

    @Test
    fun zeroStepsAndZeroScreenTimeIsRed() {
        val draft = SignalFlagRules.inactive(stepsLast24h = 0.0, screenMinutesLast24h = 0.0)!!
        assertEquals(FlagLevel.red, draft.level)
        assertEquals(FlagKind.inactive, draft.kind)
    }

    @Test
    fun inactiveNeedsBothPresentAndBothZero() {
        assertNull(SignalFlagRules.inactive(stepsLast24h = null, screenMinutesLast24h = 0.0))
        assertNull(SignalFlagRules.inactive(stepsLast24h = 0.0, screenMinutesLast24h = null))
        assertNull(SignalFlagRules.inactive(stepsLast24h = null, screenMinutesLast24h = null))
        assertNull(SignalFlagRules.inactive(stepsLast24h = 0.0, screenMinutesLast24h = 4.0))
        assertNull(SignalFlagRules.inactive(stepsLast24h = 12.0, screenMinutesLast24h = 0.0))
    }

    // ---- poor sleep (amber) ------------------------------------------------------------------

    @Test
    fun threePoorNightsIsAmber() {
        val draft = SignalFlagRules.poorSleep(listOf(-1.0, -1.4, -2.0))!!
        assertEquals(FlagLevel.amber, draft.level)
        assertEquals(FlagKind.poor_sleep, draft.kind)
    }

    @Test
    fun poorSleepNeedsThreeNightsAllPresent() {
        assertNull(SignalFlagRules.poorSleep(listOf(-1.4, -2.0)))
        assertNull(SignalFlagRules.poorSleep(listOf(-1.4, null, -2.0)))
        assertNull(SignalFlagRules.poorSleep(listOf(-1.4, -2.0, null)))
        assertNull(SignalFlagRules.poorSleep(listOf(-0.9, -1.4, -2.0)))
        // Only the last three nights count.
        assertTrue(SignalFlagRules.poorSleep(listOf(null, 0.5, -1.1, -1.2, -1.3)) != null)
    }

    // ---- low mood (amber) --------------------------------------------------------------------

    @Test
    fun threeLowMoodsIsAmber() {
        val draft = SignalFlagRules.lowMood(listOf(4, 2, 1, 2), newestAtMillis = 99L)!!
        assertEquals(FlagLevel.amber, draft.level)
        assertEquals(FlagKind.low_mood, draft.kind)
        assertEquals(99L, draft.evidenceAtMillis)
    }

    @Test
    fun twoLowMoodsIsNotAFlag() {
        assertNull(SignalFlagRules.lowMood(listOf(2, 1), newestAtMillis = 1L))
        assertNull(SignalFlagRules.lowMood(listOf(3, 2, 1), newestAtMillis = 1L))
    }

    @Test
    fun aMissingMoodRatingBreaksTheRun() {
        assertNull(SignalFlagRules.lowMood(listOf(2, null, 1), newestAtMillis = 1L))
        assertNull(SignalFlagRules.lowMood(listOf(1, 2, null), newestAtMillis = 1L))
    }

    // ---- drift (amber) -----------------------------------------------------------------------

    @Test
    fun compositeLowOnThreeDaysRunningIsDrift() {
        val draft = SignalFlagRules.drift(listOf(-1.0, -1.3, -1.1))!!
        assertEquals(FlagLevel.amber, draft.level)
        assertEquals(FlagKind.drift, draft.kind)
    }

    @Test
    fun driftNeedsThreeConsecutiveDaysAllPresent() {
        assertNull(SignalFlagRules.drift(listOf(-1.3, -1.1)))
        assertNull(SignalFlagRules.drift(listOf(-1.3, null, -1.1)))
        assertNull(SignalFlagRules.drift(listOf(-1.3, -0.2, -1.1)))
    }

    // ---- all rules together ------------------------------------------------------------------

    @Test
    fun aQuietDayRaisesNothing() {
        val input = SignalFlagInput(
            sleepMinutesToday = null,
            orientedSleep = listOf(null, null, null),
            composites = listOf(null, null, null),
            stepsLast24h = null,
            screenMinutesLast24h = null,
            recentMoods = emptyList(),
        )
        assertEquals(emptyList(), SignalFlagRules.evaluate(input))
    }

    @Test
    fun evaluateRunsEveryRuleRedFirst() {
        val input = SignalFlagInput(
            sleepMinutesToday = 120.0,
            orientedSleep = listOf(-1.5, -1.5, -4.0),
            composites = listOf(-1.2, -1.4, -2.0),
            stepsLast24h = 0.0,
            screenMinutesLast24h = 0.0,
            recentMoods = listOf(1, 2, 2),
            newestMoodAtMillis = 5L,
        )
        val kinds = SignalFlagRules.evaluate(input).map { it.kind }
        assertEquals(
            listOf(FlagKind.sleep_collapse, FlagKind.inactive, FlagKind.poor_sleep, FlagKind.low_mood, FlagKind.drift),
            kinds,
        )
    }

    // ---- reasons and thresholds --------------------------------------------------------------

    @Test
    fun reasonsArePlainSentencesWithNoDecimalNumbers() {
        val decimal = Regex("""\d+[.,]\d""")
        val reasons = FlagReasons.all + listOf(FlagReasons.sleepUnder(150.0), FlagReasons.sleepUnder(90.0))
        for (reason in reasons) {
            assertFalse(decimal.containsMatchIn(reason), reason)
            assertTrue(reason.first().isUpperCase() && reason.endsWith("."), reason)
        }
    }

    @Test
    fun theSleepReasonFollowsTheThreshold() {
        assertEquals("Slept under 3 hours last night.", FlagReasons.sleepUnder(180.0))
        assertEquals("Slept under 150 minutes last night.", FlagReasons.sleepUnder(150.0))
        assertEquals("Slept under 2 hours last night.", FlagReasons.sleepUnder(120.0))
    }

    @Test
    fun thresholdsAreTheSpecsStartingValues() {
        assertEquals(180.0, DailyThresholds.SLEEP_COLLAPSE_MINUTES)
        assertEquals(-2.5, DailyThresholds.SLEEP_COLLAPSE_ORIENTED)
        assertEquals(-1.0, DailyThresholds.POOR_SLEEP_ORIENTED)
        assertEquals(3, DailyThresholds.POOR_SLEEP_NIGHTS)
        assertEquals(2, DailyThresholds.LOW_MOOD_AT_MOST)
        assertEquals(3, DailyThresholds.LOW_MOOD_CHECK_INS)
        assertEquals(-1.0, DailyThresholds.DRIFT_COMPOSITE)
        assertEquals(3, DailyThresholds.DRIFT_DAYS)
    }
}
