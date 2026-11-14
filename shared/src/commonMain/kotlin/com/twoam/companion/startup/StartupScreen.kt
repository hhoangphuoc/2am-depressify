package com.twoam.companion.startup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.twoam.companion.ui.theme.PillShape
import com.twoam.companion.ui.theme.SmallStepTokens
import org.koin.compose.viewmodel.koinViewModel

/** View-model-bound startup: shows [ready] once the Patient is signed in and their record exists. */
@Composable
fun StartupRoute(ready: @Composable (patientId: String) -> Unit) {
    val viewModel = koinViewModel<StartupViewModel>()
    val state by viewModel.state.collectAsStateWithLifecycle()
    StartupSurface(state = state, onAction = viewModel::onAction, ready = ready)
}

/** Stateless startup surface. */
@Composable
fun StartupSurface(
    state: StartupState,
    onAction: (StartupAction) -> Unit,
    modifier: Modifier = Modifier,
    ready: @Composable (patientId: String) -> Unit,
) {
    when (state) {
        is StartupState.Ready -> ready(state.patientId)
        StartupState.Starting -> Centered(modifier) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            Text(StartupCopy.STARTING, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        is StartupState.Failed -> Centered(modifier) {
            Text(
                state.message,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Button(
                onClick = { onAction(StartupAction.Retry) },
                shape = PillShape,
                modifier = Modifier.heightIn(min = SmallStepTokens.Size.MinTouchTarget),
            ) {
                Text(StartupCopy.RETRY, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun Centered(modifier: Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(SmallStepTokens.Size.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(SmallStepTokens.Size.Gap, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}
