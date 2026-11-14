package app.depressify.shared.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.depressify.shared.state.*
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.resources.Res
import app.depressify.shared.resources.open_window
import app.depressify.shared.resources.quiet_path
import org.jetbrains.compose.resources.painterResource
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import app.depressify.core.LocalMinutes
import app.depressify.core.QuietHours
import app.depressify.core.SignalId
import app.depressify.core.SignalReading
import app.depressify.core.Outcome
import app.depressify.core.Summary
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight

@Composable
fun HistoryScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    Page(top = { BrandHeader { vm.showSheet(Sheet.Demo) } }, bottom = { TabBar(Route.History, vm::selectTab) }) {
        Txt("Your History", DepressifyType.display, c.ink, heading = true)
        if (s.historyLoad != HistoryLoad.Demo) {
            if (s.historyLoad == HistoryLoad.Loading) Txt("Loading your records…", DepressifyType.meta, c.muted)
            if (s.historyLoad == HistoryLoad.Failed) {
                Txt("Some records couldn't load. Your saved data is unchanged.", DepressifyType.meta, c.muted)
                TextLink("Try loading again", vm::loadHistory)
            }
            if (s.historyLoad == HistoryLoad.Ready || s.history.isNotEmpty() || s.historyDays.isNotEmpty()) HistoryContextRows(s)
        }
        if (!s.hasHistory) {
            if (s.historyLoad == HistoryLoad.Loading || s.historyLoad == HistoryLoad.Failed) return@Page
            Illustration(Modifier.fillMaxWidth().aspectRatio(1.5f))
            Txt("At your own pace.", DepressifyType.title, c.ink)
            Txt("Your first Summary will be here after a Check-in.", DepressifyType.body)
            PrimaryButton("Start Check-in", { vm.beginCheckIn(typed = false) })
            return@Page
        }
        if (s.historyLoad == HistoryLoad.Demo) {
            WeekBar(DemoData.week(s.history))
            if (s.consents[SignalId.Ratings] == true) TrendCard(s.history)
        }
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Txt("Your path", DepressifyType.title, c.ink, heading = true)
            JournalPath(s.history) { vm.open(Route.Summary(it.id)) }
        }
    }
}

/** Mood, Energy and Sleep quality for the week behind one switch. */
@Composable
private fun TrendCard(history: List<Summary>) {
    val c = Theme.colors
    var metric by rememberSaveable { mutableIntStateOf(0) }
    val names = listOf("Mood", "Energy", "Sleep quality")
    val week = DemoData.week(history).map { d ->
        d.day to history.firstOrNull { it.date == d.day + " November" }?.ratings?.let { r -> when (metric) { 0 -> r.mood; 1 -> r.energy; else -> r.sleepQuality } }
    }
    HealthCard {
        Segmented(names, metric) { metric = it }
        Txt("7–13 November · your ratings, from 1 to 5", DepressifyType.meta, c.muted)
        RatingChart(names[metric], week)
        Disclosure("View ratings") {
            week.forEach { (d, v) ->
                Row(Modifier.fillMaxWidth()) { Txt("$d November", DepressifyType.meta, modifier = Modifier.weight(1f)); Txt(v?.toString() ?: "—", DepressifyType.meta, c.ink) }
            }
        }
    }
}

/** Check-ins as steps on one line, newest first. */
@Composable
private fun JournalPath(history: List<Summary>, onOpen: (Summary) -> Unit) {
    val c = Theme.colors
    Column(
        Modifier.drawBehind { drawLine(c.border, Offset(18.dp.toPx(), 18.dp.toPx()), Offset(18.dp.toPx(), size.height - 18.dp.toPx()), 2.dp.toPx()) },
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        history.forEach { h ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.padding(top = 14.dp).size(36.dp).background(c.ground, CircleShape).border(2.dp, c.accent, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(h.suggestion.icon, 20.dp, c.accent)
                }
                Row(
                    Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(c.soft).clickable(role = Role.Button) { onOpen(h) }.padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Txt(h.date, DepressifyType.small, c.muted)
                        Txt(h.title, DepressifyType.bodyStrong.copy(fontWeight = FontWeight.SemiBold), c.ink)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            RatingDots(h.ratings.mood, "Mood")
                            if (h.previousOutcome is Outcome.Tried) Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(PhosphorIcons.check, 14.dp, c.ok); Spacer(Modifier.width(4.dp)); Txt("Tried", DepressifyType.small, c.ok)
                            }
                        }
                    }
                    Icon(PhosphorIcons.caretRight, 16.dp, c.muted)
                }
            }
        }
    }
}

/** Rating line with true gaps: unanswered days break the line and are never drawn as zero. */
@Composable
private fun RatingChart(label: String, week: List<Pair<String, Int?>>) {
    val c = Theme.colors
    val measurer = rememberTextMeasurer()
    val labelStyle = DepressifyType.small.copy(color = c.muted)
    val answered = week.count { it.second != null }
    Canvas(Modifier.fillMaxWidth().height(150.dp).semantics { contentDescription = "$label ratings for 7 to 13 November, $answered of 7 days answered. Gaps are unanswered days." }) {
        val left = 24.dp.toPx(); val right = size.width - 8.dp.toPx(); val top = 8.dp.toPx(); val bottom = size.height - 26.dp.toPx()
        val x = { i: Int -> left + i * (right - left) / (week.size - 1) }
        val y = { v: Int -> bottom - (v - 1) * (bottom - top) / 4f }
        for (v in listOf(1, 3, 5)) {
            drawLine(c.line, Offset(left, y(v)), Offset(right, y(v)), 1.dp.toPx())
            drawText(measurer, v.toString(), Offset(0f, y(v) - 9.dp.toPx()), labelStyle)
        }
        for (i in 1 until week.size) {
            val a = week[i - 1].second; val b = week[i].second
            if (a != null && b != null) drawLine(c.accent, Offset(x(i - 1), y(a)), Offset(x(i), y(b)), 2.5.dp.toPx())
        }
        // Unanswered days draw nothing: a marker on the axis would read as a rating of 1.
        week.forEachIndexed { i, (_, v) -> if (v != null) drawCircle(c.accent, 3.5.dp.toPx(), Offset(x(i), y(v))) }
        listOf(0, 3, 6).forEach { i -> drawText(measurer, week[i].first + " Nov", Offset(x(i) - (if (i == 0) 0f else if (i == 6) 40.dp.toPx() else 20.dp.toPx()), bottom + 8.dp.toPx()), labelStyle) }
    }
}

@Composable
fun SettingsScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    Page(top = { BrandHeader { vm.showSheet(Sheet.Demo) } }, bottom = { TabBar(Route.Settings, vm::selectTab) }, notice = s.notice) {
        Txt("Your Settings", DepressifyType.display, c.ink, heading = true)
        Column {
            ListRow("Signals", "Choose what you share", { vm.open(Route.Signals) })
            ListRow("Quiet hours", s.quietHours.start.label() + "–" + s.quietHours.end.label(), { vm.open(Route.QuietHours) })
            ListRow("Sharing & privacy", if (s.sharing) "Sharing with your Clinician" else "Sharing is off", { vm.open(Route.Privacy) })
            ListRow("Support", null, { vm.open(Route.Support) })
        }
        Txt("A little support, on your terms.", DepressifyType.meta, c.muted)
        TextLink("Explore prototype states", { vm.showSheet(Sheet.Demo) })
        Txt("Synthetic data · No services connected", DepressifyType.small, c.muted)
    }
}

@Composable
fun SignalsScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    Page(top = { TopBar("Signals", vm::back) }, notice = s.notice) {
        Txt("You choose each one. " + s.consents.count { it.value } + " of " + SignalId.entries.size + " are on.", DepressifyType.body)
        if (s.scenario == Scenario.BaselineBuilding) Notice("Building your Baseline · 3 of 5 valid days. Your own previous 14 days are used.")
        signalGroups.forEach { (group, ids) ->
            HealthCard {
                Txt(group, DepressifyType.small.copy(fontWeight = FontWeight.SemiBold), c.muted, heading = true)
                ids.forEach { id ->
                    val on = s.consents[id] == true
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { vm.selectSignal(id) },
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        IconTile(id.icon, on)
                        Column(Modifier.weight(1f)) {
                            Txt(id.label, DepressifyType.bodyStrong, c.ink)
                            Txt(readingLabel(id, on, s.scenario), DepressifyType.meta, c.muted)
                        }
                        Box(
                            Modifier.then(if (on) Modifier.background(c.accent.copy(alpha = 0.15f), CircleShape) else Modifier.border(1.dp, c.border, CircleShape)).padding(horizontal = 10.dp, vertical = 3.dp),
                        ) { Txt(if (on) "On" else "Off", DepressifyType.small.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal), if (on) c.accent else c.muted) }
                        Icon(PhosphorIcons.caretRight, 16.dp, c.muted)
                    }
                }
            }
        }
        Txt("Synthetic Signals. Device and synthetic data are never mixed.", DepressifyType.small, c.muted)
    }
}

private fun readingLabel(id: SignalId, on: Boolean, scenario: Scenario): String = when (DemoData.reading(id, on, scenario)) {
    SignalReading.NotCollected -> "Not collected"
    SignalReading.NoDataYet -> "No data yet"
    SignalReading.Unavailable -> "Unavailable on this device"
    is SignalReading.Value -> DemoData.readings[id] ?: id.sourceLabel
}

private val signalGroups = listOf(
    "Body" to listOf(SignalId.Sleep, SignalId.Steps, SignalId.HeartRate, SignalId.RestingHeartRate, SignalId.Hrv),
    "Places" to listOf(SignalId.TimeAtHome, SignalId.MovementRadius),
    "Your day" to listOf(SignalId.Calendar, SignalId.LateScreen),
    "Check-ins" to listOf(SignalId.Ratings, SignalId.VoiceObservations),
)

private val SignalId.icon: ImageVector
    get() = when (this) {
        SignalId.Sleep -> PhosphorIcons.moon
        SignalId.Steps -> PhosphorIcons.footprints
        SignalId.HeartRate -> PhosphorIcons.heart
        SignalId.RestingHeartRate -> PhosphorIcons.heartbeat
        SignalId.Hrv -> PhosphorIcons.pulse
        SignalId.TimeAtHome -> PhosphorIcons.houseLine
        SignalId.MovementRadius -> PhosphorIcons.mapPin
        SignalId.Calendar -> PhosphorIcons.calendarBlank
        SignalId.LateScreen -> PhosphorIcons.deviceMobile
        SignalId.Ratings -> PhosphorIcons.slidersHorizontal
        SignalId.VoiceObservations -> PhosphorIcons.waveform
    }

@Composable
fun SignalScreen(vm: PatientViewModel, s: PatientState, id: SignalId) {
    val c = Theme.colors
    val on = s.consents[id] == true
    val reading = DemoData.reading(id, on, s.scenario)
    Page(top = { TopBar(id.label, vm::back) }, notice = s.notice) {
        Txt("On your terms.", DepressifyType.title, c.ink, heading = true)
        Txt(DemoData.details[id] ?: "", DepressifyType.body)
        SoftCard {
            Txt(id.sourceLabel, DepressifyType.small, c.muted)
            Txt(when (reading) {
                SignalReading.NotCollected -> "Not collected"
                SignalReading.NoDataYet -> "No data yet"
                SignalReading.Unavailable -> "Unavailable on this device"
                is SignalReading.Value -> DemoData.readings[id] ?: "Collected"
            }, DepressifyType.body, c.ink)
        }
        when {
            reading == SignalReading.Unavailable -> Notice("This Signal is unavailable. Check-ins still work.")
            on -> PrimaryButton("Stop and delete", { vm.showSheet(Sheet.DeleteSignal) })
            else -> PrimaryButton("Allow this Signal", { vm.allowSignal(id) })
        }
        Txt("You can change this choice at any time.", DepressifyType.meta, c.muted)
    }
}

@Composable
fun QuietHoursScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    var start by remember { mutableStateOf(s.quietHours.start) }
    var end by remember { mutableStateOf(s.quietHours.end) }
    var error by remember { mutableStateOf(false) }
    Page(top = { TopBar("Quiet hours", vm::back) }, notice = s.notice) {
        Txt("Room for quiet.", DepressifyType.title, c.ink, heading = true)
        Txt("No Nudges during these hours.", DepressifyType.body)
        TimeStepper("From", start) { start = it; error = false }
        TimeStepper("Until", end) { end = it; error = false }
        Txt("Local time · overnight ranges are welcome.", DepressifyType.meta, c.muted)
        if (error) Notice("Choose two different times.", error = true)
        PrimaryButton("Save quiet hours", { error = !vm.saveQuietHours(QuietHours(start, end)) })
        Txt("Nudges", DepressifyType.titleSmall, c.ink, heading = true)
        Txt("At most one a day, outside quiet hours and when you’re not busy.", DepressifyType.meta)
        Switch(s.nudges, vm::setNudges, "Nudges")
        Txt("Notification access is simulated. Declining keeps Check-ins available.", DepressifyType.small, c.muted)
    }
}

@Composable
private fun TimeStepper(label: String, value: LocalMinutes, onChange: (LocalMinutes) -> Unit) {
    val c = Theme.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Txt(label, DepressifyType.meta, c.muted, Modifier.padding(start = 8.dp).width(56.dp))
        IconButton(PhosphorIcons.minus, "Earlier", { onChange(value.plus(-30)) })
        Txt(value.label(), DepressifyType.title.copy(fontWeight = null), c.ink, Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }, align = TextAlign.Center)
        IconButton(PhosphorIcons.plus, "Later", { onChange(value.plus(30)) })
    }
}

@Composable
fun PrivacyScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    Page(top = { TopBar("Sharing & privacy", vm::back) }, notice = s.notice) {
        Txt("You’re in control.", DepressifyType.title, c.ink, heading = true)
        SoftCard {
            Txt(DemoData.ClinicianName, DepressifyType.bodyStrong, c.ink)
            Txt(if (s.sharing) "Your Clinician sees shared progress." else "Sharing is off.", DepressifyType.body)
            Txt("Fictional demo Clinician", DepressifyType.small, c.muted)
        }
        SecondaryButton(if (s.sharing) "Stop sharing" else "Share future progress", { if (s.sharing) vm.showSheet(Sheet.StopSharing) else vm.setSharing(true) })
        Disclosure("What is shared?") { Txt("Summaries, chosen daily Signal totals, ratings and progress. Never raw audio or a full saved transcript.", DepressifyType.meta) }
        Disclosure("AI processing & retention") {
            Txt("Voice audio streams to the AI provider during a Check-in. The transcript is used once for your Summary, then deleted.", DepressifyType.meta)
            Txt("Provider retention is separate from app deletion. This prototype uses no AI service.", DepressifyType.meta)
        }
        Disclosure("Google Maps information") { Txt("Place and weather answers may include Google Maps information. Sources appear beside results.", DepressifyType.meta) }
        TextLink("Manage each Signal", { vm.open(Route.Signals) })
    }
}

@Composable
fun SupportScreen(vm: PatientViewModel) {
    val c = Theme.colors
    Page(top = { TopBar("Support", vm::back) }) {
        Txt("A little human support.", DepressifyType.title, c.ink, heading = true)
        Txt("The Companion offers wellbeing support. It doesn’t diagnose or advise on treatment.", DepressifyType.body)
        SoftCard {
            Txt("Your Clinician", DepressifyType.titleSmall, c.ink)
            Txt("Use your usual contact arrangements. This app is not monitored continuously.", DepressifyType.meta)
        }
        SecondaryButton("Preview help options", { vm.open(Route.Crisis) })
        Txt("Demo only. Help actions never place a call.", DepressifyType.small, c.muted)
    }
}

/** Crisis notice: shown before any network call. The Patient places any call; the app never dials. */
@Composable
fun CrisisScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    Page(top = { TopBar("Support", null) }) {
        Spacer(Modifier.height(16.dp))
        Txt("Let’s find\nhuman support.", DepressifyType.display, c.ink, heading = true)
        Txt("You don’t have to handle this alone.", DepressifyType.body)
        SoftCard {
            Txt("Demo help options open a simulated dialler.", DepressifyType.meta)
            PrimaryButton("Find urgent help", { vm.showSheet(Sheet.Dialler) })
            SecondaryButton("Contact someone you trust", { vm.showSheet(Sheet.Dialler) })
        }
        Txt(if (s.offline) "Offline · Clinician notice queued, not delivered." else "Demo · Clinician notice simulated, not delivered.", DepressifyType.small, c.muted,
            Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        TextLink("Keep talking", vm::keepTalkingAfterCrisis)
        TextLink("Return to Today", { vm.selectTab(Route.Today) })
    }
}

private val SignalId.sourceLabel: String get() = if (source == "Health Connect") app.depressify.shared.healthSource else source
