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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.voice.live.*

/** The same actionable content in both conversation modes; the music stays near the conversation. */
@Composable
internal fun SessionToolCards(cards: List<ToolCard>, playback: MusicPlayback, musicActions: @Composable () -> Unit, onRetryMusic: () -> Unit) {
    cards.filterIsInstance<ToolCard.Music>().forEach { GeneratedMusicCard(it, playback, onRetryMusic, musicActions) }
    cards.asReversed().filterNot { it is ToolCard.Music }.forEach { card ->
        when (card) {
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
