package com.twoam.companion.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.twoam.companion.sharing.SharingAction
import com.twoam.companion.sharing.SharingPrivacySection
import com.twoam.companion.sharing.SharingState
import com.twoam.companion.sharing.Title
import com.twoam.companion.ui.theme.SmallStepTokens

object SettingsCopy {
    const val TITLE: String = "Settings"
}

/** Settings. Later slices add Signals and their Consents, quiet hours and Nudges. */
@Composable
fun SettingsSurface(sharing: SharingState, onSharingAction: (SharingAction) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(SmallStepTokens.Size.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(SmallStepTokens.Size.Gap),
    ) {
        Title(SettingsCopy.TITLE)
        SharingPrivacySection(sharing, onSharingAction)
    }
}
