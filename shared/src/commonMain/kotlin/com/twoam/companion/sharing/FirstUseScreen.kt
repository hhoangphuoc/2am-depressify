package com.twoam.companion.sharing

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.twoam.companion.core.model.SharingConsent
import com.twoam.companion.ui.theme.SmallStepTokens

/** First use: the welcome, then the sharing choice. Both choices lead to Today. */
@Composable
fun FirstUseSurface(state: SharingState, onAction: (SharingAction) -> Unit, modifier: Modifier = Modifier) {
    when (state.firstUseStep) {
        FirstUseStep.Welcome -> WelcomeSurface(onContinue = { onAction(SharingAction.Continue) }, modifier = modifier)
        FirstUseStep.Choice -> SharingChoiceSurface(state, onAction, modifier)
    }
}

/** Names the AI Companion in one sentence before anything else. */
@Composable
fun WelcomeSurface(onContinue: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(SmallStepTokens.Size.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(SmallStepTokens.Size.Gap, Alignment.CenterVertically),
    ) {
        Title(SharingCopy.WELCOME_TITLE)
        Body(SharingCopy.WELCOME_LINE)
        Body(SharingCopy.WELCOME_AI)
        PrimaryButton(SharingCopy.CONTINUE, onContinue)
    }
}

/**
 * The sharing choice: who the Clinician is, exactly what they would see, a sample Summary, and two
 * equal choices. A failed save keeps the Patient here with the reason, and nothing is shared.
 */
@Composable
fun SharingChoiceSurface(state: SharingState, onAction: (SharingAction) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(SmallStepTokens.Size.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(SmallStepTokens.Size.Gap),
    ) {
        Title(SharingCopy.CHOICE_TITLE)
        Body(SharingCopy.choiceIntro(state.clinicianEmail))
        SectionTitle(SharingCopy.WHAT_IS_SHARED_TITLE)
        Bullets(SharingCopy.WHAT_IS_SHARED)
        Body(SharingCopy.NOT_SHARED)
        SampleSummary()
        Body(SharingCopy.DECLINE_NOTE, muted = true)
        state.error?.let { Notice(it, assertive = true) }
        if (state.isSaving) Notice(SharingCopy.SAVING)
        ChoicePair(
            first = SharingCopy.SHARE,
            onFirst = { onAction(SharingAction.Choose(SharingConsent.granted)) },
            second = SharingCopy.DONT_SHARE,
            onSecond = { onAction(SharingAction.Choose(SharingConsent.declined)) },
            enabled = !state.isSaving,
        )
    }
}

/** A short, invented Summary, so the Patient sees what their Clinician would read. */
@Composable
private fun SampleSummary() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp))
            .border(SmallStepTokens.Size.Hairline, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .padding(SmallStepTokens.Size.Gap),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(SharingCopy.SAMPLE_TITLE, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SharingCopy.SAMPLE_SUMMARY.forEach {
            Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}
