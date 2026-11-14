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
import app.depressify.shared.resources.nearby_map
import org.jetbrains.compose.resources.painterResource
import app.depressify.core.greetingFor
import app.depressify.core.isNightHour
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import app.depressify.shared.ui.theme.DayColors
import app.depressify.shared.voice.LiveState
import app.depressify.shared.voice.Orb
import app.depressify.core.model.SuggestionKind
import app.depressify.shared.voice.live.mapsSearchUrl
import app.depressify.shared.voice.live.musicSearchUrl

@Composable
fun TodayScreen(vm: PatientViewModel, s: PatientState, hour: Int) {
    val c = Theme.colors
    val night = c.night
    Page(top = { BrandHeader { vm.showSheet(Sheet.Demo) } }, bottom = { TabBar(Route.Today, vm::selectTab) }, notice = s.notice) {
        if (s.offline) Notice("You’re offline. Saved content is still here.") { TextLink("Reconnect", { vm.applyScenario(Scenario.Everyday) }) }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(greetingFor(if (night && !isNightHour(hour)) 23 else hour, DemoData.PatientName), DepressifyType.meta, c.muted)
            Txt(if (night) "Nights can\nfeel long." else "One small thing\nis enough.", DepressifyType.todayHeadline, c.ink, heading = true)
            Txt(if (night) "I’m here if you want company." else "A few minutes, at your pace.", DepressifyType.bodyLarge, c.muted)
        }
        CheckInCard(night, onTalk = { vm.beginCheckIn(typed = false) }, onType = { vm.beginCheckIn(typed = true) })
        if (s.todayLoad != TodayLoad.Demo) TodaySuggestionsCard(s, onRetry = vm::loadTodaySuggestions)
        if (s.hasHistory) {
            WeekBar(DemoData.week(s.history))
            if (s.todayLoad == TodayLoad.Demo) PlacesCard(night) { vm.open(Route.Suggestion) }
        } else {
            Txt("You can start wherever you are.", DepressifyType.meta, c.muted, Modifier.fillMaxWidth().padding(top = 16.dp), align = TextAlign.Center)
        }
    }
}

/** The one invitation on Today: the date, a still orb, and two ways to begin. */
@Composable
private fun CheckInCard(night: Boolean, onTalk: () -> Unit, onType: () -> Unit) {
    val c = Theme.colors
    HealthCard {
        Row(Modifier.fillMaxWidth()) {
            Txt(DemoData.TodayShort, DepressifyType.small, c.muted, Modifier.weight(1f))
            Txt("About 3 min · AI Companion", DepressifyType.small, c.muted)
        }
        Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Orb(LiveState.Listening, 112.dp, onInterrupt = {}, still = true)
            Txt(if (night) "Talk for a bit" else "Your Check-in", DepressifyType.title, c.ink, heading = true)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PrimaryButton("Talk", onTalk, Modifier.weight(1.4f), icon = PhosphorIcons.microphone)
            SecondaryButton("Type", onType, Modifier.weight(1f), icon = PhosphorIcons.keyboard)
        }
    }
}

private val Place.icon: ImageVector
    get() = when (kind) { "Park" -> PhosphorIcons.tree; "Yoga" -> PhosphorIcons.personSimpleTaiChi; else -> PhosphorIcons.flowerLotus }

private val SuggestionKind.label: String
    get() = when (this) {
        SuggestionKind.walk -> "Walk"
        SuggestionKind.nature -> "Nature"
        SuggestionKind.music -> "Music"
        SuggestionKind.social_call -> "Call"
        SuggestionKind.breathing -> "Breathing"
        SuggestionKind.class_activity -> "Class"
        SuggestionKind.daylight -> "Daylight"
    }

private val SuggestionKind.icon: ImageVector
    get() = when (this) {
        SuggestionKind.walk -> PhosphorIcons.personSimpleWalk
        SuggestionKind.nature -> PhosphorIcons.tree
        SuggestionKind.music -> PhosphorIcons.musicNotes
        SuggestionKind.social_call -> PhosphorIcons.phone
        SuggestionKind.breathing -> PhosphorIcons.flowerLotus
        SuggestionKind.class_activity -> PhosphorIcons.personSimpleTaiChi
        SuggestionKind.daylight -> PhosphorIcons.sunHorizon
    }

/**
 * Today's Suggestions for the signed-in Patient, made by Suggest today from their own Context:
 * what to do and why, real places near them on a Google map, and music to play.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TodaySuggestionsCard(s: PatientState, onRetry: () -> Unit) {
    val c = Theme.colors
    val uri = LocalUriHandler.current
    HealthCard {
        Row(Modifier.fillMaxWidth()) {
            Txt("For you today", DepressifyType.small, c.muted, Modifier.weight(1f))
            Txt("AI Companion", DepressifyType.small, c.muted)
        }
        val today = s.today
        if (today == null) {
            if (s.todayLoad == TodayLoad.Loading) Txt("Looking at your recent days for something small…", DepressifyType.meta, c.muted)
            else {
                Txt("Your Suggestions could not be loaded.", DepressifyType.meta, c.body)
                TextLink("Try again", onRetry)
            }
            return@HealthCard
        }
        var current by rememberSaveable(today) { mutableIntStateOf(0) }
        var selectedPlace by rememberSaveable(today, current) { mutableIntStateOf(0) }
        val suggestion = today.suggestions[current.coerceIn(today.suggestions.indices)]
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            today.suggestions.forEachIndexed { i, x -> ChoicePill(x.kind.label, i == current, { current = i }, icon = x.kind.icon) }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Txt(suggestion.details, DepressifyType.bodyStrong.copy(fontWeight = FontWeight.SemiBold), c.ink)
            if (suggestion.reason.isNotBlank()) Txt(suggestion.reason, DepressifyType.meta, c.muted)
        }
        if (suggestion.places.isNotEmpty()) {
            PlacesMap(today.location, suggestion.places, selectedPlace, { selectedPlace = it }, Modifier.fillMaxWidth().aspectRatio(1.6f).clip(RoundedCornerShape(14.dp)))
            Column {
                suggestion.places.forEachIndexed { i, place ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { selectedPlace = i }.semantics { selected = i == selectedPlace },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(PhosphorIcons.mapPin, 18.dp, if (i == selectedPlace) c.accent else c.muted)
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Txt(place.name, DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold), c.ink)
                            if (place.address.isNotBlank()) Txt(place.address, DepressifyType.small, c.muted)
                        }
                        TextLink("Maps", { uri.openUri(place.mapsUrl) }, Modifier.semantics { contentDescription = "Open " + place.name + " in Google Maps" }, trailing = PhosphorIcons.arrowSquareOut)
                    }
                }
            }
            // The Maps terms ask for the source beside place content shown off the map.
            Txt("Places from Google Maps" + (today.location?.let { ", near " + it.label.replaceFirstChar(Char::lowercase) } ?: ""), DepressifyType.small, c.muted)
        } else suggestion.placeQuery?.let { query ->
            TextLink("Search “$query” in Google Maps", { uri.openUri(mapsSearchUrl(query)) }, trailing = PhosphorIcons.arrowSquareOut)
        }
        suggestion.music.forEach { pick ->
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(PhosphorIcons.musicNotes, 18.dp, c.accent)
                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                    Txt(pick.title, DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold), c.ink)
                    Txt(pick.artist, DepressifyType.small, c.muted)
                }
                TextLink("Listen", { uri.openUri(musicSearchUrl(pick.title + " " + pick.artist)) }, Modifier.semantics { contentDescription = "Find " + pick.title + " by " + pick.artist + " in your music app" }, trailing = PhosphorIcons.arrowSquareOut)
            }
        }
        Txt("Made by AI from your own Check-ins and Signals. Wellbeing ideas, not treatment advice.", DepressifyType.small, c.muted)
    }
}

/** Nearby places for a next small step, with a link out to Google Maps and a row that opens the current Suggestion. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlacesCard(night: Boolean, onSuggestion: () -> Unit) {
    val c = Theme.colors
    val uri = LocalUriHandler.current
    var selected by rememberSaveable { mutableIntStateOf(0) }
    val place = DemoData.places[selected]
    HealthCard {
        Row(Modifier.fillMaxWidth()) {
            Txt("Near you", DepressifyType.small, c.muted, Modifier.weight(1f))
            Txt("Demo places", DepressifyType.small, c.muted)
        }
        // shortcut: an illustrated map with synthetic places; replace this Box with the Google Maps SDK view once an API key and location Consent exist.
        BoxWithConstraints(Modifier.fillMaxWidth().aspectRatio(2f).clip(RoundedCornerShape(14.dp)).clearAndSetSemantics {}) {
            Image(painterResource(Res.drawable.nearby_map), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().graphicsLayer { alpha = if (night) 0.82f else 1f })
            Box(Modifier.offset(maxWidth * 0.56f - 13.dp, maxHeight * 0.54f - 13.dp).size(26.dp).background(YouBlue.copy(alpha = 0.18f), CircleShape), contentAlignment = Alignment.Center) {
                Box(Modifier.size(14.dp).background(YouBlue, CircleShape).border(2.dp, Color.White, CircleShape))
            }
            DemoData.places.forEachIndexed { i, p -> MapPin(p.icon, i == selected, maxWidth * p.x, maxHeight * p.y) }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            DemoData.places.forEachIndexed { i, p -> ChoicePill(p.kind, i == selected, { selected = i }, icon = p.icon) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Txt(place.name, DepressifyType.bodyStrong.copy(fontWeight = FontWeight.SemiBold), c.ink)
                Txt(place.detail, DepressifyType.meta, c.muted)
            }
            TextLink("Maps", { uri.openUri(place.mapsUrl) }, Modifier.semantics { contentDescription = "Open " + place.name + " in Google Maps" }, trailing = PhosphorIcons.arrowSquareOut)
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onSuggestion), verticalAlignment = Alignment.CenterVertically) {
            Txt("Your Suggestion · ", DepressifyType.meta, c.body)
            Txt("A little time outside", DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold), c.ink, Modifier.weight(1f))
            Icon(PhosphorIcons.caretRight, 16.dp, c.muted)
        }
    }
}

private val YouBlue = Color(0xFF2F6FD6)

/** Pins keep day colours because the map image is light in both themes. */
@Composable
private fun MapPin(icon: ImageVector, on: Boolean, x: Dp, y: Dp) {
    val scale by animateFloatAsState(if (on) 1.2f else 1f, tween(if (Theme.reduceMotion) 0 else 180), label = "pin")
    Box(
        Modifier.offset(x - 16.dp, y - 16.dp).size(32.dp).graphicsLayer { scaleX = scale; scaleY = scale }.shadow(3.dp, CircleShape)
            .background(if (on) DayColors.ink else Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, 18.dp, if (on) Color.White else DayColors.ink) }
}

@Composable
fun WelcomeScreen(vm: PatientViewModel) {
    val c = Theme.colors
    Page {
        Illustration(Modifier.fillMaxWidth().aspectRatio(1.5f))
        Txt("A little support,\nat home.", DepressifyType.display, c.ink, heading = true)
        Txt("A few minutes with an AI Companion, between Visits.", DepressifyType.body)
        PrimaryButton("Get started", { vm.open(Route.Sharing) }, icon = null)
        TextLink("Explore the demo", vm::exploreDemo, Modifier.align(Alignment.CenterHorizontally))
        Txt("Wellbeing support. Not clinical treatment.", DepressifyType.small, c.muted)
    }
}

@Composable
fun SharingScreen(vm: PatientViewModel, s: PatientState) {
    val c = Theme.colors
    Page(top = { TopBar("Sharing", vm::back) }, notice = s.notice) {
        Txt("You choose what\nyou share.", DepressifyType.display, c.ink, heading = true)
        Txt("Your Clinician can see your Summaries and the Signals you allow.", DepressifyType.body)
        SoftCard {
            Txt("Your linked Clinician", DepressifyType.bodyStrong, c.ink)
            Txt(DemoData.ClinicianName, DepressifyType.body)
            Txt("Fictional demo Clinician", DepressifyType.small, c.muted)
        }
        Disclosure("What will they see?") {
            Txt(DemoData.SharedSummary, DepressifyType.meta)
            Txt("Chosen daily totals, ratings and progress. Never a recording or full conversation.", DepressifyType.meta)
        }
        PrimaryButton("Share my progress", { vm.finishWelcome(share = true) })
        TextLink("Continue without sharing", { vm.finishWelcome(share = false) }, Modifier.align(Alignment.CenterHorizontally))
    }
}

@Composable
fun Illustration(modifier: Modifier) {
    val night = Theme.colors.night
    Image(
        painterResource(Res.drawable.open_window), contentDescription = "An open window and a quiet garden",
        contentScale = ContentScale.Fit,
        modifier = modifier.clip(RoundedCornerShape(16.dp)).graphicsLayer { alpha = if (night) 0.88f else 1f },
    )
}
