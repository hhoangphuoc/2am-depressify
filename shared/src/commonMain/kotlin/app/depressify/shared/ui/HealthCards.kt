package app.depressify.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.depressify.core.SuggestionKind
import app.depressify.shared.state.WeekDay
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.ui.theme.Theme

// Health-style building blocks shared by Today, History, Signals and Summary (interface design, "Health-style cards").

@Composable
fun HealthCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Theme.colors.soft).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        content = content,
    )
}

/** Round tile behind an icon that names a Signal, a rating or a kind of Suggestion. It always sits beside its text label. */
@Composable
fun IconTile(icon: ImageVector, on: Boolean = true, size: Dp = 36.dp) {
    val tint = if (on) Theme.colors.accent else Theme.colors.muted
    Box(Modifier.size(size).background(tint.copy(alpha = if (on) 0.15f else 0.12f), CircleShape), contentAlignment = Alignment.Center) {
        Icon(icon, size * 0.56f, tint)
    }
}

/** Seven days; a bar fills once a Check-in exists for that day. Other days stay neutral: nothing is marked as missed and nothing resets. */
@Composable
fun WeekBar(days: List<WeekDay>) {
    val c = Theme.colors
    val count = days.count { it.done }
    Column(Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = "$count Check-ins in the last 7 days" }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Txt("This week · $count Check-ins", DepressifyType.meta, c.muted)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            days.forEach { d ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.fillMaxWidth().height(8.dp).background(if (d.done) c.accent else if (d.today) c.accent.copy(alpha = 0.35f) else c.border, RoundedCornerShape(4.dp)))
                    Txt(d.letter, DepressifyType.label, c.muted)
                }
            }
        }
    }
}

/** A 1 to 5 rating as five dots. An unanswered rating draws nothing, so it never reads as a low value. */
@Composable
fun RatingDots(value: Int?, label: String) {
    if (value == null) return
    val c = Theme.colors
    Row(Modifier.clearAndSetSemantics { contentDescription = "$label $value of 5" }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        repeat(5) { Box(Modifier.size(8.dp).background(if (it < value) c.accent else c.border, CircleShape)) }
    }
}

/** One-of-a-few switch, used for Mood, Energy and Sleep quality. */
@Composable
fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    val c = Theme.colors
    Row(Modifier.fillMaxWidth().background(c.ink.copy(alpha = 0.07f), CircleShape).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier.weight(1f).heightIn(min = 40.dp).clip(CircleShape).background(if (on) c.ground else Color.Transparent)
                    .clickable(role = Role.Tab, onClick = { onSelect(i) }).semantics { this.selected = on },
                contentAlignment = Alignment.Center,
            ) { Txt(label, DepressifyType.meta.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal), if (on) c.ink else c.muted) }
        }
    }
}

val SuggestionKind?.icon: ImageVector
    get() = when (this) {
        SuggestionKind.Walk -> PhosphorIcons.personSimpleWalk
        SuggestionKind.Window -> PhosphorIcons.sunHorizon
        SuggestionKind.Music -> PhosphorIcons.musicNotes
        SuggestionKind.Read -> PhosphorIcons.bookOpen
        SuggestionKind.Game -> PhosphorIcons.gameController
        SuggestionKind.Call -> PhosphorIcons.phone
        null -> PhosphorIcons.chatCircle
    }
