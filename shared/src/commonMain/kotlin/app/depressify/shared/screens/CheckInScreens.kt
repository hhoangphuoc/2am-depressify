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
import app.depressify.shared.resources.quiet_path
import org.jetbrains.compose.resources.painterResource
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.withStyle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.depressify.core.Outcome
import app.depressify.core.SignalId
import app.depressify.core.SuggestionKind
import app.depressify.shared.voice.*
import app.depressify.shared.voice.live.ToolCard
import app.depressify.shared.voice.live.createClipPlayer
import app.depressify.shared.voice.live.MusicPlayback
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalFocusManager

@Composable
fun CheckInIntroScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    val mustType = s.scenario == Scenario.MicDeclined
    Page(top = { TopBar("Your Check-in", vm::back) }) {
        Txt("A moment for you.", DepressifyType.title, c.ink, heading = true)
        Txt("I’m an AI Companion, not a clinician.", DepressifyType.body)
        SoftCard {
            Txt("We’ll talk or type, then save a short Summary.", DepressifyType.body)
            Txt(if (s.sharing) "You and your Clinician see the same Summary." else "Sharing is off. Your Clinician won’t see this Check-in.", DepressifyType.meta, c.muted)
        }
        Disclosure("About your conversation") {
            Txt("Voice audio streams to the AI provider. The transcript is used for your Summary, then deleted. Provider retention is separate.", DepressifyType.meta)
            Txt("Place suggestions may use Google Maps, with sources beside them. Music made during a Check-in stays here only for this conversation.", DepressifyType.meta)
        }
        if (mustType) Notice("Microphone access was declined. You can still type.")
        val typed = s.typed || mustType
        PrimaryButton(if (typed) "Start typing" else "Start Check-in", { vm.startCheckIn(typed) })
        TextLink(if (typed && !mustType) "Speak instead" else "Type instead", { vm.startCheckIn(!typed || mustType) }, Modifier.align(Alignment.CenterHorizontally))
    }
}

@Composable
fun CheckInScreen(vm: PatientViewModel, s: PatientState) {
    val snap by vm.live.snapshot.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val playback = remember(vm.live) {
        MusicPlayback(createClipPlayer(), scope, { vm.live.snapshot.value.muted }, vm.live::setMuted, vm.live::interrupt, vm.live::setCompanionAudioPaused)
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var listening by remember { mutableStateOf(false) }
    fun openListening() { playback.enterListening(); listening = true }
    fun closeListening() { playback.leaveListening(); listening = false }
    DisposableEffect(playback, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) playback.onBackground() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); playback.stop(); playback.leaveListening(); vm.live.setMuted(true) }
    }
    if (s.typed) TypedCheckInScreen(vm, s, playback, ::openListening) else VoiceCheckInScreen(vm, s, snap, playback, ::openListening)
    if (listening) snap.cards.filterIsInstance<ToolCard.Music>().lastOrNull()?.let { card ->
        MusicListeningScreen(card, playback, ::closeListening) { vm.live.sendText("Could you try making that music again?") }
    }
}

@Composable
private fun VoiceCheckInScreen(vm: PatientViewModel, s: PatientState, snap: LiveSnapshot, playback: MusicPlayback, onOpenMusic: () -> Unit) {
    val c = Theme.colors
    val state = snap.shownState
    val line = snap.event.speaker?.let { sp -> snap.event.text?.let { TranscriptLine(sp, it) } }
    val compact = snap.offer != null || snap.cards.isNotEmpty()
    val isLive = vm.live.isLive
    Page(
        top = { TopBar("Check-in", onBack = { vm.showSheet(Sheet.Leave) }, trailing = { TextLink("Finish", vm::finishCheckIn, Modifier.padding(end = 12.dp)) }) },
        bottom = { LiveControls(muted = snap.muted, onType = { playback.pause(); vm.setTyped(true) }, onMic = { val muted = !snap.muted; playback.pause(); vm.live.setMuted(muted) }, onEnd = vm::finishCheckIn) },
    ) {
        if (!snap.connected) {
            Notice("What you’ve said so far is kept.", title = "Connection lost") {
                SecondaryButton("Try again", { vm.live.setConnected(true) })
                TextLink("Finish with what we have", vm::finishCheckIn)
            }
        }
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 12.dp)) {
            Orb(state, if (compact) 88.dp else 164.dp, onInterrupt = vm.live::interrupt)
            val label = when {
                !snap.connected -> "Not connected"
                state == LiveState.Thinking -> snap.event.tool ?: state.label
                state == LiveState.Speaking -> "Speaking · tap to interrupt"
                else -> state.label
            }
            Txt(label, DepressifyType.meta, c.muted, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, align = TextAlign.Center)
        }
        LiveCaption(
            line = if (snap.muted || !snap.connected) null else line,
            placeholder = when {
                !snap.connected -> ""
                snap.muted -> "Paused. Tap the microphone to go on, or type."
                state == LiveState.Connecting || state == LiveState.Thinking -> ""
                else -> "Listening. Speak whenever you’re ready."
            },
            compact = compact,
        )
        val outcome = snap.outcome
        if (outcome is Outcome.Tried && !compact) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Icon(PhosphorIcons.check, 16.dp, c.ok)
                Spacer(Modifier.width(8.dp))
                Txt("Noted: walk tried" + (outcome.feeling?.let { " · felt $it of 5" } ?: ""), DepressifyType.meta, c.ok)
            }
        }
        snap.offer?.let { kind ->
            if (kind != SuggestionKind.Music || snap.cards.none { it is ToolCard.Music })
            SuggestionCard(kind, accepted = snap.accepted, booked = s.booking != null, showFinish = false, detail = snap.offerDetails,
                onAccept = { playback.pause(); vm.reply(Reply.Accept) }, onSmaller = { playback.pause(); vm.reply(Reply.Smaller) }, onDecline = { playback.pause(); vm.reply(Reply.Decline) },
                onBook = { vm.showSheet(Sheet.Booking) }, onFinish = vm::finishCheckIn)
        }
        // What the Companion's tool calls found or opened, newest first.
        SessionToolCards(snap.cards, playback, onOpenMusic, musicActions = { MusicOfferActions(vm, s, snap, playback) })
        if (snap.wrapped) PrimaryButton(if (s.consents[SignalId.Ratings] == true) "Continue to ratings" else "Finish Check-in", vm::finishCheckIn)
        if (snap.transcript.isNotEmpty()) {
            Disclosure("Conversation · ${snap.transcript.size} messages") {
                snap.transcript.forEach { t ->
                    Column { Txt(t.speaker.label, DepressifyType.small, c.muted); Txt(t.text, DepressifyType.meta.copy(fontSize = DepressifyType.body.fontSize)) }
                }
            }
        }
        if (!isLive || snap.cards.any { it is ToolCard.Places }) MapsNotice { vm.showSheet(Sheet.MapsSources) }
    }
}

@Composable
private fun TypedCheckInScreen(vm: PatientViewModel, s: PatientState, playback: MusicPlayback, onOpenMusic: () -> Unit) {
    val c = Theme.colors
    val t = s.typedCheckIn
    val snap by vm.live.snapshot.collectAsStateWithLifecycle()
    val scroll = rememberScrollState()
    LaunchedEffect(t.lines.size) { scroll.scrollTo(0) }
    Page(
        top = { TopBar("Check-in", onBack = { vm.showSheet(Sheet.Leave) }, trailing = { TextLink("Finish", vm::finishCheckIn, Modifier.padding(end = 12.dp)) }) },
        bottom = { Composer(onSend = { text -> playback.pause(); vm.sendTyped(text) }, onVoice = if (s.scenario == Scenario.MicDeclined) null else ({ playback.pause(); vm.setTyped(false) })) },
        scrollState = scroll,
    ) {
        Txt(if (vm.live.isLive) "Type at your own pace. Your microphone is off." else "Typing · demo conversation", DepressifyType.small, c.muted)
        if (!snap.connected) Notice("Your conversation is still here. Reconnect to continue.", title = "Connection lost") {
            TextLink("Try again", { vm.live.setConnected(true) })
        }
        t.lines.takeLast(2).forEach { l ->
            if (l.speaker == Speaker.You) {
                Column(Modifier.padding(start = 20.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.soft).padding(16.dp)) {
                    Txt(l.speaker.label, DepressifyType.small, c.muted); Txt(l.text, DepressifyType.body, c.ink)
                }
            } else Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { Txt(l.speaker.label, DepressifyType.small, c.muted); Txt(l.text, DepressifyType.bodyLarge, c.ink) }
        }
        if (t.outcome == null && t.offer == null && s.hasHistory && !vm.live.isLive) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SecondaryButton("I tried it", { vm.typedOutcome(Outcome.Tried(null), "I tried the walk.") })
                TextLink("Not this time", { vm.typedOutcome(Outcome.NotThisTime, "Not this time.") })
                TextLink("Prefer not to say", { vm.typedOutcome(Outcome.PreferNotToSay, "I’d rather not say.") })
            }
        }
        val o = t.outcome
        if (o is Outcome.Tried) {
            Txt("How did it feel?", DepressifyType.titleSmall, c.ink, heading = true)
            RatingRow(o.feeling, vm::typedFeeling, "Not helpful", "Very helpful", "Feeling")
        }
        t.offer?.let { kind ->
            if (kind != SuggestionKind.Music || snap.cards.none { it is ToolCard.Music })
            SuggestionCard(kind, accepted = t.accepted, booked = s.booking != null, showFinish = true, detail = t.offerDetails,
                onAccept = { playback.pause(); vm.reply(Reply.Accept) }, onSmaller = { playback.pause(); vm.reply(Reply.Smaller) }, onDecline = { playback.pause(); vm.reply(Reply.Decline) },
                onBook = { vm.showSheet(Sheet.Booking) }, onFinish = vm::finishCheckIn)
        }
        // What the Companion's tool calls found or made, newest first.
        if (vm.live.isLive) SessionToolCards(snap.cards, playback, onOpenMusic, musicActions = { MusicOfferActions(vm, s, snap, playback) })
        if (t.lines.size > 2) Disclosure("Earlier messages · ${t.lines.size - 2}") {
            t.lines.dropLast(2).forEach { line -> Column {
                Txt(line.speaker.label, DepressifyType.small, c.muted)
                Txt(line.text, DepressifyType.body, c.ink)
            } }
        }
        if (!vm.live.isLive || snap.cards.any { it is ToolCard.Places }) MapsNotice { vm.showSheet(Sheet.MapsSources) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MusicOfferActions(vm: PatientViewModel, s: PatientState, snap: LiveSnapshot, playback: MusicPlayback) {
    if (snap.offer != SuggestionKind.Music) return
    fun reply(value: Reply) { playback.pause(); vm.reply(value) }
    if (snap.accepted) {
        Txt("Chosen for this Check-in", DepressifyType.meta, Theme.colors.ok)
        TextLink(if (s.booking == null) "Make a little time" else "View your plan", { vm.showSheet(Sheet.Booking) })
    } else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TextLink("That works", { reply(Reply.Accept) }, Modifier.heightIn(min = 48.dp).padding(horizontal = 8.dp))
        TextLink("Smaller", { reply(Reply.Smaller) }, Modifier.heightIn(min = 48.dp).padding(horizontal = 8.dp))
        TextLink("Not now", { reply(Reply.Decline) }, Modifier.heightIn(min = 48.dp).padding(horizontal = 8.dp))
    }
}

@Composable
fun SuggestionCard(
    kind: SuggestionKind, accepted: Boolean, booked: Boolean, showFinish: Boolean,
    onAccept: () -> Unit, onSmaller: () -> Unit, onDecline: () -> Unit, onBook: () -> Unit, onFinish: () -> Unit,
    detail: String? = null,
) {
    val c = Theme.colors
    SoftCard(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
        Txt("Your Suggestion", DepressifyType.meta, c.muted)
        Txt(kind.title, DepressifyType.title.copy(fontSize = DepressifyType.caption.fontSize), c.ink, heading = true)
        Txt(detail ?: kind.detail, DepressifyType.meta)
        if (accepted) {
            Row(verticalAlignment = Alignment.CenterVertically) { Icon(PhosphorIcons.check, 16.dp, c.ok); Spacer(Modifier.width(8.dp)); Txt("A small plan, chosen by you.", DepressifyType.meta, c.ok) }
            TextLink(if (booked) "View calendar plan" else "Add to calendar", onBook)
            if (showFinish) PrimaryButton("Finish Check-in", onFinish)
        } else {
            PrimaryButton("That works", onAccept)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally)) {
                TextLink("Something smaller", onSmaller)
                TextLink("Not now", onDecline)
            }
        }
    }
}

@Composable
fun MapsNotice(onSources: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Txt("Place answers may use ", DepressifyType.small, Theme.colors.muted)
        TextLink("Google Maps", onSources, color = Theme.colors.muted)
    }
}

@Composable
fun CheckSteps(step: Int) {
    val c = Theme.colors
    val name = LiveScript.steps[step.coerceIn(0, 3)]
    Column(Modifier.clearAndSetSemantics { contentDescription = "Step " + (step + 1) + " of 4, " + name }, horizontalAlignment = Alignment.CenterHorizontally) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            repeat(4) { i -> Box(Modifier.size(28.dp, 4.dp).clip(CircleShape).background(if (i <= step) c.accent.copy(alpha = if (i < step) 0.55f else 1f) else c.border)) }
        }
        Spacer(Modifier.height(6.dp))
        Txt(name, DepressifyType.small, c.muted)
    }
}

/** The provider already streams words; show them immediately, without a second typewriter delay. */
@Composable
fun LiveCaption(line: TranscriptLine?, placeholder: String, compact: Boolean) {
    val c = Theme.colors
    Column(
        Modifier.fillMaxWidth().heightIn(min = if (compact) 0.dp else 116.dp)
            .clearAndSetSemantics { liveRegion = LiveRegionMode.Polite; contentDescription = line?.let { it.speaker.label + ": " + it.text } ?: placeholder },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (line != null) {
            Txt(line.speaker.label.uppercase(), DepressifyType.label, c.muted)
            BasicText(line.text, style = (if (compact) DepressifyType.body else DepressifyType.bodyLarge).copy(color = c.ink, textAlign = TextAlign.Center))
        } else if (placeholder.isNotEmpty()) {
            Txt(placeholder, DepressifyType.body.copy(fontSize = DepressifyType.titleSmall.fontSize), c.muted, align = TextAlign.Center)
        }
    }
}

@Composable
private fun LiveControls(muted: Boolean, onType: () -> Unit, onMic: () -> Unit, onEnd: () -> Unit) {
    val c = Theme.colors
    Row(
        Modifier.fillMaxWidth().background(c.ground).windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 28.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SideControl(PhosphorIcons.keyboard, "Type", onType, Modifier.weight(1f), Alignment.Start)
        Box(
            Modifier.size(72.dp).clip(CircleShape).background(if (muted) c.soft else c.ink)
                .clickable(role = Role.Switch, onClick = onMic)
                .semantics { contentDescription = if (muted) "Turn microphone on" else "Turn microphone off"; stateDescription = if (muted) "Off" else "On" },
            contentAlignment = Alignment.Center,
        ) { Icon(if (muted) PhosphorIcons.microphoneSlash else PhosphorIcons.microphone, 30.dp, if (muted) c.ink else c.onInk) }
        SideControl(PhosphorIcons.x, "Finish", onEnd, Modifier.weight(1f), Alignment.End)
    }
}

@Composable
private fun SideControl(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit, modifier: Modifier, align: Alignment.Horizontal) {
    Box(modifier, contentAlignment = if (align == Alignment.Start) Alignment.CenterStart else Alignment.CenterEnd) {
        Column(Modifier.sizeIn(minWidth = 56.dp, minHeight = 56.dp).clickable(role = Role.Button, onClick = onClick), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(icon, 24.dp, Theme.colors.ink)
            Txt(label, DepressifyType.small, Theme.colors.muted)
        }
    }
}

@Composable
private fun Composer(onSend: (String) -> Unit, onVoice: (() -> Unit)?) {
    val c = Theme.colors
    val focus = LocalFocusManager.current
    var text by rememberSaveable { mutableStateOf("") }
    val send = { text.trim().takeIf { it.isNotEmpty() }?.let { focus.clearFocus(); onSend(it); text = "" }; Unit }
    Column(Modifier.fillMaxWidth().background(c.ground).imePadding().windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 20.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt("Typing", DepressifyType.small, c.muted, Modifier.weight(1f))
            if (onVoice != null) TextLink("Use voice", onVoice)
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.field).border(1.dp, c.border, RoundedCornerShape(24.dp)).padding(start = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                text, { text = it }, Modifier.weight(1f).padding(vertical = 12.dp).semantics { contentDescription = "Write a reply" },
                textStyle = DepressifyType.body.copy(color = c.ink), cursorBrush = SolidColor(c.ink), maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }),
                decorationBox = { inner -> Box { if (text.isEmpty()) Txt("Write a reply", DepressifyType.body, c.muted); inner() } },
            )
            Box(Modifier.size(48.dp).clickable(enabled = text.isNotBlank(), role = Role.Button) { send() }.semantics { contentDescription = "Send reply" }, contentAlignment = Alignment.Center) {
                Icon(PhosphorIcons.paperPlaneTilt, 20.dp, if (text.isNotBlank()) c.ink else c.muted)
            }
        }
    }
}

@Composable
fun RatingsScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    val step = s.ratingStep
    val value = when (step) { 0 -> s.ratings.mood; 1 -> s.ratings.energy; else -> s.ratings.sleepQuality }
    Page(top = { TopBar("Your ratings", null) }) {
        Spacer(Modifier.height(24.dp))
        Txt("Before you go · " + (step + 1) + " of 3", DepressifyType.meta, c.muted)
        Txt(listOf("How is your mood?", "How is your energy?", "How was your sleep?")[step], DepressifyType.title, c.ink, heading = true)
        Txt("Just how it feels to you.", DepressifyType.body)
        RatingRow(value, { vm.rate(it) }, if (step == 2) "Very poor" else "Very low", if (step == 1) "Very high" else "Very good", listOf("Mood", "Energy", "Sleep quality")[step])
        Spacer(Modifier.height(12.dp))
        PrimaryButton(if (step < 2) "Continue" else "Make my Summary", vm::nextRating, enabled = value != null)
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            TextLink("Skip this question", { vm.rate(null); vm.nextRating() })
            if (step > 0) TextLink("Previous question", vm::previousRating)
        }
    }
}

@Composable
fun FinishingScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    val saving = s.finish == FinishState.Saving
    Page(top = { TopBar("Your Check-in", null) }) {
        Illustration(Modifier.fillMaxWidth().height(160.dp))
        Txt("A little space\nto reflect.", DepressifyType.display, c.ink, heading = true)
        Txt(if (saving) "Making your Summary…" else "Your conversation has ended.", DepressifyType.body, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        Txt(if (s.sharing) "Your Summary will be shared with your Clinician." else "Sharing is off. Your Summary stays in your history.", DepressifyType.meta, c.muted)
        if (s.finish == FinishState.Failed) {
            Notice("That didn’t save. Nothing was invented, and your conversation is still here.", error = true) { TextLink("Try again", vm::retrySummary, color = c.error) }
        }
        PrimaryButton(if (saving) "Making your Summary…" else "Make my Summary", vm::makeSummary, enabled = !saving)
        TextLink("Leave without a Summary", { vm.showSheet(Sheet.Leave) }, Modifier.align(Alignment.CenterHorizontally))
    }
}

@Composable
fun SummaryScreen(vm: PatientViewModel, s: PatientState, id: String) {
    val c = Theme.colors
    val summary = s.history.firstOrNull { it.id == id } ?: return
    Page(top = { TopBar("Your Summary", vm::back) }) {
        Txt(summary.date + " · AI-generated", DepressifyType.meta, c.muted)
        Txt(summary.title, DepressifyType.title, c.ink, heading = true)
        Txt(summary.text, DepressifyType.bodyLarge)
        HealthCard {
            Txt("How you felt", DepressifyType.meta, c.muted)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf(
                    Triple("Mood", PhosphorIcons.sunHorizon, summary.ratings.mood),
                    Triple("Energy", PhosphorIcons.lightning, summary.ratings.energy),
                    Triple("Sleep quality", PhosphorIcons.moon, summary.ratings.sleepQuality),
                ).forEach { (label, icon, v) ->
                    Column(
                        Modifier.weight(1f).clearAndSetSemantics { contentDescription = label + ", " + (v?.let { "$it of 5" } ?: "not answered") },
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        IconTile(icon)
                        Txt(label, DepressifyType.label.copy(letterSpacing = DepressifyType.body.letterSpacing), c.muted)
                        BasicText(buildAnnotatedString {
                            append(v?.toString() ?: "—")
                            if (v != null) withStyle(SpanStyle(fontSize = DepressifyType.meta.fontSize, color = c.muted)) { append(" / 5") }
                        }, style = DepressifyType.title.copy(fontWeight = null, color = c.ink))
                        RatingDots(v, label)
                    }
                }
            }
        }
        HealthCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                IconTile(summary.suggestion.icon, size = 44.dp)
                Column {
                    Txt("Your next small step", DepressifyType.meta, c.muted)
                    Txt(summary.suggestion?.title ?: "None chosen this time", DepressifyType.titleSmall, c.ink)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IconTile(PhosphorIcons.check)
            Txt("Last time · " + when (val o = summary.previousOutcome) {
                is Outcome.Tried -> "Tried it." + (o.feeling?.let { " Felt $it out of 5." } ?: "")
                Outcome.NotThisTime -> "Not this time."
                Outcome.PreferNotToSay -> "Preferred not to say."
                null -> "Not discussed."
            }, DepressifyType.meta, modifier = Modifier.weight(1f))
        }
        if (s.consents[SignalId.VoiceObservations] == true && summary.voiceObservation != null) {
            Disclosure("Voice observations") { Txt(summary.voiceObservation + ". An AI observation, not a diagnosis.", DepressifyType.meta) }
        }
        Txt(if (s.sharing) "This is the same Summary your Clinician sees." else "Sharing is off.", DepressifyType.meta, c.muted)
        PrimaryButton("Back to Today", { vm.selectTab(Route.Today) })
    }
}

@Composable
fun SuggestionScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    Page(top = { TopBar("Your Suggestion", vm::back) }, notice = s.notice) {
        Image(painterResource(Res.drawable.quiet_path), "Illustrative quiet lakeside path", contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().height(200.dp).clip(RoundedCornerShape(16.dp)).graphicsLayer { alpha = if (c.night) 0.82f else 1f })
        Txt("A little time outside", DepressifyType.title, c.ink, heading = true)
        Txt("A short walk, at your own pace. No distance to reach.", DepressifyType.body)
        PrimaryButton(if (s.booking != null) "View your plan" else "Make a little time", { vm.showSheet(Sheet.Booking) })
        TextLink("Something smaller", { vm.setNotice("We can keep it smaller: one minute by a window.") })
        Disclosure("Place sources") {
            Txt("Example: Töölönlahti, Helsinki. Illustrative place, not a live search result.", DepressifyType.meta)
            TextLink("Open in Google Maps", { uri.openUri("https://www.google.com/maps/search/?api=1&query=T%C3%B6%C3%B6l%C3%B6nlahti%20Helsinki") })
            Txt("Walking routes may omit paths or sidewalks. Check local conditions.", DepressifyType.small, c.muted)
        }
        if (s.hasHistory) TextLink("View related Summary", { vm.open(Route.Summary(s.history.first().id)) })
    }
}
