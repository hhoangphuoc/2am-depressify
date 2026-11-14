package app.depressify.shared.voice

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.depressify.shared.ui.theme.Theme
import kotlin.math.pow
import kotlin.random.Random

/** Four-colour gradient per state from the Depressify palette: deep, upper, lower, light band. */
private val Palettes: Map<LiveState, List<Color>> = mapOf(
    LiveState.Speaking to listOf(Color(0xFFB47A55), Color(0xFFD6A680), Color(0xFFEFD8C2), Color(0xFFFCF4EC)),
    LiveState.Listening to listOf(Color(0xFF326B73), Color(0xFF5D9893), Color(0xFFBCDAD6), Color(0xFFEEF6F4)),
    LiveState.Thinking to listOf(Color(0xFF4D6C8B), Color(0xFF7F9CB6), Color(0xFFD2DEEA), Color(0xFFF2F6FA)),
    LiveState.Paused to listOf(Color(0xFF7F8E93), Color(0xFFA6B3B6), Color(0xFFDFE4E4), Color(0xFFF5F7F6)),
    LiveState.Connecting to listOf(Color(0xFF8D9BA0), Color(0xFFB2BDC0), Color(0xFFE4E8E8), Color(0xFFF6F8F7)),
)

/** Shader-backed brush for the cloud field. Null when the platform cannot run runtime shaders. */
interface CloudShader {
    fun brush(width: Float, height: Float, time: Float, activity: Float, dim: Float, palette: List<Color>): Brush
}

expect fun createCloudShader(): CloudShader?

/**
 * Cloud field adapted from the orb-ui "cloud" theme (MIT License, Copyright (c) orb-ui contributors,
 * github.com/exprmntl/orb-ui): domain-warped fbm, a two-tone sky and a light band on a moving horizon.
 * Written in SkSL so the same source runs as AGSL on Android and through Skia on iOS.
 */
const val CloudSksl = """
uniform float2 uRes; uniform float uTime; uniform float uAct; uniform float uDim;
uniform float3 uDeep; uniform float3 uUpper; uniform float3 uLower; uniform float3 uLight;
float hash(float2 p) { p = fract(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x), mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}
float fbm(float2 p) {
  float v = 0.0; float a = 0.52; float2x2 r = float2x2(0.8, 0.6, -0.6, 0.8);
  for (int o = 0; o < 5; o++) { v += a * noise(p); p = r * p * 1.92 + float2(9.7, 4.3); a *= 0.5; }
  return v;
}
half4 main(float2 fragCoord) {
  float2 uv = float2(fragCoord.x / uRes.x, 1.0 - fragCoord.y / uRes.y);
  float2 c = uv - 0.5; float r = length(c);
  float edge = 1.0 - smoothstep(0.488, 0.5, r);
  float2 p = c * 2.0; float t = uTime;
  float2 w = float2(fbm(p * 1.02 + float2(t * 0.34, -t * 0.24)), fbm(p * 1.08 + float2(-t * 0.27, t * 0.32) + float2(6.7, 2.9)));
  float2 q = p + (w - 0.5) * (1.15 + uAct * 0.4) + float2(sin(p.y * 2.4 + t * 0.68 + w.y * 3.2), cos(p.x * 2.1 - t * 0.61 + w.x * 3.0)) * (0.035 + uAct * 0.07);
  float broad = fbm(q * 0.92 + float2(t * 0.14, -t * 0.18));
  float fold = fbm(q * 1.66 + float2(-t * 0.23, t * 0.19) + 5.2);
  float field = mix(broad, fold, 0.3 + uAct * 0.14);
  float horizon = 0.46 + 0.08 * sin((uv.x + w.x * 0.2) * 5.4 + t * 0.42) + 0.16 * (broad - 0.5);
  float upper = smoothstep(horizon - 0.12, horizon + 0.08, uv.y);
  float d = (uv.y - horizon) * (5.2 + uAct * 0.8);
  float band = exp(-(d * d));
  float3 col = mix(uLower, uUpper, upper);
  col = mix(col, uDeep, upper * (0.14 + smoothstep(0.42, 0.78, fold) * 0.5));
  col = mix(col, uLight, clamp(band * (0.42 + smoothstep(0.24, 0.79, field) * 0.62), 0.0, 0.88));
  col = mix(col, uLight, (1.0 - upper) * smoothstep(0.58, 0.9, broad) * 0.18);
  col = mix(col, uLight, smoothstep(0.38, 0.5, r) * 0.14);
  col = col * uDim + (noise(fragCoord * 0.64) - 0.5) / 255.0;
  return half4(half3(col * edge), half(edge));
}
"""

/**
 * The voice orb. Colour shows who is talking; the simulated audio level rises in about 210 ms and
 * falls in about 380 ms, and drift speed and size follow it at a calm 75% of orb-ui's tempo.
 * Reduce Motion keeps a still frame and only crossfades colour.
 */
@Composable
fun Orb(state: LiveState, size: Dp, onInterrupt: () -> Unit, modifier: Modifier = Modifier, still: Boolean = false) {
    val reduce = Theme.reduceMotion || still
    val dim = if (Theme.colors.night) 0.84f else 1f
    val target = Palettes.getValue(state)
    val palette = target.mapIndexed { i, c -> animateColorAsState(c, tween(500), label = "orb$i").value }
    val shader = remember { createCloudShader() }
    val current by rememberUpdatedState(state)
    var time by remember { mutableFloatStateOf(7.3f) }
    var activity by remember { mutableFloatStateOf(0f) }
    var scale by remember { mutableFloatStateOf(0.94f) }

    LaunchedEffect(reduce) {
        if (reduce) return@LaunchedEffect
        var last = 0L; var goal = 0f; var nextPick = 0L
        while (true) {
            withFrameNanos { now ->
                val dt = if (last == 0L) 0f else ((now - last) / 1e9f).coerceAtMost(0.05f)
                last = now
                val s = current
                val live = s == LiveState.Speaking || s == LiveState.Listening
                if (now > nextPick) {
                    goal = if (live) 0.25f + Random.nextFloat() * 0.75f else if (s == LiveState.Thinking) 0.2f else 0f
                    nextPick = now + (if (s == LiveState.Speaking) 130_000_000L else 190_000_000L)
                }
                activity += (goal - activity) * ease(dt, if (goal > activity) 210f else 380f)
                time += dt * 0.75f * when (s) {
                    LiveState.Speaking -> 1.65f + 1.55f * activity
                    LiveState.Listening -> 0.72f + 0.78f * activity
                    LiveState.Thinking -> 1f
                    else -> 0.24f
                }
                val size = when (s) { LiveState.Speaking -> 1f + 0.1f * activity; LiveState.Listening -> 0.95f + 0.07f * activity; else -> 0.94f }
                scale += (size - scale) * ease(dt, 250f)
            }
        }
    }

    val stillActivity = if (state == LiveState.Speaking || state == LiveState.Listening) 0.45f else 0f
    val canInterrupt = state == LiveState.Speaking
    val source = remember { MutableInteractionSource() }
    Box(
        // A still orb is a picture on a card: it takes no taps and screen readers skip it.
        modifier.size(size).then(
            if (still) Modifier.clearAndSetSemantics {}
            else Modifier.clickable(source, indication = null, enabled = canInterrupt, role = Role.Button, onClick = onInterrupt)
                .semantics { contentDescription = if (canInterrupt) "Interrupt the Companion" else "Voice session, " + state.label },
        ),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize().graphicsLayer {
            val s = if (reduce) 1.1f else scale * (1.06f + activity * 0.22f)
            scaleX = s; scaleY = s
            alpha = if (still) 0f else if (state == LiveState.Speaking || state == LiveState.Listening) (if (reduce) 0.35f else 0.16f + activity * 0.34f) else 0f
        }) {
            drawCircle(Brush.radialGradient(listOf(palette[2], palette[2].copy(alpha = 0f))), radius = this.size.minDimension / 2)
        }
        Canvas(Modifier.fillMaxSize().padding(size * 0.11f).graphicsLayer {
            val s = if (reduce) (if (stillActivity > 0f) 1f else 0.94f) else scale
            scaleX = s; scaleY = s
        }) {
            val brush = shader?.brush(this.size.width, this.size.height, time, if (reduce) stillActivity else activity, dim, palette)
                ?: Brush.radialGradient(listOf(palette[3], palette[2], palette[1]), center = Offset(this.size.width * 0.38f, this.size.height * 0.32f), radius = this.size.minDimension * 0.75f)
            drawCircle(brush)
        }
        if (state == LiveState.Thinking) ThinkingArc(reduce)
    }
}

@Composable
private fun ThinkingArc(reduce: Boolean) {
    val accent = Theme.colors.accent
    val angle = if (reduce) 30f else rememberInfiniteTransition(label = "arc")
        .animateFloat(0f, 360f, infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Restart), label = "angle").value
    Canvas(Modifier.fillMaxSize().padding(4.dp)) {
        drawArc(accent, startAngle = angle, sweepAngle = 90f, useCenter = false, style = Stroke(width = 2.dp.toPx()))
    }
}

private fun ease(dt: Float, ms: Float): Float = 1f - 0.1f.pow(dt * 1000f / ms)
