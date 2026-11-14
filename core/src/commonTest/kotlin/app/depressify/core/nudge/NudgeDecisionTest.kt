package app.depressify.core.nudge

import app.depressify.core.LocalMinutes
import app.depressify.core.QuietHours
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.DateKeys
import app.depressify.core.model.Signal
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Instant

class NudgeDecisionTest {

    private val zone = TimeZone.of(DateKeys.DEMO_TIME_ZONE)

    /** A moment in Helsinki on the demo's "today", 14 November 2026, unless another date is given. */
    private fun at(hour: Int, minute: Int = 0, date: String = TODAY): Instant =
        LocalDateTime(LocalDate.parse(date), kotlinx.datetime.LocalTime(hour, minute)).toInstant(zone)

    private fun day(date: String, sleep: Double?, home: Double? = null, screen: Double? = null) = DailyDoc.of(
        date = date,
        values = emptyMap(),
        vsBaseline = mapOf(
            Signal.SLEEP_MINUTES to sleep,
            Signal.TIME_AT_HOME_MINUTES to home,
            Signal.LATE_NIGHT_SCREEN_MINUTES to screen,
        ),
        composite = null,
        sharedWithClinician = false,
    )

    /** Last night and the night before, both rough, with more time at home than usual. */
    private val roughNights = listOf(day(YESTERDAY, -1.4, home = 1.6), day(TODAY, -1.2))

    private fun input(
        now: Instant = at(12),
        enabled: Boolean = true,
        lastNudgeAt: Instant? = null,
        quietHours: QuietHours = QuietHours.Default,
        days: List<DailyDoc> = emptyList(),
        lastCheckInAt: Instant? = null,
        calendar: CalendarAvailability = CalendarAvailability.Unknown,
        weather: WeatherOutlook = WeatherOutlook.Unknown,
        staleAfterDays: Int = NudgeThresholds.STALE_AFTER_DAYS,
    ) = NudgeInput(
        now = now,
        timeZone = zone,
        nudgesEnabled = enabled,
        lastNudgeAt = lastNudgeAt,
        quietHours = quietHours,
        recentDays = days,
        lastCheckInAt = lastCheckInAt,
        calendar = calendar,
        weather = weather,
        staleAfterDays = staleAfterDays,
    )

    private val roughNudge = NudgeOutcome.Nudge(NudgeReason.RoughNights)
    private val nothing = NudgeOutcome.None(NoNudgeReason.NothingApplies)

    // --- When no Nudge is sent at all ---

    @Test
    fun nothingAppliesAtNoonWithoutEvidence() {
        assertEquals(nothing, NudgeDecision.decide(input()))
    }

    @Test
    fun noNudgeWhenNudgesAreOff() {
        assertEquals(
            NudgeOutcome.None(NoNudgeReason.NudgesOff),
            NudgeDecision.decide(input(enabled = false, days = roughNights)),
        )
    }

    @Test
    fun noNudgeTwiceOnTheSameDay() {
        assertEquals(
            NudgeOutcome.None(NoNudgeReason.AlreadySentToday),
            NudgeDecision.decide(input(lastNudgeAt = at(9, 30), days = roughNights)),
        )
    }

    @Test
    fun nudgesAgainTheNextDay() {
        assertEquals(roughNudge, NudgeDecision.decide(input(lastNudgeAt = at(20, 0, YESTERDAY), days = roughNights)))
    }

    @Test
    fun todayIsTheLocalDateNotTheUtcDate() {
        // 23:30 UTC on the 13th is 01:30 on the 14th in Helsinki: already today there.
        val lastNudge = Instant.parse("2026-11-13T23:30:00Z")
        assertEquals(
            NudgeOutcome.None(NoNudgeReason.AlreadySentToday),
            NudgeDecision.decide(input(lastNudgeAt = lastNudge, days = roughNights)),
        )
    }

    @Test
    fun aSecondRunOnTheSameDayGivesNoNudgeOnceTheFirstIsRecorded() {
        val first = input(now = at(10), days = roughNights)
        assertEquals(roughNudge, NudgeDecision.decide(first))
        // The app records the time it posted the first Nudge, then the job runs again six hours later.
        val second = first.copy(now = at(16), lastNudgeAt = first.now)
        assertEquals(NudgeOutcome.None(NoNudgeReason.AlreadySentToday), NudgeDecision.decide(second))
    }

    @Test
    fun noNudgeInsideQuietHoursAcrossMidnight() {
        val quiet = NudgeOutcome.None(NoNudgeReason.QuietHours)
        assertEquals(quiet, NudgeDecision.decide(input(now = at(21, 0), days = roughNights)))
        assertEquals(quiet, NudgeDecision.decide(input(now = at(23, 30), days = roughNights)))
        assertEquals(quiet, NudgeDecision.decide(input(now = at(0, 15), days = roughNights)))
        assertEquals(quiet, NudgeDecision.decide(input(now = at(8, 59), days = roughNights)))
        assertEquals(roughNudge, NudgeDecision.decide(input(now = at(9, 0), days = roughNights)))
        assertEquals(roughNudge, NudgeDecision.decide(input(now = at(20, 59), days = roughNights)))
    }

    @Test
    fun noNudgeInsideDaytimeQuietHours() {
        val q = QuietHours(LocalMinutes(13 * 60), LocalMinutes(15 * 60))
        assertEquals(
            NudgeOutcome.None(NoNudgeReason.QuietHours),
            NudgeDecision.decide(input(now = at(14), quietHours = q, days = roughNights)),
        )
        assertEquals(roughNudge, NudgeDecision.decide(input(now = at(22), quietHours = q, days = roughNights)))
    }

    @Test
    fun quietHoursWithIdenticalEndpointsFallBackToTheDefault() {
        val broken = QuietHours(LocalMinutes(600), LocalMinutes(600))
        assertEquals(roughNudge, NudgeDecision.decide(input(now = at(12), quietHours = broken, days = roughNights)))
        assertEquals(
            NudgeOutcome.None(NoNudgeReason.QuietHours),
            NudgeDecision.decide(input(now = at(23), quietHours = broken, days = roughNights)),
        )
    }

    @Test
    fun noNudgeWhileTheCalendarShowsBusy() {
        assertEquals(
            NudgeOutcome.None(NoNudgeReason.CalendarBusy),
            NudgeDecision.decide(input(now = at(18), days = roughNights, calendar = CalendarAvailability.Busy)),
        )
    }

    // --- Rough nights ---

    @Test
    fun roughNightsWinOverAFreeHourAndTheEveningInvitation() {
        val out = NudgeDecision.decide(
            input(
                now = at(18),
                days = roughNights,
                calendar = CalendarAvailability.Free,
                weather = WeatherOutlook.Good,
            ),
        )
        assertEquals(roughNudge, out)
    }

    @Test
    fun roughNightsNeedBothNightsPresent() {
        // Last night rough, the night before missing (watch not worn): no rough nights.
        assertEquals(nothing, NudgeDecision.decide(input(days = listOf(day(YESTERDAY, null, home = 2.0), day(TODAY, -1.5, home = 2.0)))))
        // The night before has no daily record at all.
        assertEquals(nothing, NudgeDecision.decide(input(days = listOf(day(TODAY, -1.5, home = 2.0)))))
        // Last night missing, even with a rough night before it.
        assertEquals(nothing, NudgeDecision.decide(input(days = listOf(day(YESTERDAY, -1.5, home = 2.0), day(TODAY, null, home = 2.0)))))
    }

    @Test
    fun roughNightsNeedBothNightsAtOrBelowMinusOne() {
        assertEquals(roughNudge, NudgeDecision.decide(input(days = listOf(day(YESTERDAY, -1.0), day(TODAY, -1.0, home = 1.5)))))
        assertEquals(nothing, NudgeDecision.decide(input(days = listOf(day(YESTERDAY, -0.9), day(TODAY, -2.0, home = 1.5)))))
    }

    @Test
    fun roughNightsNeedMoreTimeAtHomeOrMoreLateNightScreenTime() {
        val nights = { home: Double?, screen: Double? -> listOf(day(YESTERDAY, -1.5), day(TODAY, -1.5, home, screen)) }
        assertEquals(nothing, NudgeDecision.decide(input(days = nights(null, null))))
        assertEquals(nothing, NudgeDecision.decide(input(days = nights(0.5, 0.2))))
        // "More than usual" is strictly above the threshold.
        assertEquals(nothing, NudgeDecision.decide(input(days = nights(1.0, 1.0))))
        assertEquals(roughNudge, NudgeDecision.decide(input(days = nights(1.1, null))))
        assertEquals(roughNudge, NudgeDecision.decide(input(days = nights(null, 1.3))))
        // Less time at home than usual (a negative comparison) never counts as more.
        assertEquals(nothing, NudgeDecision.decide(input(days = nights(-2.0, -2.0))))
    }

    @Test
    fun moreTimeAtHomeCanBeOnEitherOfTheTwoDays() {
        val days = listOf(day(YESTERDAY, -1.5, screen = 1.8), day(TODAY, -1.5))
        assertEquals(roughNudge, NudgeDecision.decide(input(days = days)))
        // But not on a day before the two nights.
        val older = listOf(day("2026-11-12", 0.0, home = 3.0), day(YESTERDAY, -1.5), day(TODAY, -1.5))
        assertEquals(nothing, NudgeDecision.decide(input(days = older)))
    }

    @Test
    fun staleSignalsAreNeverUsedAsEvidence() {
        // Two rough nights, but the newest record is from 3 and 4 days ago.
        val stale = listOf(day("2026-11-10", -2.0, home = 2.0), day("2026-11-11", -2.0, home = 2.0))
        assertEquals(nothing, NudgeDecision.decide(input(days = stale)))
        // No record today: yesterday and the day before are beyond the 1-day limit...
        val noToday = listOf(day("2026-11-12", -2.0, home = 2.0), day(YESTERDAY, -2.0, home = 2.0))
        assertEquals(nothing, NudgeDecision.decide(input(days = noToday)))
        // ...and count when the limit allows 2 days.
        assertEquals(roughNudge, NudgeDecision.decide(input(days = noToday, staleAfterDays = 2)))
    }

    @Test
    fun aRecordFromTheFutureIsIgnored() {
        val days = roughNights + day("2026-11-15", 0.5)
        assertEquals(roughNudge, NudgeDecision.decide(input(days = days)))
    }

    @Test
    fun recordsCanArriveInAnyOrderAndBadDatesAreIgnored() {
        val days = listOf(day(TODAY, -1.2), day("not-a-date", 3.0), day(YESTERDAY, -1.4, home = 1.6))
        assertEquals(roughNudge, NudgeDecision.decide(input(days = days)))
    }

    // --- A free hour with good weather ---

    @Test
    fun aFreeHourWithGoodWeather() {
        assertEquals(
            NudgeOutcome.Nudge(NudgeReason.FreeHourGoodWeather),
            NudgeDecision.decide(input(calendar = CalendarAvailability.Free, weather = WeatherOutlook.Good)),
        )
    }

    @Test
    fun unknownWeatherDoesNotCountAsGood() {
        assertEquals(nothing, NudgeDecision.decide(input(calendar = CalendarAvailability.Free, weather = WeatherOutlook.Unknown)))
        assertEquals(nothing, NudgeDecision.decide(input(calendar = CalendarAvailability.Free, weather = WeatherOutlook.Bad)))
    }

    @Test
    fun unknownCalendarIsNeverTreatedAsFree() {
        assertEquals(nothing, NudgeDecision.decide(input(calendar = CalendarAvailability.Unknown, weather = WeatherOutlook.Good)))
    }

    @Test
    fun aFreeHourWinsOverTheEveningInvitation() {
        assertEquals(
            NudgeOutcome.Nudge(NudgeReason.FreeHourGoodWeather),
            NudgeDecision.decide(input(now = at(18), calendar = CalendarAvailability.Free, weather = WeatherOutlook.Good)),
        )
    }

    // --- No Check-in by 17:00 ---

    @Test
    fun eveningInvitationOnlyFromFiveOClock() {
        assertEquals(nothing, NudgeDecision.decide(input(now = at(16, 59))))
        assertEquals(NudgeOutcome.Nudge(NudgeReason.NoCheckInByEvening), NudgeDecision.decide(input(now = at(17, 0))))
    }

    @Test
    fun eveningInvitationOnlyWithoutACheckInToday() {
        assertEquals(nothing, NudgeDecision.decide(input(now = at(18), lastCheckInAt = at(7, 45))))
        assertEquals(
            NudgeOutcome.Nudge(NudgeReason.NoCheckInByEvening),
            NudgeDecision.decide(input(now = at(18), lastCheckInAt = at(19, 0, YESTERDAY))),
        )
    }

    @Test
    fun eveningInvitationNeedsNoCalendarOrWeather() {
        // Unknown calendar and weather never block the generic evening invitation; only busy does.
        assertEquals(NudgeOutcome.Nudge(NudgeReason.NoCheckInByEvening), NudgeDecision.decide(input(now = at(19))))
        assertEquals(
            NudgeOutcome.None(NoNudgeReason.CalendarBusy),
            NudgeDecision.decide(input(now = at(19), calendar = CalendarAvailability.Busy)),
        )
    }

    private companion object {
        const val TODAY = "2026-11-14"
        const val YESTERDAY = "2026-11-13"
    }
}
