package app.depressify.core.nudge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

class CalendarWindowTest {

    private val now = Instant.parse("2026-11-14T10:00:00Z")

    @Test
    fun noReadingIsUnknownNeverFree() {
        assertEquals(CalendarAvailability.Unknown, CalendarAvailability.forWindow(null, now))
    }

    @Test
    fun noBusyTimeInTheNextHourIsFree() {
        assertEquals(CalendarAvailability.Free, CalendarAvailability.forWindow(emptyList(), now))
        // A meeting that ended at now, and one that starts when the hour is over.
        val around = listOf((now - 30.minutes)..<now, (now + 60.minutes)..<(now + 90.minutes))
        assertEquals(CalendarAvailability.Free, CalendarAvailability.forWindow(around, now))
    }

    @Test
    fun anyBusyTimeInTheNextHourIsBusy() {
        assertEquals(CalendarAvailability.Busy, CalendarAvailability.forWindow(listOf((now - 10.minutes)..<(now + 5.minutes)), now))
        assertEquals(CalendarAvailability.Busy, CalendarAvailability.forWindow(listOf((now + 45.minutes)..<(now + 75.minutes)), now))
    }
}
