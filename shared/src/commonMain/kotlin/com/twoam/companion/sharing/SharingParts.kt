package com.twoam.companion.sharing

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.twoam.companion.ui.theme.PillShape
import com.twoam.companion.ui.theme.SmallStepTokens

/** The one primary action of a screen: a filled ink pill. */
@Composable
internal fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = PillShape,
        modifier = modifier.fillMaxWidth().heightIn(min = SmallStepTokens.Size.MinTouchTarget),
    ) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

/**
 * A button for one side of a real choice. Both sides of a choice use this, so neither looks like
 * the expected answer: same shape, size, outline and weight.
 */
@Composable
internal fun ChoiceButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = PillShape,
        border = BorderStroke(SmallStepTokens.Size.Hairline, MaterialTheme.colorScheme.primary),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        modifier = modifier.fillMaxWidth().heightIn(min = SmallStepTokens.Size.MinTouchTarget),
    ) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

/** Two choices side by side with equal width. */
@Composable
internal fun ChoicePair(
    first: String,
    onFirst: () -> Unit,
    second: String,
    onSecond: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(SmallStepTokens.Size.Gap)) {
        ChoiceButton(first, onFirst, Modifier.weight(1f), enabled)
        ChoiceButton(second, onSecond, Modifier.weight(1f), enabled)
    }
}

@Composable
internal fun Title(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.headlineMedium,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = modifier.semantics { heading() },
    )
}

@Composable
internal fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = modifier.semantics { heading() },
    )
}

@Composable
internal fun Body(text: String, modifier: Modifier = Modifier, muted: Boolean = false) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        color = if (muted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onBackground,
        modifier = modifier,
    )
}

@Composable
internal fun Bullets(lines: List<String>, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        lines.forEach { line ->
            Row {
                Text("•", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onBackground)
                Text(
                    line,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}

/** Saving or failure feedback, announced to screen readers. Ink text, never a status colour. */
@Composable
internal fun Notice(text: String, modifier: Modifier = Modifier, assertive: Boolean = false) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = modifier.semantics {
            liveRegion = if (assertive) LiveRegionMode.Assertive else LiveRegionMode.Polite
        },
    )
}
