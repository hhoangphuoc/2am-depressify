package app.depressify.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoreRulesTest {
    @Test
    fun baselineNeedsFiveValidDaysAndIgnoresMissingDays() {
        assertEquals(Baseline.Result.Building(4), Baseline.of(listOf(6.0, null, 7.0, 5.5, null, 6.5)))
        assertEquals(Baseline.Result.Ready(6.5, 5), Baseline.of(listOf(6.0, null, 7.0, 5.5, 6.5, 8.0)))
    }

    @Test
    fun baselineUsesOnlyTheLastFourteenDays() {
        val days = List(10) { 1.0 } + List(14) { 9.0 }
        assertEquals(Baseline.Result.Ready(9.0, 14), Baseline.of(days))
    }

    @Test
    fun quietHoursHandleOvernightRangesAndRejectEqualEndpoints() {
        val q = QuietHours.Default
        assertTrue(q.contains(LocalMinutes(23 * 60)))
        assertTrue(q.contains(LocalMinutes(8 * 60 + 59)))
        assertFalse(q.contains(LocalMinutes(9 * 60)))
        assertFalse(QuietHours(LocalMinutes(600), LocalMinutes(600)).isValid)
    }

    @Test
    fun ratingsRejectOutOfRangeAndKeepSkipsUnanswered() {
        assertFailsWith<IllegalArgumentException> { Ratings(mood = 0) }
        assertEquals(null, Ratings(mood = 3).energy)
    }

    @Test
    fun nightAndGreetingFollowTheHour() {
        assertTrue(isNightHour(2))
        assertFalse(isNightHour(10))
        assertEquals("Still up, Alex?", greetingFor(23, "Alex"))
        assertEquals("Good morning, Alex", greetingFor(9, "Alex"))
    }
}
