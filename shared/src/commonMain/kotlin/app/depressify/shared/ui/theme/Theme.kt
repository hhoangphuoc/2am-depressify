package app.depressify.shared.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.depressify.shared.isReduceMotionEnabled

/** Small Step tokens from docs/design/interface-design.md. Night runs 22:00 to 05:00. */
@Immutable
data class DepressifyColors(
    val night: Boolean,
    val ground: Color,
    val ink: Color,
    val onInk: Color,
    val muted: Color,
    val body: Color,
    val soft: Color,
    val border: Color,
    val line: Color,
    val field: Color,
    val accent: Color,
    val notice: Color,
    val error: Color,
    val errorBg: Color,
    val ok: Color,
    val disabledBg: Color,
    val disabled: Color,
)

val DayColors = DepressifyColors(
    night = false,
    ground = Color(0xFFFAFAF7), ink = Color(0xFF233C4C), onInk = Color.White, muted = Color(0xFF59656B),
    body = Color(0xFF555555), soft = Color(0xFFE9EDF0), border = Color(0xFFD7DDE0), line = Color(0xFFE4E7E7),
    field = Color.White, accent = Color(0xFF326B73), notice = Color(0xFFEEF1F1), error = Color(0xFF8B3636),
    errorBg = Color(0xFFF6EAEA), ok = Color(0xFF2B6457), disabledBg = Color(0xFFDCE1E3), disabled = Color(0xFF626C70),
)

val NightColors = DepressifyColors(
    night = true,
    ground = Color(0xFF101B21), ink = Color(0xFFE4EBE8), onInk = Color(0xFF101B21), muted = Color(0xFF9FB1B5),
    body = Color(0xFFC3CECB), soft = Color(0xFF1B2A31), border = Color(0xFF33464E), line = Color(0xFF25363D),
    field = Color(0xFF16242A), accent = Color(0xFF8CC1C2), notice = Color(0xFF1B2A31), error = Color(0xFFF0B4B0),
    errorBg = Color(0xFF3A2226), ok = Color(0xFF9FD1C2), disabledBg = Color(0xFF26353C), disabled = Color(0xFF8A989C),
)

/** Type scale: size-specific tracking, tight leading on large text, system sans throughout. */
object DepressifyType {
    val todayHeadline = TextStyle(fontSize = 44.sp, lineHeight = 46.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.03).em)
    val display = TextStyle(fontSize = 32.sp, lineHeight = 36.sp, fontWeight = FontWeight(650), letterSpacing = (-0.025).em)
    val title = TextStyle(fontSize = 24.sp, lineHeight = 29.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.02).em)
    val titleSmall = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontSize = 16.sp, lineHeight = 24.sp)
    val bodyStrong = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium)
    val bodyLarge = TextStyle(fontSize = 19.sp, lineHeight = 30.sp)
    val caption = TextStyle(fontSize = 21.sp, lineHeight = 30.sp)
    val meta = TextStyle(fontSize = 14.sp, lineHeight = 20.sp)
    val small = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val label = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.04.em)
}

val LocalColors = staticCompositionLocalOf { DayColors }
val LocalReduceMotion = staticCompositionLocalOf { false }

object Theme {
    val colors: DepressifyColors @Composable get() = LocalColors.current
    val reduceMotion: Boolean @Composable get() = LocalReduceMotion.current
}

@Composable
fun DepressifyTheme(night: Boolean, content: @Composable () -> Unit) {
    val reduce = remember { isReduceMotionEnabled() }
    CompositionLocalProvider(
        LocalColors provides if (night) NightColors else DayColors,
        LocalReduceMotion provides reduce,
        content = content,
    )
}
