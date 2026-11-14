package app.depressify.core.daily

import app.depressify.core.model.Flag
import app.depressify.core.model.FlagKind
import app.depressify.core.model.FlagLevel
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FlagWriteRulesTest {

    private val date = "2026-11-14"
    private val now = 1_763_100_000_000L

    private fun patient(
        sharing: SharingConsent = SharingConsent.granted,
        level: FlagLevel = FlagLevel.green,
        reasons: List<String> = emptyList(),
        lastSeen: Long? = null,
    ) = PatientDoc(
        displayName = "Live patient",
        clinicianEmail = "clinician@example.com",
        flagLevel = level,
        flagReasons = reasons,
        sharingConsent = sharing,
        lastSeenAtMillis = lastSeen,
    )

    private val poorSleep = FlagDraft(FlagLevel.amber, FlagKind.poor_sleep, FlagReasons.POOR_SLEEP)
    private val collapse = FlagDraft(FlagLevel.red, FlagKind.sleep_collapse, FlagReasons.SLEEP_FAR_BELOW_USUAL)
    private val drift = FlagDraft(FlagLevel.amber, FlagKind.drift, FlagReasons.DRIFT)

    private fun stored(id: String, kind: FlagKind, level: FlagLevel, shared: Boolean = true, cleared: Long? = null, raised: Long = now - 1000) =
        StoredFlag(id, Flag(level, kind, "Some reason.", raised, cleared, shared))

    @Test
    fun newFlagsAreUnclearedStampedAndHaveDeterministicIds() {
        val plan = FlagWriteRules.plan(listOf(poorSleep), emptyList(), patient(), date, now)
        val flag = plan.newFlags.single()
        assertEquals("poor_sleep-2026-11-14", flag.id)
        assertEquals(Flag(FlagLevel.amber, FlagKind.poor_sleep, FlagReasons.POOR_SLEEP, now, null, true), flag.flag)
        assertEquals(AttentionUpdate(FlagLevel.amber, listOf(FlagReasons.POOR_SLEEP)), plan.attention)
    }

    @Test
    fun aFlagRaisedWhileNotSharingIsStampedFalseAndLeavesTheLevelAlone() {
        for (sharing in listOf(SharingConsent.undecided, SharingConsent.declined)) {
            val plan = FlagWriteRules.plan(listOf(collapse), emptyList(), patient(sharing = sharing), date, now)
            val flag = plan.newFlags.single()
            assertEquals(false, flag.flag.sharedWithClinician)
            assertEquals("sleep_collapse-2026-11-14-unshared", flag.id)
            assertNull(plan.attention)
        }
    }

    @Test
    fun aKindWithAnUnclearedFlagOfTheSameStampIsNotRaisedAgain() {
        val open = stored("poor_sleep-2026-11-12", FlagKind.poor_sleep, FlagLevel.amber)
        val plan = FlagWriteRules.plan(listOf(poorSleep), listOf(open), patient(level = FlagLevel.amber), date, now)
        assertEquals(emptyList(), plan.newFlags)
        assertEquals(listOf(SkippedDraft(poorSleep, SkipReason.already_open)), plan.skipped)
        assertNull(plan.attention)
    }

    @Test
    fun anUnsharedOpenFlagNeverBlocksASharedOne() {
        val hidden = stored("poor_sleep-2026-11-12-unshared", FlagKind.poor_sleep, FlagLevel.amber, shared = false)
        val plan = FlagWriteRules.plan(listOf(poorSleep), listOf(hidden), patient(), date, now)
        assertEquals("poor_sleep-2026-11-14", plan.newFlags.single().id)
    }

    @Test
    fun aClearedFlagOfAnEarlierDayDoesNotBlock() {
        val cleared = stored("poor_sleep-2026-11-12", FlagKind.poor_sleep, FlagLevel.amber, cleared = now - 500)
        val plan = FlagWriteRules.plan(listOf(poorSleep), listOf(cleared), patient(), date, now)
        assertEquals(1, plan.newFlags.size)
    }

    @Test
    fun aFlagClearedTodayIsNotRaisedAgainTheSameDay() {
        // The id is taken (the rules refuse a second create on it), so the kind waits for tomorrow.
        val clearedToday = stored("poor_sleep-2026-11-14", FlagKind.poor_sleep, FlagLevel.amber, cleared = now - 500)
        val plan = FlagWriteRules.plan(listOf(poorSleep), listOf(clearedToday), patient(), date, now)
        assertEquals(emptyList(), plan.newFlags)
        assertEquals(SkipReason.already_raised, plan.skipped.single().why)
    }

    @Test
    fun evidenceAlreadyFlaggedIsNotFlaggedAgain() {
        // Low mood rests on Check-ins: once a flag on them is cleared, the same Check-ins do not raise it again.
        val lowMood = FlagDraft(FlagLevel.amber, FlagKind.low_mood, FlagReasons.LOW_MOOD, evidenceAtMillis = now - 10_000)
        val clearedLater = stored("low_mood-2026-11-13", FlagKind.low_mood, FlagLevel.amber, cleared = now - 500, raised = now - 5_000)
        assertEquals(emptyList(), FlagWriteRules.plan(listOf(lowMood), listOf(clearedLater), patient(), date, now).newFlags)
        val newer = lowMood.copy(evidenceAtMillis = now - 1_000)
        assertEquals(1, FlagWriteRules.plan(listOf(newer), listOf(clearedLater), patient(), date, now).newFlags.size)
    }

    @Test
    fun theLevelOnlyGoesUpAndAFunctionsRedIsKept() {
        val record = patient(level = FlagLevel.red, reasons = listOf("Crisis reason."))
        val plan = FlagWriteRules.plan(listOf(poorSleep), emptyList(), record, date, now)
        assertEquals(AttentionUpdate(FlagLevel.red, listOf("Crisis reason.", FlagReasons.POOR_SLEEP)), plan.attention)
    }

    @Test
    fun aRedFromTheClinicianLeftUnclearedIsNeverLowered() {
        val record = patient(level = FlagLevel.red, reasons = listOf("The phone has been quiet."))
        val open = stored("silent-1", FlagKind.silent, FlagLevel.red)
        val plan = FlagWriteRules.plan(listOf(drift), listOf(open), record, date, now)
        val attention = plan.attention!!
        assertEquals(FlagLevel.red, attention.flagLevel)
        assertTrue(attention.flagReasons.containsAll(record.flagReasons))
    }

    @Test
    fun reasonsRunHighestLevelFirstThenNewest() {
        val record = patient(level = FlagLevel.amber, reasons = listOf("Older amber."))
        val plan = FlagWriteRules.plan(listOf(poorSleep, collapse, drift), emptyList(), record, date, now)
        val attention = plan.attention!!
        assertEquals(FlagLevel.red, attention.flagLevel)
        assertEquals(listOf(FlagReasons.SLEEP_FAR_BELOW_USUAL, FlagReasons.DRIFT, FlagReasons.POOR_SLEEP, "Older amber."), attention.flagReasons)
    }

    @Test
    fun raisedAttentionMirrorsTheFunctions() {
        // silence.ts / flags.ts `raisedAttention`: up only; at or above the current level goes first.
        assertEquals(
            AttentionUpdate(FlagLevel.amber, listOf("B.", "A.")),
            FlagWriteRules.raisedAttention(FlagLevel.amber, listOf("A."), FlagLevel.amber, "B."),
        )
        assertEquals(
            AttentionUpdate(FlagLevel.red, listOf("A.", "B.")),
            FlagWriteRules.raisedAttention(FlagLevel.red, listOf("A."), FlagLevel.amber, "B."),
        )
        // The same reason is never listed twice.
        assertEquals(
            AttentionUpdate(FlagLevel.amber, listOf("A.")),
            FlagWriteRules.raisedAttention(FlagLevel.amber, listOf("A."), FlagLevel.amber, "A."),
        )
    }

    @Test
    fun theSignOfLifeMovesForwardOnly() {
        assertEquals(now, FlagWriteRules.signOfLife(null, now))
        assertEquals(now, FlagWriteRules.signOfLife(now - 10, now))
        assertEquals(now + 10, FlagWriteRules.signOfLife(now + 10, now))
    }
}
