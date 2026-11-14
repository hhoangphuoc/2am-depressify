package app.depressify.core.learning

import app.depressify.core.model.Suggestion
import app.depressify.core.model.SuggestionKind
import app.depressify.core.model.SuggestionStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The plan's Task 6 tests. The shared fixture is run in jvmTest (OutcomeFixtureTest). */
class SuggestionRankerTest {

    private var nextId = 0

    private fun scored(kind: SuggestionKind, score: Double?, status: SuggestionStatus = SuggestionStatus.accepted) = Suggestion(
        id = "s${nextId++}", kind = kind, details = "", suggestedAtMillis = 1L, status = status,
        outcomeScore = score, sharedWithClinician = true,
    )

    private fun near(expected: Double, actual: Double?) = assertTrue(actual != null && kotlin.math.abs(actual - expected) < 1e-9, "expected $expected, got $actual")

    @Test
    fun scoreNullUntilAnswered() {
        assertNull(Outcomes.score(tried = null, felt = 5, objectiveChange = 1.0))
    }

    @Test
    fun notTriedIsSlightlyNegative() {
        assertEquals(-0.1, Outcomes.score(tried = false, felt = null, objectiveChange = 2.0))
        assertEquals(-0.1, Outcomes.score(tried = false, felt = 5, objectiveChange = null))
    }

    @Test
    fun felt5NoChangeIs0_7() {
        near(0.7, Outcomes.score(tried = true, felt = 5, objectiveChange = null))
    }

    @Test
    fun scoreClampsObjectiveChange() {
        near(1.0, Outcomes.score(tried = true, felt = 5, objectiveChange = 3.0))
        near(-0.4, Outcomes.score(tried = true, felt = 1, objectiveChange = 3.0))
        near(-0.65, Outcomes.score(tried = true, felt = 2, objectiveChange = -2.5))
    }

    @Test
    fun missingStepChangeContributesNothing() {
        near(0.35, Outcomes.score(tried = true, felt = 4, objectiveChange = null))
        near(0.0, Outcomes.score(tried = true, felt = null, objectiveChange = Double.NaN))
    }

    @Test
    fun rankIgnoresUnscored() {
        val ranked = SuggestionRanker { 0.5 }.rank(
            listOf(scored(SuggestionKind.walk, 0.7), scored(SuggestionKind.music, null), scored(SuggestionKind.nature, null, SuggestionStatus.declined)),
        )
        assertEquals(listOf(SuggestionKind.walk), ranked.map { it.kind })
    }

    @Test
    fun rankTieBreaksByCount() {
        val ranked = SuggestionRanker { 0.5 }.rank(
            listOf(scored(SuggestionKind.walk, 0.35), scored(SuggestionKind.nature, 0.35), scored(SuggestionKind.nature, 0.35)),
        )
        assertEquals(listOf(KindScore(SuggestionKind.nature, 0.35, 2), KindScore(SuggestionKind.walk, 0.35, 1)), ranked)
    }

    @Test
    fun guidanceTop3Only() {
        val history = listOf(0.7, 0.5, 0.3, 0.1, -0.1).zip(SuggestionKind.entries) { score, kind -> scored(kind, score) }
        val guidance = SuggestionRanker { 0.9 }.guidance(history)
        assertEquals(listOf(SuggestionKind.walk, SuggestionKind.nature, SuggestionKind.music), guidance.preferred.map { it.kind })
    }

    @Test
    fun triesNewWhenRandBelowPoint2() {
        val history = listOf(scored(SuggestionKind.walk, 0.5), scored(SuggestionKind.nature, null))
        assertEquals(SuggestionKind.nature, SuggestionRanker { 0.19 }.guidance(history).tryNew)
    }

    @Test
    fun noNewWhenRandAbovePoint2() {
        val history = listOf(scored(SuggestionKind.walk, 0.5))
        assertNull(SuggestionRanker { 0.2 }.guidance(history).tryNew)
        assertNull(SuggestionRanker { 0.99 }.guidance(history).tryNew)
    }

    @Test
    fun emptyHistoryGivesEmptyPreferred() {
        assertEquals(Guidance(emptyList(), null), SuggestionRanker { 0.5 }.guidance(emptyList()))
        assertEquals(Guidance(emptyList(), SuggestionKind.walk), SuggestionRanker { 0.0 }.guidance(emptyList()))
    }

    @Test
    fun theRandomSourceIsAskedOnce() {
        var calls = 0
        SuggestionRanker { calls++; 0.1 }.guidance(listOf(scored(SuggestionKind.walk, 0.5)))
        assertEquals(1, calls)
    }

    @Test
    fun theOpenSuggestionIsTheLatestAcceptedOneWithoutAnOutcome() {
        val older = scored(SuggestionKind.walk, null).copy(id = "older", suggestedAtMillis = 100L)
        val answered = older.copy(id = "answered", suggestedAtMillis = 200L, tried = true, outcomeScore = 0.5, outcomeCheckInId = "c0")
        val notSaid = older.copy(id = "not-said", suggestedAtMillis = 250L, outcomeCheckInId = "c1")
        val declined = older.copy(id = "declined", suggestedAtMillis = 300L, status = SuggestionStatus.declined)
        val history = listOf(older, answered, notSaid, declined)
        assertEquals("older", Outcomes.openSuggestion(history, beforeMillis = 1_000L)?.id)
        // A retried finish of c1 finds the one it answered.
        assertEquals("not-said", Outcomes.openSuggestion(history, beforeMillis = 1_000L, checkInId = "c1")?.id)
        assertNull(Outcomes.openSuggestion(history, beforeMillis = 100L))
    }
}
