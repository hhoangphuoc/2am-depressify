package app.depressify.shared.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.depressify.core.model.Signal
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.voice.live.*
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/** The same actionable content in both conversation modes; the music stays near the conversation. */
@Composable
internal fun SessionToolCards(cards: List<ToolCard>, playback: MusicPlayback, musicActions: @Composable () -> Unit, onRetryMusic: () -> Unit) {
    cards.filterIsInstance<ToolCard.Music>().forEach { GeneratedMusicCard(it, playback, onRetryMusic, musicActions) }
    cards.asReversed().filterNot { it is ToolCard.Music }.forEach { card ->
        when (card) {
            is ToolCard.Insight -> InsightCard(card)
            is ToolCard.Places -> PlacesSessionCard(card)
            is ToolCard.Weather -> {
                val uri = LocalUriHandler.current
                SoftCard {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(PhosphorIcons.sunHorizon, 24.dp, Theme.colors.accent)
                        Txt("Outside right now", DepressifyType.titleSmall, Theme.colors.ink)
                    }
                    Txt(card.line, DepressifyType.body, Theme.colors.ink)
                    TextLink(card.sourceTitle, { uri.openUri(card.sourceUrl) })
                }
            }
            is ToolCard.Music -> Unit
        }
    }
}

@Composable
private fun GeneratedMusicCard(card: ToolCard.Music, playback: MusicPlayback, onRetry: () -> Unit, actions: @Composable () -> Unit) {
    val c = Theme.colors
    val current by playback.snapshot.collectAsStateWithLifecycle()
    val active = current.clip === card.clip && card.clip != null
    val status = if (active) current.status else PlaybackStatus.Idle
    val playing = status == PlaybackStatus.Playing
    val preparing = status == PlaybackStatus.Preparing
    val failed = card.failed || status == PlaybackStatus.Failed
    SoftCard(Modifier.animateContentSize(tween(if (Theme.reduceMotion) 0 else 180))) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Canvas(Modifier.size(64.dp).clearAndSetSemantics {}) {
                drawCircle(c.accent.copy(alpha = 0.12f))
                repeat(3) { i -> drawCircle(c.accent.copy(alpha = 0.2f + i * 0.1f), radius = size.minDimension * (0.22f + i * 0.1f), style = Stroke(1.dp.toPx())) }
                drawCircle(c.accent, radius = 4.dp.toPx())
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt("A little music for you", DepressifyType.titleSmall, c.ink, heading = true)
                Txt("Calm, instrumental · made for this moment", DepressifyType.small, c.muted)
            }
        }
        Txt(card.mood.replaceFirstChar(Char::uppercase), DepressifyType.body, c.ink)
        val message = when {
            failed -> if (card.clip == null) "The music couldn't be made. You can try again." else "The music couldn't play. Try playing it again."
            card.clip == null -> "Making your music. This usually takes about half a minute."
            preparing -> "Getting your music ready…"
            playing -> "Microphone paused while you listen"
            status == PlaybackStatus.Paused -> "Paused · continue whenever you're ready"
            else -> "Ready when you are. Nothing plays automatically."
        }
        Txt(message, DepressifyType.meta, if (failed) c.error else c.muted,
            Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        card.clip?.let { clip ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(
                    Modifier.size(56.dp).clip(CircleShape).background(c.ink)
                        .clickable(role = Role.Button) { playback.toggle(clip) }
                        .semantics { contentDescription = when { preparing -> "Cancel playback"; playing -> "Pause music"; status == PlaybackStatus.Paused -> "Resume music"; else -> "Play music" } },
                    contentAlignment = Alignment.Center,
                ) { Icon(if (playing) PhosphorIcons.pause else if (preparing) PhosphorIcons.x else PhosphorIcons.play, 24.dp, c.onInk) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val elapsed = if (active) current.positionMillis else 0
                    val duration = if (active) current.durationMillis else 0
                    val fraction = if (duration > 0) (elapsed.toFloat() / duration).coerceIn(0f, 1f) else 0f
                    Box(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape).background(c.border)
                        .semantics { if (duration > 0) progressBarRangeInfo = ProgressBarRangeInfo(fraction, 0f..1f) }) {
                        Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(c.accent))
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Txt(timeLabel(elapsed), DepressifyType.small, c.muted)
                        Txt(if (duration > 0) timeLabel(duration) else "About 1 min", DepressifyType.small, c.muted)
                    }
                }
            }
        }
        if (card.failed) TextLink("Try making it again", onRetry)
        actions()
        Txt("AI-generated music · kept only for this Check-in", DepressifyType.small, c.muted)
    }
}

private fun timeLabel(millis: Int): String = "${millis / 60_000}:${((millis / 1000) % 60).toString().padStart(2, '0')}"

@Composable
private fun InsightCard(card: ToolCard.Insight) {
    val c = Theme.colors
    SoftCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(if (card.summaries.isNotEmpty()) PhosphorIcons.chatCircle else PhosphorIcons.chartBar, 22.dp, c.accent)
            Txt(card.title, DepressifyType.titleSmall, c.ink, heading = true)
        }
        when {
            card.comparisons.isNotEmpty() -> {
                val primary = card.comparisons.filter { it.signal in listOf(Signal.SLEEP_MINUTES, Signal.STEPS, Signal.LATE_NIGHT_SCREEN_MINUTES) }.ifEmpty { card.comparisons.take(3) }
                val rest = card.comparisons - primary.toSet()
                primary.forEach { ComparisonRow(it) }
                if (rest.isNotEmpty()) Disclosure("${rest.size} more signals") { rest.forEach { ComparisonRow(it) } }
                Txt("Compared with your own usual. These are patterns, not a health score.", DepressifyType.small, c.muted)
            }
            card.summaries.isNotEmpty() -> {
                card.summaries.forEach { summary ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            val date = Instant.fromEpochMilliseconds(summary.createdAtMillis).toLocalDateTime(TimeZone.currentSystemDefault()).date
                            Txt("${date.day} ${date.month.name.lowercase().replaceFirstChar(Char::uppercase).take(3)}", DepressifyType.small, c.muted)
                            Txt(summary.themes.take(2).joinToString(" · ").ifBlank { "A moment to check in" }, DepressifyType.meta, c.ink)
                        }
                        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Txt(summary.mood?.let { "Mood $it / 5" } ?: "Mood not recorded", DepressifyType.small, c.muted)
                            RatingDots(summary.mood, "Mood")
                        }
                    }
                }
                Disclosure("What you talked about") {
                    card.summaries.forEach { summary ->
                        Txt(summary.themes.joinToString(" · "), DepressifyType.meta, c.ink)
                        summary.suggestion?.let { Txt(it, DepressifyType.meta, c.muted) }
                    }
                }
                Txt("From your own Check-ins", DepressifyType.small, c.muted)
            }
            else -> card.lines.forEach { Txt(it, DepressifyType.meta, c.ink) }
        }
    }
}

@Composable
private fun ComparisonRow(comparison: SignalComparison) {
    val c = Theme.colors
    val label = when (comparison.signal) { Signal.SLEEP_MINUTES -> "Sleep"; Signal.STEPS -> "Movement"; Signal.LATE_NIGHT_SCREEN_MINUTES -> "Late-night screen time"; else -> comparison.label }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val icon = when (comparison.signal) { Signal.SLEEP_MINUTES -> PhosphorIcons.moon; Signal.STEPS -> PhosphorIcons.footprints; Signal.LATE_NIGHT_SCREEN_MINUTES -> PhosphorIcons.deviceMobile; else -> PhosphorIcons.heartbeat }
        Icon(icon, 21.dp, c.accent)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(label, DepressifyType.meta, c.ink)
            Txt(when (comparison.direction) { -1 -> "Lower than usual"; 1 -> "Higher than usual"; else -> "About your usual" }, DepressifyType.small, c.muted)
        }
        Canvas(Modifier.size(54.dp, 24.dp).clearAndSetSemantics {}) {
            val y = size.height / 2
            drawLine(c.border, Offset(4.dp.toPx(), y), Offset(size.width - 4.dp.toPx(), y), 2.dp.toPx())
            repeat(3) { i -> drawCircle(if (i == comparison.direction + 1) c.accent else c.border, if (i == comparison.direction + 1) 4.dp.toPx() else 2.dp.toPx(), Offset(4.dp.toPx() + i * (size.width - 8.dp.toPx()) / 2, y)) }
        }
    }
}

@Composable
private fun PlacesSessionCard(card: ToolCard.Places) {
    val c = Theme.colors
    val uri = LocalUriHandler.current
    SoftCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(PhosphorIcons.mapPin, 22.dp, c.accent)
            Txt("A little time outside", DepressifyType.titleSmall, c.ink)
        }
        Txt(card.query, DepressifyType.body, c.ink)
        card.places.forEach { place ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Txt(place.name, DepressifyType.bodyStrong, c.ink)
                    Txt(place.walkMinutes?.let { "$it min walk" } ?: (CompanionTools.distanceLabel(place.distanceMeters) + " away"), DepressifyType.small, c.muted)
                }
                IconButton(PhosphorIcons.arrowSquareOut, "Open ${place.name} in Google Maps", { uri.openUri(place.mapsUrl) })
            }
        }
        if (card.places.isEmpty()) TextLink("Search in Google Maps", { uri.openUri(card.url) })
        Txt("Places from Google Maps", DepressifyType.small, c.muted)
    }
}
