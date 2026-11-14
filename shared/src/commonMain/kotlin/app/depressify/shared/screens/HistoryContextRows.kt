package app.depressify.shared.screens

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.depressify.core.model.Signal
import app.depressify.shared.state.PatientState
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.ui.theme.Theme
import kotlin.math.roundToInt

/** Saved context belongs in History; only actionable tool results belong in the conversation. */
@Composable
internal fun HistoryContextRows(state: PatientState) {
    val c = Theme.colors
    SoftCard {
        Txt("Your recent Check-ins", DepressifyType.titleSmall, c.ink, heading = true)
        val latest = state.history.firstOrNull()
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(PhosphorIcons.chatCircle, 24.dp, c.accent)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt(latest?.date ?: "No Check-ins yet", DepressifyType.meta, c.ink)
                Txt(latest?.ratings?.mood?.let { "Latest mood · $it of 5" } ?: "Mood not recorded", DepressifyType.small, c.muted)
            }
            RatingDots(latest?.ratings?.mood, "Latest mood")
        }
    }
    SoftCard {
        Txt("Your last 7 days", DepressifyType.titleSmall, c.ink, heading = true)
        val signals = listOf(Signal.STEPS, Signal.SLEEP_MINUTES, Signal.LATE_NIGHT_SCREEN_MINUTES)
        val labels = listOf("steps", "sleep", "late-night screen")
        val icons = listOf(PhosphorIcons.footprints, PhosphorIcons.moon, PhosphorIcons.deviceMobile)
        signals.forEachIndexed { index, signal ->
            val values = state.historyDays.mapNotNull { it.values[signal.key] }.filter { it.isFinite() && it >= 0 }
            val average = values.takeIf { it.isNotEmpty() }?.average()?.roundToInt()
            val value = when {
                average == null -> "—"
                signal == Signal.SLEEP_MINUTES -> "${average / 60} h ${average % 60} min"
                signal == Signal.LATE_NIGHT_SCREEN_MINUTES -> "$average min"
                else -> average.toString()
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(icons[index], 22.dp, c.accent)
                Txt("$value ${labels[index]}", DepressifyType.meta, c.ink, Modifier.weight(1f))
                Txt(if (values.isEmpty()) "No data" else "${values.size} ${if (values.size == 1) "day" else "days"}", DepressifyType.small, c.muted)
            }
        }
        Txt("Daily averages · recorded days only", DepressifyType.small, c.muted)
    }
}
