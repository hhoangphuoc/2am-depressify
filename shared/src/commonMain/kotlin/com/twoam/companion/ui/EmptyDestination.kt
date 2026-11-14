package com.twoam.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.twoam.companion.ui.theme.SmallStepTokens

/** A destination with a title and one calm line, used until the destination has real content. */
@Composable
internal fun EmptyDestination(title: String, line: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(SmallStepTokens.Size.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(SmallStepTokens.Size.Gap),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.semantics { heading() },
        )
        Text(text = line, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
