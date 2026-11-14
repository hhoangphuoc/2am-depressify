package app.depressify.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight

/** Pill shape for primary buttons. */
val PillShape = RoundedCornerShape(percent = 50)

private val SmallStepColors = lightColorScheme(
    primary = SmallStepTokens.Colors.Ink,
    onPrimary = SmallStepTokens.Colors.OnInk,
    secondary = SmallStepTokens.Colors.InkMuted,
    onSecondary = SmallStepTokens.Colors.OnInk,
    background = SmallStepTokens.Colors.Paper,
    onBackground = SmallStepTokens.Colors.Ink,
    surface = SmallStepTokens.Colors.Surface,
    onSurface = SmallStepTokens.Colors.Ink,
    onSurfaceVariant = SmallStepTokens.Colors.InkMuted,
    outline = SmallStepTokens.Colors.Hairline,
    outlineVariant = SmallStepTokens.Colors.Hairline,
)

// System sans throughout; sizes in sp so text scales with the system setting (up to 200 percent).
private val SmallStepTypography = Typography(
    headlineMedium = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.SemiBold, fontSize = SmallStepTokens.Type.Title),
    bodyLarge = TextStyle(fontFamily = FontFamily.Default, fontSize = SmallStepTokens.Type.Body),
    labelLarge = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = SmallStepTokens.Type.Label),
)

private val SmallStepShapes = Shapes(
    small = RoundedCornerShape(8),
    medium = RoundedCornerShape(12),
    large = RoundedCornerShape(16),
)

@Composable
fun SmallStepTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SmallStepColors,
        typography = SmallStepTypography,
        shapes = SmallStepShapes,
        content = content,
    )
}
