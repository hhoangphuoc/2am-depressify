package app.depressify.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import app.depressify.history.HistoryState
import app.depressify.history.HistorySurface
import app.depressify.settings.SettingsSurface
import app.depressify.sharing.SharingAction
import app.depressify.sharing.SharingState
import app.depressify.today.TodayState
import app.depressify.today.TodaySurface
import app.depressify.ui.theme.SmallStepTokens

/** The three persistent destinations. The Check-in (later) is a focused task with the tab bar hidden. */
enum class Destination(val label: String) {
    TODAY("Today"),
    HISTORY("History"),
    SETTINGS("Settings"),
}

/** The three-tab shell, holding which destination is selected. Opens on Today. */
@Composable
fun AppShell(sharing: SharingState, onSharingAction: (SharingAction) -> Unit, modifier: Modifier = Modifier) {
    var selected by rememberSaveable { mutableStateOf(Destination.TODAY) }
    AppShellSurface(selected = selected, onSelect = { selected = it }, modifier = modifier) { destination ->
        when (destination) {
            Destination.TODAY -> TodaySurface(TodayState.Empty)
            Destination.HISTORY -> HistorySurface(HistoryState.Empty)
            Destination.SETTINGS -> SettingsSurface(sharing, onSharingAction)
        }
    }
}

/** Stateless shell: a flat tab bar at the bottom with 48dp minimum targets and no status colours. */
@Composable
fun AppShellSurface(
    selected: Destination,
    onSelect: (Destination) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (Destination) -> Unit,
) {
    Column(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Box(Modifier.weight(1f).fillMaxWidth()) { content(selected) }
        HorizontalDivider(thickness = SmallStepTokens.Size.Hairline, color = MaterialTheme.colorScheme.outline)
        Row(
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .navigationBarsPadding()
                .selectableGroup(),
        ) {
            Destination.entries.forEach { destination ->
                Tab(
                    label = destination.label,
                    selected = destination == selected,
                    onClick = { onSelect(destination) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun Tab(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .heightIn(min = SmallStepTokens.Size.MinTouchTarget)
            .selectable(selected = selected, onClick = onClick, role = Role.Tab),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Selection is shown by an ink rule and weight, never by a status colour.
        Box(
            Modifier
                .fillMaxWidth()
                .height(SmallStepTokens.Size.Hairline * 2)
                .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface),
        )
        Box(Modifier.heightIn(min = SmallStepTokens.Size.MinTouchTarget), contentAlignment = Alignment.Center) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
