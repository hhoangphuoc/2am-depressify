package app.depressify.shared.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.depressify.shared.resources.Res
import app.depressify.shared.resources.quiet_path
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.voice.live.*
import org.jetbrains.compose.resources.painterResource

@Composable
internal fun MusicSuggestionCard(card: ToolCard.Music, playback: MusicPlayback, onOpen: () -> Unit, actions: @Composable () -> Unit) {
    val current by playback.snapshot.collectAsStateWithLifecycle()
    val c = Theme.colors
    SoftCard {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = onOpen)
            .padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ListeningArtwork(Modifier.size(88.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt("A little music", DepressifyType.titleSmall, c.ink, heading = true)
                Txt(when {
                    card.failed -> "Couldn't make the music · try again"
                    card.clip == null -> "Being made for this moment"
                    current.clip === card.clip && current.status == PlaybackStatus.Paused -> "Paused · ${timeLabel(current.positionMillis)}"
                    else -> "Ready when you are · about 1 min"
                }, DepressifyType.small, c.muted)
                Txt("Open listening session", DepressifyType.meta, c.accent)
            }
            Icon(PhosphorIcons.caretRight, 18.dp, c.muted)
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
        Page(top = { TopBar("Listening session", onClose) }, bottom = {
            Column(Modifier.fillMaxWidth().background(c.soft).navigationBarsPadding().padding(horizontal = 28.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Column(Modifier.widthIn(max = 480.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val elapsed = if (active) current.positionMillis else 0
                    val duration = if (active) current.durationMillis else 0
                    val fraction = if (duration > 0) (elapsed.toFloat() / duration).coerceIn(0f, 1f) else 0f
                    Box(Modifier.fillMaxWidth().height(5.dp).clip(CircleShape).background(c.border)
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
                    Box(Modifier.size(80.dp).clip(CircleShape).background(c.ink)
                        .clickable(role = Role.Button) { playback.toggle(clip) }.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
                        Icon(if (playing) PhosphorIcons.pause else if (preparing) PhosphorIcons.x else PhosphorIcons.play, 30.dp, c.onInk)
                    }
                    Txt(label, DepressifyType.meta, c.ink)
                }
                if (card.failed) PrimaryButton("Try making it again", onRetry)
                Txt("Your Check-in is paused here", DepressifyType.small, c.muted)
            }
        }) {
            ListeningArtwork(Modifier.align(Alignment.CenterHorizontally).widthIn(max = 340.dp).fillMaxWidth().aspectRatio(1.15f))
            Txt(if (card.clip == null && !failed) "Making space for a moment" else "A moment to listen", DepressifyType.title, c.ink,
                Modifier.fillMaxWidth(), align = TextAlign.Center, heading = true)
            Txt(card.mood.replaceFirstChar(Char::uppercase), DepressifyType.body, c.ink, Modifier.fillMaxWidth(), align = TextAlign.Center)
            val message = when {
                failed -> if (card.clip == null) "The music couldn't be made. You can try again." else "The music couldn't play. Try playing it again."
                card.clip == null -> "Creating your instrumental music. This usually takes about half a minute. You can return to your Check-in while you wait."
                preparing -> "Getting your music ready…"
                playing -> "Just listen. There’s nothing else you need to do."
                status == PlaybackStatus.Paused -> "Take your time. Continue whenever you're ready."
                else -> "Made for this moment. Press Play when you're ready."
            }
            Txt(message, DepressifyType.meta, if (failed) c.error else c.muted,
                Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, align = TextAlign.Center)
            Txt("AI-generated music · kept only for this Check-in", DepressifyType.small, c.muted, Modifier.fillMaxWidth(), align = TextAlign.Center)
        }
    }
}

@Composable
private fun ListeningArtwork(modifier: Modifier) {
    Image(painterResource(Res.drawable.quiet_path), contentDescription = null, contentScale = ContentScale.Crop,
        modifier = modifier.clip(RoundedCornerShape(16.dp)))
}

private fun timeLabel(millis: Int): String = "${millis / 60_000}:${((millis / 1000) % 60).toString().padStart(2, '0')}"
