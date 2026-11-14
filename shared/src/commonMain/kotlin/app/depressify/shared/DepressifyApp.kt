package app.depressify.shared

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import app.depressify.core.BookingPlan
import app.depressify.core.LocalMinutes
import app.depressify.core.isNightHour
import app.depressify.shared.data.PatientBackend
import app.depressify.shared.screens.*
import app.depressify.shared.state.*
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.DayColors
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.ui.theme.DepressifyTheme
import app.depressify.shared.ui.theme.DepressifyType

/**
 * Patient app root, shared by Android and iOS. [backend] is the platform's Firebase access, or null
 * to run on demo data only. [onNightChange] lets each platform match its system bars.
 */
@Composable
fun DepressifyApp(backend: PatientBackend? = null, onNightChange: (Boolean) -> Unit = {}) {
    val vm = viewModel { PatientViewModel(backend) }
    val s by vm.ui.collectAsStateWithLifecycle()
    val hour = remember { localHour() }
    val night = when (s.themeMode) { ThemeMode.Auto -> isNightHour(hour); ThemeMode.Day -> false; ThemeMode.Night -> true }
    val nightCallback by rememberUpdatedState(onNightChange)
    LaunchedEffect(night) { nightCallback(night) }

    DepressifyTheme(night) {
        Box(Modifier.fillMaxSize().background(Theme.colors.ground)) {
            NavDisplay(
                backStack = vm.backStack,
                onBack = { vm.back() },
                entryProvider = entryProvider {
                    entry<Route.Today> { TodayScreen(vm, s, hour) }
                    entry<Route.History> { HistoryScreen(vm, s) }
                    entry<Route.Settings> { SettingsScreen(vm, s) }
                    entry<Route.Welcome> { WelcomeScreen(vm) }
                    entry<Route.Sharing> { SharingScreen(vm, s) }
                    entry<Route.CheckInIntro> { CheckInIntroScreen(vm, s) }
                    entry<Route.CheckIn> { CheckInScreen(vm, s) }
                    entry<Route.Ratings> { RatingsScreen(vm, s) }
                    entry<Route.Finishing> { FinishingScreen(vm, s) }
                    entry<Route.Summary> { key -> SummaryScreen(vm, s, key.id) }
                    entry<Route.Suggestion> { SuggestionScreen(vm, s) }
                    entry<Route.Signals> { SignalsScreen(vm, s) }
                    entry<Route.Signal> { key -> SignalScreen(vm, s, key.id) }
                    entry<Route.QuietHours> { QuietHoursScreen(vm, s) }
                    entry<Route.Privacy> { PrivacyScreen(vm, s) }
                    entry<Route.Support> { SupportScreen(vm) }
                    entry<Route.Crisis> { CrisisScreen(vm, s) }
                },
            )
            AppSheets(vm, s)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AppSheets(vm: PatientViewModel, s: PatientState) {
    val close = { vm.showSheet(null) }
    val c = DayColors
    when (s.sheet) {
        null -> Unit
        Sheet.Demo -> CalmSheet("Explore the design", close) {
            Txt("Prototype controls · synthetic data", DepressifyType.meta, c.muted)
            Txt("Theme", DepressifyType.titleSmall, c.ink)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ThemeMode.entries.forEach { m -> ChoicePill(m.label, s.themeMode == m, { vm.setThemeMode(m) }) }
            }
            Txt("States", DepressifyType.titleSmall, c.ink)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Scenario.entries.forEach { sc -> ChoicePill(sc.label, s.scenario == sc, { vm.applyScenario(sc) }) }
            }
        }
        Sheet.Booking -> BookingSheet(s.booking, onBook = vm::book, onClose = close)
        Sheet.DeleteSignal -> CalmSheet("Stop " + s.selectedSignal.label.lowercase() + "?", close) {
            Txt("Collection stops and collected " + s.selectedSignal.label.lowercase() + " data is deleted. This cannot be undone.", DepressifyType.body, c.body)
            Txt("This prototype changes the local visible state only.", DepressifyType.meta, c.muted)
            PrimaryButton("Stop and delete", { vm.stopAndDelete(s.selectedSignal) })
            TextLink("Keep this Signal", close)
        }
        Sheet.StopSharing -> CalmSheet("Stop sharing?", close) {
            Txt("Your Clinician loses access to shared progress. Future Check-ins stay private.", DepressifyType.body, c.body)
            PrimaryButton("Stop sharing progress", { vm.setSharing(false) })
            TextLink("Keep sharing", close)
        }
        Sheet.Dialler -> CalmSheet("Help, in your hands", close) {
            Txt("This is a simulated dialler. No real number is configured and no call can be placed.", DepressifyType.body, c.body)
            SoftCard { Txt("Demo help contact", DepressifyType.body, c.muted) }
            PrimaryButton("Return to help options", close)
        }
        Sheet.Leave -> CalmSheet("Leave without a Summary?", close) {
            Txt("The conversation text is discarded. It cannot be recovered to make a Summary later.", DepressifyType.body, c.body)
            PrimaryButton("Discard and leave", vm::leaveCheckIn)
            TextLink("Keep going", close)
        }
        Sheet.MapsSources -> CalmSheet("Google Maps sources", close) {
            Txt("Place and weather answers may use Google Maps. Source links appear with results.", DepressifyType.body, c.body)
            if (!vm.live.isLive) Txt("No Maps lookup has run in this scripted Check-in.", DepressifyType.meta, c.muted)
            SecondaryButton("Back to Check-in", close)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BookingSheet(existing: BookingPlan?, onBook: (BookingPlan) -> Unit, onClose: () -> Unit) {
    val c = DayColors
    var day by remember { mutableStateOf(existing?.dayLabel ?: "Tomorrow") }
    var time by remember { mutableStateOf(existing?.time ?: LocalMinutes(11 * 60)) }
    var duration by remember { mutableStateOf(existing?.durationMinutes ?: 10) }
    CalmSheet("Make a little time", onClose) {
        if (existing != null) {
            Txt(existing.dayLabel + " at " + existing.time.label() + " · " + existing.durationMinutes + " minutes", DepressifyType.body, c.ink)
            Txt("Added to your demo calendar.", DepressifyType.meta, c.ok)
            PrimaryButton("Done", onClose)
            return@CalmSheet
        }
        Txt("A little time outside · demo calendar. Booking needs your agreement, even when Calendar sensing is off.", DepressifyType.meta, c.muted)
        Txt("Day", DepressifyType.meta, c.ink)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("Tomorrow", "Sunday", "Monday").forEach { d -> ChoicePill(d, day == d, { day = d }) } }
        Txt("Time", DepressifyType.meta, c.ink)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(9, 11, 14, 17).forEach { h -> val t = LocalMinutes(h * 60); ChoicePill(t.label(), time == t, { time = t }) }
        }
        Txt("Duration", DepressifyType.meta, c.ink)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { BookingPlan.AllowedDurations.forEach { m -> ChoicePill("$m min", duration == m, { duration = m }) } }
        PrimaryButton("Agree and add to demo calendar", { onBook(BookingPlan(day, time, duration)) })
        TextLink("Not now", onClose)
    }
}
