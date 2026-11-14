package app.depressify.shared.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.depressify.core.Summary
import app.depressify.core.isNightHour
import app.depressify.core.model.PatientLocation
import app.depressify.shared.data.TodayPlace
import app.depressify.shared.data.metersFrom
import app.depressify.shared.resources.Res
import app.depressify.shared.resources.nearby_map
import app.depressify.shared.resources.open_window
import app.depressify.shared.state.DemoData
import app.depressify.shared.state.PatientState
import app.depressify.shared.state.PatientViewModel
import app.depressify.shared.state.Place
import app.depressify.shared.state.Route
import app.depressify.shared.state.Scenario
import app.depressify.shared.state.Sheet
import app.depressify.shared.state.TodayLoad
import app.depressify.shared.ui.ChoicePill
import app.depressify.shared.ui.Disclosure
import app.depressify.shared.ui.HealthCard
import app.depressify.shared.ui.Icon
import app.depressify.shared.ui.IconTile
import app.depressify.shared.ui.Notice
import app.depressify.shared.ui.Page
import app.depressify.shared.ui.PhosphorIcons
import app.depressify.shared.ui.PlacesMap
import app.depressify.shared.ui.mapsAvailable
import app.depressify.shared.ui.placeIcon
import app.depressify.shared.ui.PrimaryButton
import app.depressify.shared.ui.SoftCard
import app.depressify.shared.ui.TabBar
import app.depressify.shared.ui.TextLink
import app.depressify.shared.ui.TopBar
import app.depressify.shared.ui.Txt
import app.depressify.shared.ui.WeekBar
import app.depressify.shared.ui.theme.DayColors
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.voice.LiveState
import app.depressify.shared.voice.Orb
import app.depressify.core.model.SuggestionKind
import app.depressify.shared.voice.live.CompanionTools
import app.depressify.shared.voice.live.mapsSearchUrl
import app.depressify.shared.voice.live.musicSearchUrl
import org.jetbrains.compose.resources.painterResource

@Composable
fun TodayScreen(vm: PatientViewModel, s: PatientState, hour: Int) {
    val c = Theme.colors
    val night = c.night
    val effectiveHour = if (night && !isNightHour(hour)) 23 else hour
    val checkedInToday = s.history.any { it.date == "13 November" }

    Column(Modifier.fillMaxSize().background(c.ground)) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
        ) {
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                TodayHeroBanner(
                    patientName = s.displayName,
                    salutation = salutationFor(effectiveHour),
                    night = night,
                    nudgesOn = s.nudges && !s.offline,
                    checkedInToday = checkedInToday,
                    history = s.history,
                    onDemo = { vm.showSheet(Sheet.Demo) },
                    onReminders = { vm.open(Route.QuietHours) },
                    onOpenSummary = { id -> vm.open(Route.Summary(id)) },
                    onTalk = { vm.beginCheckIn(typed = false) },
                    onType = { vm.beginCheckIn(typed = true) },
                )

                Column(
                    Modifier
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
                        .widthIn(max = 560.dp)
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp)
                        .padding(top = 20.dp, bottom = 32.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    if (s.notice != null) {
                        Txt(
                            text = s.notice,
                            style = DepressifyType.meta,
                            color = c.ok,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                    }
                    if (s.offline) {
                        Notice("You’re offline. Saved content is still here.") {
                            TextLink("Reconnect", { vm.applyScenario(Scenario.Everyday) })
                        }
                    }
                    if (s.todayLoad != TodayLoad.Demo) TodaySuggestionsCard(s, onRetry = vm::loadTodaySuggestions)
                    if (s.hasHistory) {
                        WeekBar(DemoData.week(s.history))
                        if (s.todayLoad == TodayLoad.Demo) PlacesCard(night) { vm.open(Route.Suggestion) }
                    } else {
                        Txt(
                            text = "You can start wherever you are.",
                            style = DepressifyType.meta,
                            color = c.muted,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                            align = TextAlign.Center,
                        )
                    }
                }
            }
        }
        TabBar(Route.Today, vm::selectTab)
    }
}

private fun salutationFor(hour: Int): String = when {
    isNightHour(hour) -> "Still up"
    hour < 11 -> "Good morning"
    hour < 17 -> "Good afternoon"
    else -> "Good evening"
}

private data class HeroDay(
    val shortDay: String,
    val dayNumber: String,
    val today: Boolean,
    val summaryId: String?,
)

private fun heroCalendarDays(history: List<Summary>): List<HeroDay> = listOf(
    "We" to "11",
    "Th" to "12",
    "Fr" to "13",
    "Sa" to "14",
    "Su" to "15",
).map { (shortDay, day) ->
    HeroDay(
        shortDay = shortDay,
        dayNumber = day,
        today = day == "13",
        summaryId = history.firstOrNull { it.date == "$day November" }?.id,
    )
}

/**
 * Unified top hero card on Today: greeting + reminder bell, 5-day stadium calendar strip, and the
 * Check-in reminder banner with action pills on the left and the living Voice Orb on the right.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TodayHeroBanner(
    patientName: String,
    salutation: String,
    night: Boolean,
    nudgesOn: Boolean,
    checkedInToday: Boolean,
    history: List<Summary>,
    onDemo: () -> Unit,
    onReminders: () -> Unit,
    onOpenSummary: (String) -> Unit,
    onTalk: () -> Unit,
    onType: () -> Unit,
) {
    val c = Theme.colors
    val heroShape = RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)
    val days = remember(history) { heroCalendarDays(history) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                elevation = 4.dp,
                shape = heroShape,
                ambientColor = c.ink.copy(alpha = 0.05f),
                spotColor = c.ink.copy(alpha = 0.08f),
            )
            .clip(heroShape)
            .background(c.soft)
            .border(1.dp, c.border.copy(alpha = 0.7f), heroShape),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // 1. Greeting + Patient Name on left, Demo & Reminder Bell on right
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Txt(salutation, DepressifyType.meta, c.muted)
                    Txt(
                        text = patientName,
                        style = DepressifyType.display.copy(fontSize = 30.sp, lineHeight = 34.sp),
                        color = c.ink,
                        heading = true,
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .heightIn(min = 38.dp)
                            .clip(CircleShape)
                            .background(c.ground.copy(alpha = if (night) 0.45f else 0.68f))
                            .border(1.dp, c.border, CircleShape)
                            .clickable(role = Role.Button, onClick = onDemo)
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Txt("Demo", DepressifyType.small, c.muted)
                    }

                    Box(
                        modifier = Modifier
                            .size(42.dp)
                            .clip(CircleShape)
                            .background(c.ground.copy(alpha = if (night) 0.55f else 0.78f))
                            .border(1.dp, c.border, CircleShape)
                            .clickable(role = Role.Button, onClick = onReminders)
                            .semantics { contentDescription = "Check-in reminders and quiet hours" },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(PhosphorIcons.bell, 20.dp, c.ink)
                        if (nudgesOn) {
                            Box(
                                Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(top = 9.dp, end = 10.dp)
                                    .size(7.dp)
                                    .clip(CircleShape)
                                    .background(c.accent),
                            )
                        }
                    }
                }
            }

            // 2. Five-day vertical capsule calendar strip centered on Today
            HeroCalendarStrip(days = days, night = night, onOpenSummary = onOpenSummary)

            // Subtle hairline divider matching the reference banner
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp)
                    .height(1.dp)
                    .background(c.border.copy(alpha = 0.85f)),
            )

            // 3. Check-in notification/reminder & CTA on the left, living Voice Orb on the right
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(
                    Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    val kicker = when {
                        checkedInToday -> "CHECKED IN TODAY"
                        night -> "QUIET REMINDER · ~3 MIN"
                        else -> "TODAY'S CHECK-IN · ~3 MIN"
                    }
                    val headline = when {
                        checkedInToday -> "One small step is ready."
                        night -> "Nights can feel long."
                        else -> "One small thing is enough."
                    }
                    val reminderLine = when {
                        checkedInToday -> "Come back anytime if you want to talk again."
                        night -> "I’m here whenever you want calm company."
                        else -> "A gentle reminder to pause for a few quiet minutes."
                    }

                    Txt(
                        text = kicker,
                        style = DepressifyType.label,
                        color = if (checkedInToday) c.ok else c.accent,
                    )
                    Txt(
                        text = headline,
                        style = DepressifyType.title.copy(fontSize = 22.sp, lineHeight = 27.sp),
                        color = c.ink,
                        heading = true,
                    )
                    Txt(
                        text = reminderLine,
                        style = DepressifyType.small,
                        color = c.muted,
                    )

                    Spacer(Modifier.height(6.dp))

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .heightIn(min = 44.dp)
                                .clip(CircleShape)
                                .background(c.ink)
                                .clickable(role = Role.Button, onClick = onTalk)
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            Icon(PhosphorIcons.microphone, 17.dp, c.onInk)
                            Txt(
                                text = "Check in",
                                style = DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold),
                                color = c.onInk,
                            )
                        }

                        Row(
                            modifier = Modifier
                                .heightIn(min = 44.dp)
                                .clip(CircleShape)
                                .background(c.ground.copy(alpha = if (night) 0.45f else 0.76f))
                                .border(1.dp, c.border, CircleShape)
                                .clickable(role = Role.Button, onClick = onType)
                                .padding(horizontal = 13.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(PhosphorIcons.keyboard, 16.dp, c.ink)
                            Txt(
                                text = "Type",
                                style = DepressifyType.meta,
                                color = c.ink,
                            )
                        }
                    }
                }

                Box(
                    modifier = Modifier
                        .size(120.dp)
                        .clip(CircleShape)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            role = Role.Button,
                            onClick = onTalk,
                        )
                        .semantics { contentDescription = "Start voice check-in" },
                    contentAlignment = Alignment.Center,
                ) {
                    Orb(
                        state = LiveState.Listening,
                        size = 120.dp,
                        onInterrupt = {},
                        still = false,
                        interactive = false,
                    )
                }
            }
        }
    }
}

@Composable
private fun HeroCalendarStrip(
    days: List<HeroDay>,
    night: Boolean,
    onOpenSummary: (String) -> Unit,
) {
    val c = Theme.colors
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        days.forEach { d ->
            val pillBg = when {
                d.today && night -> Color(0xFF253942)
                d.today -> c.field
                else -> c.ground.copy(alpha = if (night) 0.22f else 0.34f)
            }
            val pillBorder = if (d.today) c.border.copy(alpha = 0.65f) else c.border.copy(alpha = 0.72f)
            val hasSummary = d.summaryId != null

            Column(
                modifier = Modifier
                    .weight(1f)
                    .height(84.dp)
                    .then(
                        if (d.today) {
                            Modifier.shadow(
                                elevation = 6.dp,
                                shape = CircleShape,
                                ambientColor = c.ink.copy(alpha = 0.08f),
                                spotColor = c.ink.copy(alpha = 0.12f),
                            )
                        } else Modifier,
                    )
                    .clip(CircleShape)
                    .background(pillBg)
                    .border(1.dp, pillBorder, CircleShape)
                    .then(
                        if (d.summaryId != null) {
                            Modifier.clickable(role = Role.Button) { onOpenSummary(d.summaryId) }
                        } else Modifier,
                    )
                    .semantics {
                        selected = d.today
                        contentDescription = buildString {
                            append("${d.shortDay} ${d.dayNumber} November")
                            if (d.today) append(", today")
                            if (hasSummary) append(", check-in saved")
                        }
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Txt(
                    text = d.shortDay,
                    style = DepressifyType.small.copy(
                        fontWeight = if (d.today) FontWeight.Medium else FontWeight.Normal,
                    ),
                    color = c.muted,
                )
                Spacer(Modifier.height(4.dp))
                Txt(
                    text = d.dayNumber,
                    style = DepressifyType.title.copy(
                        fontSize = if (d.today) 21.sp else 19.sp,
                        lineHeight = 23.sp,
                        fontWeight = if (d.today) FontWeight.Bold else FontWeight.SemiBold,
                    ),
                    color = c.ink,
                )
                Spacer(Modifier.height(5.dp))
                Box(
                    Modifier
                        .size(5.dp)
                        .clip(CircleShape)
                        .background(
                            when {
                                hasSummary && d.today -> c.ok
                                hasSummary -> c.accent
                                d.today -> c.accent.copy(alpha = 0.35f)
                                else -> Color.Transparent
                            },
                        ),
                )
            }
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
internal fun TodaySuggestionsCard(s: PatientState, onRetry: () -> Unit) {
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
            val places = suggestion.places
            if (mapsAvailable()) {
                PlacesMap(today.location, places, selectedPlace, { selectedPlace = it }, suggestion.kind, Modifier.fillMaxWidth().aspectRatio(1.4f).clip(RoundedCornerShape(16.dp)))
                // The map names the places; one row says how far the chosen one is and opens it.
                AnimatedContent(places[selectedPlace.coerceIn(places.indices)], transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }) { place ->
                    PlaceRow(place, today.location, suggestion.kind, onNext = if (places.size > 1) ({ selectedPlace = (selectedPlace + 1) % places.size }) else null)
                }
            } else places.forEach { PlaceRow(it, today.location, suggestion.kind, onNext = null) }
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

/**
 * One place: what it is for, its name, how far it is from the Patient's area, and a link that opens
 * it in Google Maps. The link's words also name the source, which the Maps terms ask for beside
 * place content. [onNext] lets a screen reader step through the places the map shows as pins.
 */
@Composable
private fun PlaceRow(place: TodayPlace, near: PatientLocation?, kind: SuggestionKind, onNext: (() -> Unit)?) {
    val c = Theme.colors
    val uri = LocalUriHandler.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).semantics {
            if (onNext != null) customActions = listOf(CustomAccessibilityAction("Next place") { onNext(); true })
        },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(kind.placeIcon)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Txt(place.name, DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold), c.ink)
            near?.let { Txt(CompanionTools.distanceLabel(place.metersFrom(it)) + " away", DepressifyType.small, c.muted) }
        }
        TextLink("Google Maps", { uri.openUri(place.mapsUrl) }, Modifier.semantics { contentDescription = "Open " + place.name + " in Google Maps" }, trailing = PhosphorIcons.arrowSquareOut)
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
