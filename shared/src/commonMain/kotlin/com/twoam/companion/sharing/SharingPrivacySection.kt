package com.twoam.companion.sharing

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.twoam.companion.core.model.SharingConsent
import com.twoam.companion.ui.theme.SmallStepTokens

/**
 * Settings → Sharing and privacy: the current sharing choice with withdraw (confirmed) or share
 * again, the ratings and Voice cues rows, and how data is handled. Feedback for each choice appears
 * next to that choice.
 */
@Composable
fun SharingPrivacySection(state: SharingState, onAction: (SharingAction) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(SmallStepTokens.Size.Gap)) {
        SectionTitle(SharingCopy.SETTINGS_TITLE)
        SharingChoice(state, onAction)
        HorizontalDivider(thickness = SmallStepTokens.Size.Hairline, color = MaterialTheme.colorScheme.outline)
        PurposeRows(state.purposes, onAction)
        HorizontalDivider(thickness = SmallStepTokens.Size.Hairline, color = MaterialTheme.colorScheme.outline)
        SectionTitle(SharingCopy.DATA_TITLE)
        Bullets(SharingCopy.DATA_HANDLING)
    }
}

@Composable
private fun SharingChoice(state: SharingState, onAction: (SharingAction) -> Unit) {
    Body(SharingCopy.sharingStatus(state.choice, state.clinicianEmail))
    state.error?.let { Notice(it, assertive = true) }
    if (state.isSaving) Notice(SharingCopy.SAVING)
    when {
        state.confirmingWithdrawal -> WithdrawalConfirmation(state, onAction)
        state.choice == SharingConsent.granted ->
            ChoiceButton(SharingCopy.STOP_SHARING, { onAction(SharingAction.RequestWithdrawal) }, enabled = !state.isSaving)
        else -> {
            Body(SharingCopy.shareAgainNote(state.clinicianEmail), muted = true)
            ChoiceButton(
                SharingCopy.SHARE_AGAIN,
                { onAction(SharingAction.Choose(SharingConsent.granted)) },
                enabled = !state.isSaving,
            )
        }
    }
}

/** Names what the Clinician will stop seeing before anything changes. */
@Composable
private fun WithdrawalConfirmation(state: SharingState, onAction: (SharingAction) -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .border(SmallStepTokens.Size.Hairline, MaterialTheme.colorScheme.primary, shape)
            .padding(SmallStepTokens.Size.Gap),
        verticalArrangement = Arrangement.spacedBy(SmallStepTokens.Size.Gap),
    ) {
        SectionTitle(SharingCopy.confirmWithdrawalTitle(state.clinicianEmail))
        Body(SharingCopy.CONFIRM_WITHDRAWAL_BODY)
        ChoicePair(
            first = SharingCopy.KEEP_SHARING,
            onFirst = { onAction(SharingAction.CancelWithdrawal) },
            second = SharingCopy.CONFIRM_STOP,
            onSecond = { onAction(SharingAction.ConfirmWithdrawal) },
            enabled = !state.isSaving,
        )
    }
}

@Composable
private fun PurposeRows(purposes: PurposesState, onAction: (SharingAction) -> Unit) {
    SectionTitle(SharingCopy.CHECK_IN_TITLE)
    when (purposes) {
        PurposesState.Loading -> Body(SharingCopy.LOADING, muted = true)
        is PurposesState.Failed -> {
            Notice(purposes.message)
            ChoiceButton(SharingCopy.TRY_AGAIN, { onAction(SharingAction.RetryPurposes) })
        }
        is PurposesState.Loaded -> {
            PurposeToggle(purposes.ratings, SharingCopy.RATINGS, SharingCopy.RATINGS_DETAIL, onAction)
            PurposeToggle(purposes.voiceCues, SharingCopy.VOICE_CUES, SharingCopy.VOICE_CUES_DETAIL, onAction)
        }
    }
    Body(SharingCopy.CHECK_IN_NOTE, muted = true)
}

@Composable
private fun PurposeToggle(row: PurposeRow, title: String, detail: String, onAction: (SharingAction) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = SmallStepTokens.Size.MinTouchTarget)
                .toggleable(
                    value = row.included,
                    enabled = !row.saving,
                    role = Role.Switch,
                    onValueChange = { onAction(SharingAction.SetIncluded(row.purpose, it)) },
                ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f).padding(end = SmallStepTokens.Size.Gap)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = row.included, onCheckedChange = null, enabled = !row.saving)
        }
        row.error?.let { Notice(it, assertive = true) }
    }
}
