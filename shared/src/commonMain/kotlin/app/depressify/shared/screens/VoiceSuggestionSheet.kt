package app.depressify.shared.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp as lerpColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import androidx.compose.ui.zIndex
import app.depressify.core.SuggestionKind
import app.depressify.shared.resources.Res
import app.depressify.shared.resources.sketch_book
import app.depressify.shared.resources.sketch_game
import app.depressify.shared.resources.sketch_music
import app.depressify.shared.resources.sketch_walk
import app.depressify.shared.resources.sketch_window
import app.depressify.shared.ui.Icon
import app.depressify.shared.ui.PhosphorIcons
import app.depressify.shared.ui.TextLink
import app.depressify.shared.ui.Txt
import app.depressify.shared.ui.icon
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.voice.SessionSuggestion
import app.depressify.shared.voice.SuggestionVote
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.DrawableResource
import org.jetbrains.compose.resources.painterResource
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

internal fun SuggestionKind.sketchDrawable(): DrawableResource = when (this) {
    SuggestionKind.Walk -> Res.drawable.sketch_walk
    SuggestionKind.Music -> Res.drawable.sketch_music
    SuggestionKind.Read -> Res.drawable.sketch_book
    SuggestionKind.Game -> Res.drawable.sketch_game
    SuggestionKind.Window, SuggestionKind.Call -> Res.drawable.sketch_window
}

/** Pill shown above the mic controls when the Suggestions modal has been slid closed. */
@Composable
fun SuggestionsReopenPill(
    suggestions: List<SessionSuggestion>,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (suggestions.isEmpty()) return
    val c = Theme.colors
    val top = suggestions.first()
    val anyAccepted = suggestions.any { it.accepted }
    val badgeTone = if (anyAccepted) c.ok else c.accent
    Row(
        modifier = modifier
            .shadow(
                elevation = 6.dp,
                shape = CircleShape,
                ambientColor = c.ink.copy(alpha = 0.10f),
                spotColor = c.ink.copy(alpha = 0.14f),
            )
            .clip(CircleShape)
            .background(c.soft)
            .border(1.dp, c.border, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "Open suggestions, ${suggestions.size} available" }
            .padding(start = 7.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(badgeTone.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(top.kind.icon, 16.dp, badgeTone)
        }
        Txt(
            text = if (anyAccepted) "Chosen step" else "Suggestions",
            style = DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold),
            color = c.ink,
        )
        Box(
            modifier = Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(badgeTone),
            contentAlignment = Alignment.Center,
        ) {
            Txt(
                text = suggestions.size.toString(),
                style = DepressifyType.label.copy(fontWeight = FontWeight.Bold),
                color = c.onInk,
            )
        }
    }
}

/**
 * Bottom-up activity recommendations sheet that partly covers the Voice Check-in Orb and live
 * Companion transcription. The top slide bar tracks vertical finger drag 1:1 to close, while the
 * card deck tracks horizontal swipes independently.
 */
@Composable
fun SuggestionsBottomModal(
    open: Boolean,
    suggestions: List<SessionSuggestion>,
    activeIndex: Int,
    onActiveIndexChange: (Int) -> Unit,
    booked: Boolean,
    showMapsAttribution: Boolean,
    onDismiss: () -> Unit,
    onSelect: (SessionSuggestion) -> Unit,
    onSmaller: () -> Unit,
    onVote: (SessionSuggestion, SuggestionVote?) -> Unit,
    onBook: () -> Unit,
    onMapsSources: () -> Unit,
    onOpenFractionChange: (Float) -> Unit = {},
    onOpenMusic: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    if (suggestions.isEmpty()) {
        LaunchedEffect(Unit) { onOpenFractionChange(0f) }
        return
    }
    val c = Theme.colors
    val reduceMotion = Theme.reduceMotion
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val defaultHeightPx = with(density) { 400.dp.toPx() }
    var sheetHeightPx by remember { mutableFloatStateOf(defaultHeightPx) }
    val offsetPx = remember { Animatable(if (open) 0f else defaultHeightPx) }
    var draggingBar by remember { mutableStateOf(false) }
    val latestOnDismiss by rememberUpdatedState(onDismiss)

    LaunchedEffect(open, sheetHeightPx, reduceMotion) {
        if (open) {
            offsetPx.animateTo(
                targetValue = 0f,
                animationSpec = if (reduceMotion) snap() else spring(dampingRatio = 0.86f, stiffness = 420f),
            )
        } else {
            offsetPx.animateTo(
                targetValue = sheetHeightPx,
                animationSpec = if (reduceMotion) snap() else tween(durationMillis = 230, easing = FastOutSlowInEasing),
            )
        }
    }

    val openFraction = (1f - (offsetPx.value / sheetHeightPx.coerceAtLeast(1f))).coerceIn(0f, 1f)
    LaunchedEffect(openFraction) { onOpenFractionChange(openFraction) }

    if (!open && offsetPx.value >= sheetHeightPx - 1f) return

    val safeIndex = activeIndex.coerceIn(0, suggestions.lastIndex)
    val sheetShape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)

    Box(modifier.fillMaxSize()) {
        // Gentle wash keeps the upper Cloud Orb and live Companion caption bright and legible.
        Box(
            Modifier
                .fillMaxSize()
                .background(c.ink.copy(alpha = (if (c.night) 0.28f else 0.09f) * openFraction))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = { latestOnDismiss() },
                ),
        )

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .onSizeChanged { size ->
                    if (size.height > 0) {
                        val newH = size.height.toFloat()
                        val wasClosed = !open && offsetPx.value >= sheetHeightPx - 2f
                        sheetHeightPx = newH
                        if (wasClosed) scope.launch { offsetPx.snapTo(newH) }
                    }
                }
                .graphicsLayer { translationY = offsetPx.value.coerceAtLeast(-24f) }
                .shadow(
                    elevation = 16.dp,
                    shape = sheetShape,
                    ambientColor = c.ink.copy(alpha = 0.14f),
                    spotColor = c.ink.copy(alpha = 0.18f),
                )
                .clip(sheetShape)
                .background(c.ground)
                .border(1.dp, c.border, sheetShape)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {})
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(bottom = 16.dp),
        ) {
            // Top slide bar: 1:1 vertical drag to dismiss, decoupled from horizontal card swipes.
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .pointerInput(sheetHeightPx, reduceMotion) {
                        val tracker = VelocityTracker()
                        detectVerticalDragGestures(
                            onDragStart = {
                                draggingBar = true
                                tracker.resetTracking()
                                scope.launch { offsetPx.stop() }
                            },
                            onVerticalDrag = { change, dragAmount ->
                                change.consume()
                                tracker.addPosition(change.uptimeMillis, change.position)
                                val raw = offsetPx.value + dragAmount
                                val damped = if (raw < 0f) raw * 0.18f else raw.coerceAtMost(sheetHeightPx)
                                scope.launch { offsetPx.snapTo(damped) }
                            },
                            onDragCancel = {
                                draggingBar = false
                                scope.launch {
                                    offsetPx.animateTo(
                                        0f,
                                        if (reduceMotion) snap() else spring(dampingRatio = 0.85f, stiffness = 480f),
                                    )
                                }
                            },
                            onDragEnd = {
                                draggingBar = false
                                val vy = tracker.calculateVelocity().y
                                val shouldClose = offsetPx.value > sheetHeightPx * 0.26f || vy > 680f
                                scope.launch {
                                    if (shouldClose) {
                                        offsetPx.animateTo(
                                            targetValue = sheetHeightPx,
                                            initialVelocity = vy.coerceAtLeast(0f),
                                            animationSpec = if (reduceMotion) snap() else tween(210, easing = FastOutSlowInEasing),
                                        )
                                        latestOnDismiss()
                                    } else {
                                        offsetPx.animateTo(
                                            targetValue = 0f,
                                            initialVelocity = vy,
                                            animationSpec = if (reduceMotion) snap() else spring(dampingRatio = 0.84f, stiffness = 500f),
                                        )
                                    }
                                }
                            },
                        )
                    }
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.Button,
                        onClick = { latestOnDismiss() },
                    )
                    .semantics { contentDescription = "Slide down or tap to close suggestions" }
                    .padding(top = 11.dp, bottom = 10.dp, start = 22.dp, end = 22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .size(width = 46.dp, height = 5.dp)
                        .clip(CircleShape)
                        .background(if (draggingBar) c.accent else c.border),
                )
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Txt("One small step", DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold), c.ink)
                        if (suggestions.size > 1) {
                            Txt(" · swipe stack", DepressifyType.small, c.muted)
                        }
                    }
                    Box(
                        Modifier
                            .clip(CircleShape)
                            .background(c.soft)
                            .border(1.dp, c.border, CircleShape)
                            .padding(horizontal = 10.dp, vertical = 3.dp),
                    ) {
                        Txt(
                            text = "${safeIndex + 1} / ${suggestions.size}",
                            style = DepressifyType.label.copy(fontWeight = FontWeight.SemiBold),
                            color = c.muted,
                        )
                    }
                }
            }

            HorizontalSuggestionStack(
                suggestions = suggestions,
                activeIndex = safeIndex,
                onActiveIndexChange = onActiveIndexChange,
                booked = booked,
                onSelect = onSelect,
                onSmaller = onSmaller,
                onVote = onVote,
                onBook = onBook,
                onOpenMusic = onOpenMusic,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(268.dp)
                    .padding(horizontal = 20.dp),
            )

            if (showMapsAttribution) {
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Txt("Place answers may use ", DepressifyType.small, c.muted)
                    TextLink("Google Maps", onMapsSources, color = c.muted)
                }
            }
        }
    }
}

@Composable
private fun HorizontalSuggestionStack(
    suggestions: List<SessionSuggestion>,
    activeIndex: Int,
    onActiveIndexChange: (Int) -> Unit,
    booked: Boolean,
    onSelect: (SessionSuggestion) -> Unit,
    onSmaller: () -> Unit,
    onVote: (SessionSuggestion, SuggestionVote?) -> Unit,
    onBook: () -> Unit,
    onOpenMusic: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reduceMotion = Theme.reduceMotion
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val lastIndex = suggestions.lastIndex.coerceAtLeast(0)
    val animatedIndex = remember { Animatable(activeIndex.toFloat()) }
    val latestActive by rememberUpdatedState(activeIndex)
    val latestOnIndexChange by rememberUpdatedState(onActiveIndexChange)

    LaunchedEffect(activeIndex, suggestions.size, reduceMotion) {
        val clamped = activeIndex.coerceIn(0, lastIndex).toFloat()
        animatedIndex.animateTo(
            targetValue = clamped,
            animationSpec = if (reduceMotion) snap() else spring(dampingRatio = 0.85f, stiffness = 420f),
        )
    }

    val livingTransition = rememberInfiniteTransition(label = "sketchLiving")
    val ambientPhase = if (reduceMotion) 0.3f else livingTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(8000, easing = LinearEasing), RepeatMode.Restart),
        label = "ambientPhase",
    ).value
    val driftWave = if (reduceMotion) 0f else livingTransition.animateFloat(
        initialValue = -1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(4600, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "driftWave",
    ).value

    BoxWithConstraints(modifier) {
        val peekReserve = if (suggestions.size > 1) 52.dp else 0.dp
        val cardWidth = (maxWidth - peekReserve).coerceAtLeast(220.dp)
        val cardWidthPx = with(density) { cardWidth.toPx() }.coerceAtLeast(1f)

        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(suggestions.size, cardWidthPx, reduceMotion) {
                    if (suggestions.size <= 1) return@pointerInput
                    val tracker = VelocityTracker()
                    detectHorizontalDragGestures(
                        onDragStart = {
                            tracker.resetTracking()
                            scope.launch { animatedIndex.stop() }
                        },
                        onHorizontalDrag = { change, dragAmount ->
                            change.consume()
                            tracker.addPosition(change.uptimeMillis, change.position)
                            val delta = -dragAmount / (cardWidthPx * 0.72f)
                            val raw = animatedIndex.value + delta
                            val maxIdx = (suggestions.size - 1).toFloat()
                            val damped = when {
                                raw < 0f -> raw * 0.22f
                                raw > maxIdx -> maxIdx + (raw - maxIdx) * 0.22f
                                else -> raw
                            }
                            scope.launch { animatedIndex.snapTo(damped) }
                        },
                        onDragCancel = {
                            val target = latestActive.coerceIn(0, suggestions.lastIndex)
                            scope.launch {
                                animatedIndex.animateTo(
                                    target.toFloat(),
                                    if (reduceMotion) snap() else spring(dampingRatio = 0.85f, stiffness = 440f),
                                )
                            }
                        },
                        onDragEnd = {
                            val vx = tracker.calculateVelocity().x
                            val cur = animatedIndex.value
                            val base = latestActive.coerceIn(0, suggestions.lastIndex)
                            val diff = cur - base
                            val next = when {
                                vx < -460f || diff > 0.26f -> (base + 1).coerceAtMost(suggestions.lastIndex)
                                vx > 460f || diff < -0.26f -> (base - 1).coerceAtLeast(0)
                                else -> cur.roundToInt().coerceIn(0, suggestions.lastIndex)
                            }
                            latestOnIndexChange(next)
                            scope.launch {
                                animatedIndex.animateTo(
                                    targetValue = next.toFloat(),
                                    initialVelocity = -vx / (cardWidthPx * 0.72f),
                                    animationSpec = if (reduceMotion) snap() else spring(dampingRatio = 0.84f, stiffness = 440f),
                                )
                            }
                        },
                    )
                },
        ) {
            val currentPos = animatedIndex.value
            suggestions.forEachIndexed { idx, item ->
                val relDepth = idx - currentPos
                if (relDepth < -1.05f || relDepth > 3.05f) return@forEachIndexed

                val pose = stackPose(relDepth, with(density) { cardWidth.toPx() }, density.density)
                if (pose.alpha <= 0.01f) return@forEachIndexed

                val isFront = idx == activeIndex
                MinimalSuggestionCard(
                    item = item,
                    cardIndex = idx,
                    totalCount = suggestions.size,
                    isFront = isFront,
                    relDepth = relDepth,
                    depthToneT = pose.depthToneT,
                    ambientPhase = ambientPhase,
                    driftWave = driftWave,
                    booked = booked,
                    onBringToFront = { onActiveIndexChange(idx) },
                    onPrev = { if (activeIndex > 0) onActiveIndexChange(activeIndex - 1) },
                    onNext = { if (activeIndex < suggestions.lastIndex) onActiveIndexChange(activeIndex + 1) },
                    onSelect = { onSelect(item) },
                    onSmaller = onSmaller,
                    onVote = { vote ->
                        onVote(item, vote)
                        if (vote == SuggestionVote.Down && idx < suggestions.lastIndex) {
                            onActiveIndexChange(idx + 1)
                        }
                    },
                    onBook = onBook,
                    onOpenMusic = onOpenMusic,
                    modifier = Modifier
                        .width(cardWidth)
                        .fillMaxHeight()
                        .zIndex((suggestions.size - idx).toFloat())
                        .graphicsLayer {
                            transformOrigin = TransformOrigin(1f, 0.5f)
                            translationX = pose.translationXPx
                            scaleX = pose.scale
                            scaleY = pose.scale
                            alpha = pose.alpha
                        },
                )
            }
        }
    }
}

private data class StackCardPose(
    val translationXPx: Float,
    val scale: Float,
    val alpha: Float,
    val depthToneT: Float,
)

private fun stackPose(relDepth: Float, cardWidthPx: Float, density: Float): StackCardPose {
    fun dpPx(dp: Float) = dp * density
    return when {
        relDepth < 0f -> {
            val t = (-relDepth).coerceIn(0f, 1.1f)
            StackCardPose(
                translationXPx = lerp(0f, -cardWidthPx * 0.92f, t.coerceAtMost(1f)),
                scale = lerp(1f, 0.94f, t.coerceAtMost(1f)),
                alpha = (1f - t * 1.04f).coerceIn(0f, 1f),
                depthToneT = 0f,
            )
        }
        relDepth <= 1f -> StackCardPose(
            translationXPx = lerp(0f, dpPx(26f), relDepth),
            scale = lerp(1f, 0.91f, relDepth),
            alpha = 1f,
            depthToneT = lerp(0f, 0.52f, relDepth),
        )
        relDepth <= 2f -> {
            val t = relDepth - 1f
            StackCardPose(
                translationXPx = lerp(dpPx(26f), dpPx(47f), t),
                scale = lerp(0.91f, 0.82f, t),
                alpha = lerp(1f, 0.94f, t),
                depthToneT = lerp(0.52f, 0.95f, t),
            )
        }
        else -> {
            val t = (relDepth - 2f).coerceIn(0f, 1f)
            StackCardPose(
                translationXPx = lerp(dpPx(47f), dpPx(58f), t),
                scale = lerp(0.82f, 0.74f, t),
                alpha = lerp(0.94f, 0f, t),
                depthToneT = 1f,
            )
        }
    }
}

/**
 * Minimalist HealthCard-synced activity card: uses exact `Theme.colors` (`c.soft`, `c.ground`,
 * `c.border`, `c.ink`, `c.accent`, `c.ok`) paired with a right-aligned minimalist monoline figure
 * tinted in `c.ink`.
 */
@Composable
private fun MinimalSuggestionCard(
    item: SessionSuggestion,
    cardIndex: Int,
    totalCount: Int,
    isFront: Boolean,
    relDepth: Float,
    depthToneT: Float,
    ambientPhase: Float,
    driftWave: Float,
    booked: Boolean,
    onBringToFront: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onSelect: () -> Unit,
    onSmaller: () -> Unit,
    onVote: (SuggestionVote?) -> Unit,
    onBook: () -> Unit,
    onOpenMusic: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Theme.colors
    val reduceMotion = Theme.reduceMotion
    val uriHandler = LocalUriHandler.current
    val shape = RoundedCornerShape(22.dp)

    // Front card matches `HealthCard` (`c.soft`); deeper peeking cards step subtly toward `c.border`
    // so the horizontal stack reads clearly while staying 100% synced to `Theme.colors`.
    val cardBg = lerpColor(c.soft, c.border, depthToneT * (if (c.night) 0.55f else 0.72f))
    val borderTone = lerpColor(c.border, c.ink.copy(alpha = if (c.night) 0.34f else 0.20f), depthToneT * 0.45f)
    val contentAlpha = (1f - relDepth.coerceAtLeast(0f) * 2.5f).coerceIn(0f, 1f)
    val figureAlpha = (1f - (relDepth - 0.8f).coerceAtLeast(0f) * 0.42f).coerceIn(0.42f, 1f)

    Box(
        modifier = modifier
            .shadow(
                elevation = if (relDepth <= 0.1f) 6.dp else 3.dp,
                shape = shape,
                ambientColor = c.ink.copy(alpha = 0.08f),
                spotColor = c.ink.copy(alpha = 0.12f),
            )
            .clip(shape)
            .background(cardBg)
            .border(1.dp, borderTone, shape)
            .then(
                if (!isFront) {
                    Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.Button,
                        onClick = onBringToFront,
                    )
                } else Modifier,
            ),
    ) {
        // Right-anchored minimalist character figure stays softly visible on peeking cards too,
        // giving a natural glimpse of stacked illustrations along the right edge without clipped text.
        Box(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 10.dp, bottom = 6.dp)
                .size(124.dp),
            contentAlignment = Alignment.Center,
        ) {
            val haloScale = if (reduceMotion) 1f else 1f + 0.03f * driftWave
            Box(
                Modifier
                    .size(92.dp)
                    .graphicsLayer {
                        scaleX = haloScale
                        scaleY = haloScale
                        alpha = figureAlpha
                    }
                    .clip(CircleShape)
                    .background(
                        Brush.radialGradient(
                            0.0f to c.ground.copy(alpha = if (c.night) 0.62f else 0.86f),
                            0.72f to c.accent.copy(alpha = if (c.night) 0.12f else 0.08f),
                            1.0f to Color.Transparent,
                        ),
                    ),
            )

            if (!reduceMotion && relDepth in -0.5f..0.75f) {
                Canvas(Modifier.fillMaxSize()) {
                    drawMinimalSketchAccents(
                        kind = item.kind,
                        phase = ambientPhase,
                        tint = c.accent.copy(alpha = 0.42f * figureAlpha),
                    )
                }
            }

            Image(
                painter = painterResource(item.kind.sketchDrawable()),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                colorFilter = ColorFilter.tint(c.ink),
                modifier = Modifier
                    .size(108.dp)
                    .graphicsLayer {
                        translationX = if (reduceMotion) 0f else -relDepth.coerceIn(-1f, 1.5f) * 5f
                        translationY = if (reduceMotion) 0f else driftWave * -2.2f
                        alpha = figureAlpha
                    },
            )
        }

        if (contentAlpha > 0.01f) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer { alpha = contentAlpha }
                    .padding(18.dp),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                // Top Row: Stack badge + Helpful / Not-now feedback buttons
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val badgeBg: Color
                    val badgeFg: Color
                    val badgeText: String
                    when {
                        item.accepted -> {
                            badgeBg = c.ok.copy(alpha = 0.15f)
                            badgeFg = c.ok
                            badgeText = "Chosen · #${cardIndex + 1}"
                        }
                        cardIndex == 0 -> {
                            badgeBg = c.accent.copy(alpha = 0.14f)
                            badgeFg = c.accent
                            badgeText = "Newest · #1"
                        }
                        else -> {
                            badgeBg = c.ground.copy(alpha = 0.78f)
                            badgeFg = c.muted
                            badgeText = "#${cardIndex + 1}"
                        }
                    }

                    Row(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(badgeBg)
                            .then(
                                if (!item.accepted && cardIndex > 0) {
                                    Modifier.border(1.dp, c.border, CircleShape)
                                } else Modifier,
                            )
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        if (item.accepted) {
                            Icon(PhosphorIcons.check, 12.dp, badgeFg)
                        }
                        Txt(
                            text = badgeText,
                            style = DepressifyType.label.copy(fontWeight = FontWeight.SemiBold),
                            color = badgeFg,
                        )
                    }

                    if (isFront) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            VoteIconButton(
                                icon = PhosphorIcons.thumbsUp,
                                active = item.vote == SuggestionVote.Up,
                                activeBg = c.accent,
                                activeFg = c.onInk,
                                description = "Helpful suggestion",
                                onClick = { onVote(if (item.vote == SuggestionVote.Up) null else SuggestionVote.Up) },
                            )
                            VoteIconButton(
                                icon = PhosphorIcons.thumbsDown,
                                active = item.vote == SuggestionVote.Down,
                                activeBg = c.ink,
                                activeFg = c.onInk,
                                description = "Not for me right now",
                                onClick = { onVote(if (item.vote == SuggestionVote.Down) null else SuggestionVote.Down) },
                            )
                        }
                    }
                }

                // Middle Copy Column (leaves right 118.dp clear for the minimalist character figure)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(end = 118.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Txt(
                        text = item.kicker.uppercase(),
                        style = DepressifyType.label,
                        color = c.accent,
                    )
                    BasicText(
                        text = item.title,
                        style = DepressifyType.title.copy(fontSize = 20.sp, lineHeight = 24.sp, color = c.ink),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    BasicText(
                        text = item.detail,
                        style = DepressifyType.small.copy(color = c.muted),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (isFront && item.actionLabel != null && (item.actionUrl != null || item.opensListening)) {
                        Row(
                            modifier = Modifier
                                .clip(CircleShape)
                                .clickable(role = Role.Button) { if (item.opensListening) onOpenMusic() else item.actionUrl?.let(uriHandler::openUri) }
                                .padding(top = 2.dp, bottom = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp),
                        ) {
                            Txt(
                                text = item.actionLabel,
                                style = DepressifyType.small.copy(fontWeight = FontWeight.SemiBold),
                                color = c.accent,
                            )
                            Icon(if (item.opensListening) PhosphorIcons.play else PhosphorIcons.arrowSquareOut, 14.dp, c.accent)
                        }
                    }
                }

                // Bottom Action Row: synced to `PrimaryButton` (`c.ink`) & `SecondaryButton` (`c.border`)
                if (isFront) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (item.accepted) {
                                Row(
                                    modifier = Modifier
                                        .clip(CircleShape)
                                        .background(c.ok)
                                        .padding(horizontal = 14.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Icon(PhosphorIcons.check, 14.dp, c.onInk)
                                    Txt(
                                        text = "Chosen",
                                        style = DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold),
                                        color = c.onInk,
                                    )
                                }
                                SyncedSecondaryPill(
                                    label = if (booked) "Planned" else "Calendar",
                                    onClick = onBook,
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .clip(CircleShape)
                                        .background(c.ink)
                                        .clickable(role = Role.Button, onClick = onSelect)
                                        .padding(horizontal = 16.dp, vertical = 9.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Txt(
                                        text = "That works",
                                        style = DepressifyType.meta.copy(fontWeight = FontWeight.SemiBold),
                                        color = c.onInk,
                                    )
                                }
                                SyncedSecondaryPill(
                                    label = "Smaller",
                                    onClick = onSmaller,
                                )
                            }
                        }

                        if (totalCount > 1) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                StackArrowButton(
                                    icon = PhosphorIcons.arrowLeft,
                                    enabled = cardIndex > 0,
                                    description = "Newer suggestion",
                                    onClick = onPrev,
                                )
                                StackArrowButton(
                                    icon = PhosphorIcons.arrowRight,
                                    enabled = cardIndex < totalCount - 1,
                                    description = "Older suggestion",
                                    onClick = onNext,
                                )
                            }
                        }
                    }
                } else {
                    Spacer(Modifier.height(36.dp))
                }
            }
        }
    }
}

@Composable
private fun SyncedSecondaryPill(
    label: String,
    onClick: () -> Unit,
) {
    val c = Theme.colors
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .background(c.ground)
            .border(1.dp, c.border, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Txt(
            text = label,
            style = DepressifyType.meta.copy(fontWeight = FontWeight.Medium),
            color = c.ink,
        )
    }
}

@Composable
private fun VoteIconButton(
    icon: ImageVector,
    active: Boolean,
    activeBg: Color,
    activeFg: Color,
    description: String,
    onClick: () -> Unit,
) {
    val c = Theme.colors
    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(if (active) activeBg else c.ground)
            .border(1.dp, if (active) activeBg else c.border, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, 15.dp, if (active) activeFg else c.muted)
    }
}

@Composable
private fun StackArrowButton(
    icon: ImageVector,
    enabled: Boolean,
    description: String,
    onClick: () -> Unit,
) {
    val c = Theme.colors
    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(if (enabled) c.ground else c.soft)
            .border(1.dp, c.border, CircleShape)
            .then(
                if (enabled) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier,
            )
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, 15.dp, if (enabled) c.ink else c.disabled)
    }
}

/** Delicate monoline accents around the minimalist figure so the illustration breathes gently. */
private fun DrawScope.drawMinimalSketchAccents(
    kind: SuggestionKind?,
    phase: Float,
    tint: Color,
) {
    val w = size.width
    val h = size.height
    val strokePx = 1.35.dp.toPx()
    val tau = (2.0 * PI).toFloat()

    when (kind) {
        SuggestionKind.Music -> {
            for (i in 0 until 2) {
                val p = (phase + i * 0.5f) % 1f
                val alpha = sin(p * PI.toFloat()).coerceIn(0f, 1f)
                val cx = w * (0.20f + i * 0.60f)
                val cy = h * (0.28f - p * 0.10f)
                drawCircle(
                    color = tint.copy(alpha = tint.alpha * alpha),
                    radius = 2.2.dp.toPx(),
                    center = Offset(cx, cy),
                )
            }
        }
        SuggestionKind.Read -> {
            val pulse = (0.45f + 0.55f * sin(phase * tau)).coerceIn(0.2f, 1f)
            val cx = w * 0.22f
            val cy = h * 0.22f
            val arm = 4.dp.toPx() * pulse
            drawLine(tint, Offset(cx - arm, cy), Offset(cx + arm, cy), strokeWidth = strokePx, cap = StrokeCap.Round)
            drawLine(tint, Offset(cx, cy - arm), Offset(cx, cy + arm), strokeWidth = strokePx, cap = StrokeCap.Round)
        }
        SuggestionKind.Walk -> {
            val sway = sin(phase * tau) * 3.dp.toPx()
            drawCircle(
                color = tint,
                radius = 2.dp.toPx(),
                center = Offset(w * 0.20f + sway, h * 0.26f),
            )
            drawCircle(
                color = tint.copy(alpha = tint.alpha * 0.7f),
                radius = 1.6.dp.toPx(),
                center = Offset(w * 0.82f - sway, h * 0.34f),
            )
        }
        SuggestionKind.Game -> {
            val lift = sin(phase * tau) * 2.5.dp.toPx()
            val cx = w * 0.21f
            val cy = h * 0.25f + lift
            val r = 3.2.dp.toPx()
            drawLine(tint, Offset(cx, cy - r), Offset(cx + r, cy), strokeWidth = strokePx, cap = StrokeCap.Round)
            drawLine(tint, Offset(cx + r, cy), Offset(cx, cy + r), strokeWidth = strokePx, cap = StrokeCap.Round)
            drawLine(tint, Offset(cx, cy + r), Offset(cx - r, cy), strokeWidth = strokePx, cap = StrokeCap.Round)
            drawLine(tint, Offset(cx - r, cy), Offset(cx, cy - r), strokeWidth = strokePx, cap = StrokeCap.Round)
        }
        SuggestionKind.Window, SuggestionKind.Call, null -> {
            val breath = 0.6f + 0.4f * cos(phase * tau)
            drawCircle(
                color = tint.copy(alpha = tint.alpha * breath),
                radius = 2.dp.toPx(),
                center = Offset(w * 0.20f, h * 0.24f),
            )
        }
    }
}
