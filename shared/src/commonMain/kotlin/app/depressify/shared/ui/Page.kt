package app.depressify.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.depressify.shared.state.Route
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.resources.Res
import app.depressify.shared.resources.wordmark_leaf
import app.depressify.shared.resources.wordmark_text
import org.jetbrains.compose.resources.painterResource

/**
 * Page frame: safe-area insets at the top and sides, scrolling content capped at 560 dp so tablets
 * keep a calm reading width, and an optional fixed bottom bar that owns the bottom inset.
 */
@Composable
fun Page(
    top: @Composable () -> Unit = {},
    bottom: (@Composable () -> Unit)? = null,
    notice: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Theme.colors
    Column(
        Modifier.fillMaxSize().background(c.ground)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)),
    ) {
        top()
        Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(horizontal = 24.dp).padding(top = 8.dp, bottom = 32.dp)
                    .then(if (bottom == null) Modifier.windowInsetsPadding(WindowInsets.navigationBars) else Modifier),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                if (notice != null) {
                    Txt(notice, DepressifyType.meta, c.ok, Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                }
                content()
            }
        }
        bottom?.invoke()
    }
}

@Composable
fun BrandHeader(onDemo: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { Wordmark() }
        Box(Modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onDemo).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
            Txt("Demo", DepressifyType.small, Theme.colors.muted)
        }
    }
}

/** Logo lettering: the text layer follows the theme ink so it stays readable at night; the leaf over the i keeps its own colour. */
@Composable
private fun Wordmark() {
    Box(Modifier.height(30.dp).semantics { heading(); contentDescription = "Depressify" }) {
        Image(painterResource(Res.drawable.wordmark_text), contentDescription = null, colorFilter = ColorFilter.tint(Theme.colors.ink))
        Image(painterResource(Res.drawable.wordmark_leaf), contentDescription = null, modifier = Modifier.matchParentSize())
    }
}


@Composable
fun TabBar(current: Route, onSelect: (Route) -> Unit) {
    val c = Theme.colors
    val tabs = listOf(Triple(Route.Today, "Today", PhosphorIcons.house), Triple(Route.History, "History", PhosphorIcons.chartBar), Triple(Route.Settings, "Settings", PhosphorIcons.gear))
    Row(Modifier.fillMaxWidth().background(c.ground).windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 16.dp, vertical = 6.dp)) {
        tabs.forEach { (route, label, icon) ->
            val on = route == current
            Column(
                Modifier.weight(1f).heightIn(min = 52.dp)
                    .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Tab) { onSelect(route) }
                    .semantics { selected = on },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(icon, 23.dp, if (on) c.ink else c.muted)
                Spacer(Modifier.height(4.dp))
                Txt(label, DepressifyType.small.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal), if (on) c.ink else c.muted)
            }
        }
    }
}
