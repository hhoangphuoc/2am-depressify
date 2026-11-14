package com.twoam.companion.settings

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.twoam.companion.ui.EmptyDestination

/** Settings' screen state. Later slices add Signals and Consent, sharing and quiet hours. */
sealed interface SettingsState {
    data object Empty : SettingsState
}

object SettingsCopy {
    const val TITLE: String = "Settings"
    const val EMPTY: String = "Choices about what you share will appear here."
}

@Composable
fun SettingsSurface(state: SettingsState, modifier: Modifier = Modifier) {
    when (state) {
        SettingsState.Empty -> EmptyDestination(SettingsCopy.TITLE, SettingsCopy.EMPTY, modifier)
    }
}
