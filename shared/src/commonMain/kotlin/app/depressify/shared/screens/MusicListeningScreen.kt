package app.depressify.shared.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.depressify.core.SuggestionKind
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.*
import app.depressify.shared.voice.live.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.compose.resources.decodeToImageBitmap
import org.jetbrains.compose.resources.painterResource

private val EaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)

/** The Check-in's music card: the same sketch as the voice suggestion stack, and one way in. */
@Composable
internal fun MusicSuggestionCard(card: ToolCard.Music, playback: MusicPlayback, onOpen: () -> Unit, actions: @Composable () -> Unit) {
    val current by playback.snapshot.collectAsStateWithLifecycle()
    val c = Theme.colors
    val mine = card.clip != null && current.clip === card.clip
    val source = remember { MutableInteractionSource() }
    SoftCard {
        Row(Modifier.fillMaxWidth().pressScale(source).clickable(source, indication = null, role = Role.Button, onClickLabel = "Listen", onClick = onOpen),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                BasicText(card.title, Modifier.semantics { heading() }, DepressifyType.titleSmall.copy(color = c.ink), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Txt(when {
                    card.failed -> "Couldn't make the music"
                    card.clip == null -> "Making your music…"
                    mine && current.status == PlaybackStatus.Playing -> "Playing"
                    mine && current.status == PlaybackStatus.Paused -> "Paused at ${timeLabel(current.positionMillis)}"
                    else -> "About a minute, made for you"
                }, DepressifyType.small, if (card.failed) c.error else c.muted, Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Spacer(Modifier.height(4.dp))
                Row(Modifier.clip(CircleShape).background(c.ink).padding(start = 12.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(PhosphorIcons.play, 14.dp, c.onInk)
                    Txt("Listen", DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold), c.onInk)
                }
            }
            MusicSketch(Modifier.size(96.dp).clip(RoundedCornerShape(16.dp)), figure = 84.dp)
        }
        actions()
    }
}

/**
 * Full-screen listening view over the Check-in, which keeps its in-memory player underneath. The
 * cover is asked for only once this view opens; until it arrives, the music sketch stands in.
 */
@Composable
internal fun MusicListeningScreen(card: ToolCard.Music, cover: ByteArray?, coverPending: Boolean, playback: MusicPlayback, onClose: () -> Unit, onRetry: () -> Unit) {
    val current by playback.snapshot.collectAsStateWithLifecycle()
    val active = current.clip === card.clip && card.clip != null
    val status = if (active) current.status else PlaybackStatus.Idle
    val playing = status == PlaybackStatus.Playing
    val seekable = playing || status == PlaybackStatus.Paused
    val c = Theme.colors
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Page(top = {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.rotate(90f)) { IconButton(PhosphorIcons.caretRight, "Back to Check-in", onClose) }
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Icon(PhosphorIcons.microphoneSlash, 14.dp, c.muted)
                    Spacer(Modifier.width(6.dp))
                    Txt("Check-in paused", DepressifyType.small, c.muted)
                }
                Spacer(Modifier.width(48.dp))
            }
        }, bottom = {
            Column(Modifier.fillMaxWidth().background(c.ground).navigationBarsPadding().padding(start = 32.dp, end = 32.dp, top = 4.dp, bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp)) {
                ListeningProgress(if (active) current.positionMillis else 0, if (active) current.durationMillis else 0)
                card.clip?.let { clip ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                        SeekButton("−15", "Back 15 seconds", seekable) { playback.skipBy(-15_000) }
                        PlayButton(status) { playback.toggle(clip) }
                        SeekButton("+15", "Forward 15 seconds", seekable) { playback.skipBy(15_000) }
                    }
                }
                if (card.failed) PrimaryButton("Try again", onRetry)
            }
        }) {
            Spacer(Modifier.height(4.dp))
            ListeningCover(cover, coverPending, playing, Modifier.align(Alignment.CenterHorizontally).widthIn(max = 340.dp).fillMaxWidth().aspectRatio(1f))
            Column(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(card.title, DepressifyType.title, c.ink, Modifier.fillMaxWidth(), align = TextAlign.Center, heading = true)
                val failed = card.failed || status == PlaybackStatus.Failed
                Txt(when {
                    card.failed -> "Couldn't make the music"
                    card.clip == null -> "Making your music · about a minute"
                    status == PlaybackStatus.Failed -> "Couldn't play it · try Play again"
                    status == PlaybackStatus.Preparing -> "Getting it ready…"
                    else -> "Made by AI, just for this Check-in"
                }, DepressifyType.meta, if (failed) c.error else c.muted,
                    Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, align = TextAlign.Center)
            }
        }
    }
}

private val ToolCard.Music.title get() = mood.replaceFirstChar(Char::uppercase)

/** PR #73's music figure on the soft card ground, with the same halo as its suggestion stack. */
@Composable
private fun MusicSketch(modifier: Modifier, figure: Dp) {
    val c = Theme.colors
    Box(modifier.background(c.soft), contentAlignment = Alignment.Center) {
        Box(Modifier.size(figure * 0.86f).clip(CircleShape).background(Brush.radialGradient(
            0f to c.ground.copy(alpha = if (c.night) 0.62f else 0.86f),
            0.72f to c.accent.copy(alpha = if (c.night) 0.12f else 0.08f),
            1f to Color.Transparent,
        )))
        Image(painterResource(SuggestionKind.Music.sketchDrawable()), null, Modifier.size(figure), contentScale = ContentScale.Fit, colorFilter = ColorFilter.tint(c.ink))
    }
}

@Composable
private fun ListeningCover(cover: ByteArray?, pending: Boolean, playing: Boolean, modifier: Modifier) {
    val c = Theme.colors
    val reduce = Theme.reduceMotion
    val bitmap by produceState<ImageBitmap?>(null, cover) {
        value = cover?.let { withContext(Dispatchers.Default) { runCatching { it.decodeToImageBitmap() }.getOrNull() } }
    }
    // Like a record sleeve: the cover rests a little smaller until the music plays.
    val scale by animateFloatAsState(if (playing || reduce) 1f else 0.94f, spring(dampingRatio = 1f, stiffness = 260f))
    // The cover develops out of the sketch once; reopening the view shows it settled.
    val reveal = remember { Animatable(if (cover != null) 1f else 0f) }
    LaunchedEffect(bitmap) { if (bitmap != null) reveal.animateTo(1f, tween(if (reduce) 200 else 900, easing = EaseOut)) }
    val shape = RoundedCornerShape(24.dp)
    Box(modifier.graphicsLayer { scaleX = scale; scaleY = scale }
        .shadow(16.dp, shape, ambientColor = c.ink.copy(alpha = 0.06f), spotColor = c.ink.copy(alpha = 0.14f)).clip(shape)
        .semantics { contentDescription = when { bitmap != null -> "AI-made nature cover for this music"; pending -> "Painting a cover for this music"; else -> "Music" } }) {
        MusicSketch(Modifier.fillMaxSize(), figure = 176.dp)
        bitmap?.let {
            Image(it, null, Modifier.fillMaxSize().graphicsLayer { alpha = reveal.value }
                .then(if (reduce) Modifier else Modifier.blur((24 * (1f - reveal.value)).dp)), contentScale = ContentScale.Crop)
        }
    }
}

@Composable
private fun ListeningProgress(elapsed: Int, duration: Int) {
    val c = Theme.colors
    val fraction = if (duration > 0) (elapsed.toFloat() / duration).coerceIn(0f, 1f) else 0f
    val digits = DepressifyType.small.copy(fontFeatureSettings = "tnum")
    Column(Modifier.widthIn(max = 440.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape).background(c.border)
            .semantics { if (duration > 0) progressBarRangeInfo = ProgressBarRangeInfo(fraction, 0f..1f) }) {
            Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().clip(CircleShape).background(c.accent))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Txt(timeLabel(elapsed), digits, c.muted)
            Txt(if (duration > 0) timeLabel(duration) else "–:––", digits, c.muted)
        }
    }
}

@Composable
private fun PlayButton(status: PlaybackStatus, onClick: () -> Unit) {
    val c = Theme.colors
    val source = remember { MutableInteractionSource() }
    val label = when (status) { PlaybackStatus.Preparing -> "Cancel playback"; PlaybackStatus.Playing -> "Pause music"; PlaybackStatus.Paused -> "Resume music"; else -> "Play music" }
    Box(Modifier.size(76.dp).pressScale(source).clip(CircleShape).background(c.ink)
        .clickable(source, indication = null, role = Role.Button, onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        when (status) {
            PlaybackStatus.Playing -> Icon(PhosphorIcons.pause, 30.dp, c.onInk)
            PlaybackStatus.Preparing -> Icon(PhosphorIcons.x, 26.dp, c.onInk)
            // The triangle's weight sits left of its box; nudge it to look centred.
            else -> Icon(PhosphorIcons.play, 30.dp, c.onInk, modifier = Modifier.offset(x = 2.dp))
        }
    }
}

@Composable
private fun SeekButton(label: String, description: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Theme.colors
    val source = remember { MutableInteractionSource() }
    Box(Modifier.size(52.dp).pressScale(source).clip(CircleShape).background(c.soft)
        .clickable(source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
        .semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Txt(label, DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"), if (enabled) c.ink else c.disabled)
    }
}

private fun timeLabel(millis: Int): String = "${millis / 60_000}:${((millis / 1000) % 60).toString().padStart(2, '0')}"
