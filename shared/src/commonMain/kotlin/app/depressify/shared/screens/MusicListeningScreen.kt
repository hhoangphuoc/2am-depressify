package app.depressify.shared.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.*
import app.depressify.shared.voice.live.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.compose.resources.decodeToImageBitmap

@Composable
internal fun MusicSuggestionCard(card: ToolCard.Music, playback: MusicPlayback, onOpen: () -> Unit, actions: @Composable () -> Unit) {
    val current by playback.snapshot.collectAsStateWithLifecycle()
    val c = Theme.colors
    SoftCard {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = onOpen)
            .padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt("A little music", DepressifyType.titleSmall, c.ink, heading = true)
                Txt(when {
                    card.failed -> "Couldn't make the music · try again"
                    card.clip == null -> "Creating your music & cover"
                    current.clip === card.clip && current.status == PlaybackStatus.Paused -> "Paused · ${timeLabel(current.positionMillis)}"
                    else -> "Made for this moment"
                }, DepressifyType.small, c.muted)
                Txt("Open listening session", DepressifyType.meta, c.accent)
            }
            ListeningArtwork(card, Modifier.size(96.dp), compact = true)
        }
        actions()
    }
}

/** Full-screen presentation preserves the Check-in and its in-memory player underneath. */
@Composable
internal fun MusicListeningScreen(card: ToolCard.Music, playback: MusicPlayback, onClose: () -> Unit, onRetry: () -> Unit) {
    val current by playback.snapshot.collectAsStateWithLifecycle()
    val active = current.clip === card.clip && card.clip != null
    val status = if (active) current.status else PlaybackStatus.Idle
    val playing = status == PlaybackStatus.Playing
    val preparing = status == PlaybackStatus.Preparing
    val failed = card.failed || status == PlaybackStatus.Failed
    val c = Theme.colors
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Page(top = {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.rotate(90f)) { IconButton(PhosphorIcons.caretRight, "Return to Check-in", onClose) }
                Spacer(Modifier.weight(1f))
                Icon(PhosphorIcons.musicNotes, 24.dp, c.ink)
                Spacer(Modifier.width(12.dp))
            }
        }, bottom = {
            Column(Modifier.fillMaxWidth().background(c.ground).navigationBarsPadding().padding(horizontal = 32.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(Modifier.widthIn(max = 440.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val elapsed = if (active) current.positionMillis else 0
                    val duration = if (active) current.durationMillis else 0
                    val fraction = if (duration > 0) (elapsed.toFloat() / duration).coerceIn(0f, 1f) else 0f
                    Box(Modifier.fillMaxWidth().height(3.dp).clip(CircleShape).background(c.border)
                        .semantics { if (duration > 0) progressBarRangeInfo = ProgressBarRangeInfo(fraction, 0f..1f) }) {
                        Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(c.accent))
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Txt(timeLabel(elapsed), DepressifyType.small, c.muted)
                        Txt(if (duration > 0) timeLabel(duration) else "About 1 min", DepressifyType.small, c.muted)
                    }
                }
                card.clip?.let { clip ->
                    val label = when { preparing -> "Cancel playback"; playing -> "Pause music"; status == PlaybackStatus.Paused -> "Resume music"; else -> "Play music" }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                        SeekButton("−15", "Back 15 seconds", status == PlaybackStatus.Playing || status == PlaybackStatus.Paused) { playback.skipBy(-15_000) }
                        Box(Modifier.size(80.dp).clip(CircleShape).background(c.accent).border(4.dp, c.border, CircleShape)
                            .clickable(role = Role.Button) { playback.toggle(clip) }.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
                            Icon(if (playing) PhosphorIcons.pause else if (preparing) PhosphorIcons.x else PhosphorIcons.play, 30.dp, c.onInk)
                        }
                        SeekButton("+15", "Forward 15 seconds", status == PlaybackStatus.Playing || status == PlaybackStatus.Paused) { playback.skipBy(15_000) }
                    }
                }
                if (card.failed) PrimaryButton("Try making it again", onRetry)
                Txt("Check-in paused · return whenever you're ready", DepressifyType.small, c.muted, align = TextAlign.Center)
            }
        }) {
            Txt("Made for this moment", DepressifyType.titleSmall, c.ink, heading = true)
            ListeningArtwork(card, Modifier.align(Alignment.CenterHorizontally).widthIn(max = 340.dp).fillMaxWidth().aspectRatio(1f))
            Txt(card.mood.replaceFirstChar(Char::uppercase), DepressifyType.title, c.ink,
                Modifier.fillMaxWidth(), align = TextAlign.Center, heading = true)
            Txt("Original music & cover · created for you", DepressifyType.small, c.muted, Modifier.fillMaxWidth(), align = TextAlign.Center)
            val message = when {
                failed -> if (card.clip == null) "The music couldn't be made. You can try again." else "The music couldn't play. Try playing it again."
                card.clip == null -> "Creating music and artwork from the same feeling. This can take about a minute."
                preparing -> "Getting your music ready…"
                playing -> "Just listen. There’s nothing else you need to do."
                status == PlaybackStatus.Paused -> "Take your time. Continue whenever you're ready."
                else -> "Press Play when you're ready."
            }
            Txt(message, DepressifyType.meta, if (failed) c.error else c.muted,
                Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, align = TextAlign.Center)
            Txt("AI-generated · kept only for this Check-in", DepressifyType.small, c.muted, Modifier.fillMaxWidth(), align = TextAlign.Center)
        }
    }
}

@Composable
private fun SeekButton(label: String, description: String, enabled: Boolean, onClick: () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Txt(label, DepressifyType.meta, if (enabled) Theme.colors.accent else Theme.colors.muted)
    }
}

@Composable
private fun ListeningArtwork(card: ToolCard.Music, modifier: Modifier, compact: Boolean = false) {
    val bytes = card.clip?.artwork
    val decoded by produceState<Result<ImageBitmap>?>(null, bytes) {
        value = bytes?.let { withContext(Dispatchers.Default) { runCatching { it.decodeToImageBitmap() } } }
    }
    val bitmap = decoded?.getOrNull()
    Box(modifier.clip(RoundedCornerShape(12.dp)).background(Theme.colors.soft), contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap, contentDescription = "AI-generated cover inspired by this music's mood", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(PhosphorIcons.musicNotes, if (compact) 24.dp else 40.dp, Theme.colors.accent)
            if (!compact) Txt(if (card.clip == null && !card.failed || bytes != null && decoded == null) "Creating your cover…" else "Cover unavailable · you can still listen", DepressifyType.small, Theme.colors.muted, align = TextAlign.Center)
        }
    }
}

private fun timeLabel(millis: Int): String = "${millis / 60_000}:${((millis / 1000) % 60).toString().padStart(2, '0')}"
