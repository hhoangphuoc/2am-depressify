package app.depressify.shared.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.depressify.shared.ui.theme.DayColors
import app.depressify.shared.ui.theme.LocalColors
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.ui.theme.DepressifyType

private val EaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)

@Composable
fun Txt(
    text: String,
    style: TextStyle = DepressifyType.body,
    color: Color = Theme.colors.body,
    modifier: Modifier = Modifier,
    align: TextAlign? = null,
    heading: Boolean = false,
) {
    BasicText(
        text = text,
        style = style.copy(color = color, textAlign = align ?: TextAlign.Unspecified),
        modifier = if (heading) modifier.semantics { heading() } else modifier,
    )
}

/** Press feedback: a quick 0.97 scale on touch-down, skipped under Reduce Motion. */
@Composable
private fun Modifier.pressScale(source: MutableInteractionSource): Modifier {
    val pressed by source.collectIsPressedAsState()
    val reduce = Theme.reduceMotion
    val scale by animateFloatAsState(if (pressed && !reduce) 0.97f else 1f, tween(160, easing = EaseOut))
    return graphicsLayer { scaleX = scale; scaleY = scale }
}

@Composable
fun Icon(icon: ImageVector, size: Dp = 22.dp, color: Color = Theme.colors.ink, description: String? = null, modifier: Modifier = Modifier) {
    Image(icon, contentDescription = description, colorFilter = ColorFilter.tint(color), modifier = modifier.size(size))
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true, large: Boolean = false) {
    val c = Theme.colors
    val source = remember { MutableInteractionSource() }
    Row(
        modifier.fillMaxWidth().pressScale(source).heightIn(min = if (large) 60.dp else 52.dp).clip(CircleShape)
            .background(if (enabled) c.ink else c.disabledBg)
            .clickable(source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val fg = if (enabled) c.onInk else c.disabled
        if (icon != null) { Icon(icon, if (large) 26.dp else 22.dp, fg); Spacer(Modifier.width(10.dp)) }
        Txt(text, (if (large) DepressifyType.titleSmall.copy(fontSize = DepressifyType.caption.fontSize) else DepressifyType.bodyStrong).copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), fg)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    val c = Theme.colors
    val source = remember { MutableInteractionSource() }
    Box(
        modifier.fillMaxWidth().pressScale(source).heightIn(min = 52.dp).clip(CircleShape).border(1.dp, c.border, CircleShape)
            .clickable(source, indication = null, role = Role.Button, onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) { Icon(icon, 22.dp, c.ink); Spacer(Modifier.width(10.dp)) }
            Txt(text, DepressifyType.body, c.ink)
        }
    }
}

/** Underlined text action with a 44 dp touch target. */
@Composable
fun TextLink(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, trailing: ImageVector? = null, color: Color = Theme.colors.ink) {
    val source = remember { MutableInteractionSource() }
    Row(
        modifier.heightIn(min = 44.dp).pressScale(source).clickable(source, indication = null, role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(text, DepressifyType.body.copy(textDecoration = TextDecoration.Underline), color)
        if (trailing != null) { Spacer(Modifier.width(8.dp)); Icon(trailing, 18.dp, color) }
    }
}

@Composable
fun SoftCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Theme.colors.soft).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
fun Notice(text: String, modifier: Modifier = Modifier, title: String? = null, error: Boolean = false, content: @Composable ColumnScope.() -> Unit = {}) {
    val c = Theme.colors
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (error) c.errorBg else c.notice).padding(16.dp)
            .semantics(mergeDescendants = false) {},
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (title != null) Txt(title, DepressifyType.titleSmall, c.ink, heading = true)
        Txt(text, DepressifyType.meta, if (error) c.error else c.body)
        content()
    }
}

@Composable
fun ListRow(title: String, detail: String? = null, onClick: () -> Unit, end: String? = null) {
    val c = Theme.colors
    val source = remember { MutableInteractionSource() }
    Column(Modifier.fillMaxWidth().clickable(source, indication = null, role = Role.Button, onClick = onClick)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 68.dp).padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt(title, DepressifyType.bodyStrong, c.ink)
                if (detail != null) Txt(detail, DepressifyType.meta, c.muted)
            }
            if (end != null) { Txt(end, DepressifyType.meta, c.muted); Spacer(Modifier.width(6.dp)) }
            Icon(PhosphorIcons.caretRight, 17.dp, c.muted)
        }
        Divider()
    }
}

@Composable
fun Divider() = Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.colors.line))

/** A plain disclosure row: + to open, − to close. Keeps detail one level deeper. */
@Composable
fun Disclosure(title: String, initiallyOpen: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val c = Theme.colors
    var open by rememberSaveable { mutableStateOf(initiallyOpen) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).toggleable(open, role = Role.Button) { open = it }
                .semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt(title, DepressifyType.bodyStrong.copy(fontSize = DepressifyType.meta.fontSize.times(15f / 14f)), c.ink, Modifier.weight(1f))
            Icon(if (open) PhosphorIcons.minus else PhosphorIcons.plus, 18.dp, c.ink)
        }
        if (open) Column(Modifier.padding(bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
        Divider()
    }
}

@Composable
fun RatingRow(value: Int?, onSelect: (Int) -> Unit, low: String, high: String, label: String) {
    val c = Theme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for (v in 1..5) {
                val on = value == v
                Box(
                    Modifier.weight(1f).heightIn(min = 52.dp).clip(CircleShape).background(if (on) c.ink else Color.Transparent)
                        .border(1.dp, if (on) c.ink else c.border, CircleShape)
                        .clickable(role = Role.RadioButton) { onSelect(v) }
                        .semantics { selected = on; stateDescription = "$label $v of 5" },
                    contentAlignment = Alignment.Center,
                ) { Txt(v.toString(), DepressifyType.title.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal, fontSize = DepressifyType.caption.fontSize), if (on) c.onInk else c.ink) }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            Txt(low, DepressifyType.small, c.muted, Modifier.weight(1f))
            Txt(high, DepressifyType.small, c.muted)
        }
    }
}

/** Small selectable pill for choices such as booking times. */
@Composable
fun ChoicePill(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    val c = Theme.colors
    Box(
        modifier.heightIn(min = 44.dp).widthIn(min = 64.dp).clip(CircleShape).background(if (selected) c.ink else Color.Transparent)
            .border(1.dp, if (selected) c.ink else c.border, CircleShape).clickable(role = Role.RadioButton, onClick = onClick)
            .semantics { this.selected = selected }.padding(horizontal = if (icon != null) 12.dp else 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) { Icon(icon, 18.dp, if (selected) c.onInk else c.ink); Spacer(Modifier.width(6.dp)) }
            Txt(text, DepressifyType.meta, if (selected) c.onInk else c.ink)
        }
    }
}

@Composable
fun Switch(checked: Boolean, onChange: (Boolean) -> Unit, label: String) {
    val c = Theme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).toggleable(checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(label, DepressifyType.body, c.ink, Modifier.weight(1f))
        Box(Modifier.size(width = 50.dp, height = 30.dp).clip(CircleShape).background(if (checked) c.accent else c.border).padding(3.dp),
            contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart) {
            Box(Modifier.size(24.dp).clip(CircleShape).background(Color.White))
        }
    }
}

/** Top toolbar: back, title, optional trailing slot. */
@Composable
fun TopBar(title: String?, onBack: (() -> Unit)?, trailing: @Composable RowScope.() -> Unit = {}, center: @Composable (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) IconButton(PhosphorIcons.arrowLeft, "Back", onBack) else Spacer(Modifier.width(16.dp))
        Box(Modifier.weight(1f), contentAlignment = if (center != null) Alignment.Center else Alignment.CenterStart) {
            if (center != null) center() else if (title != null) Txt(title, DepressifyType.titleSmall, Theme.colors.ink, heading = true)
        }
        trailing()
    }
}

@Composable
fun IconButton(icon: ImageVector, description: String, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    Box(Modifier.size(48.dp).pressScale(source).clickable(source, indication = null, role = Role.Button, onClick = onClick)
        .semantics { this.contentDescription = description }, contentAlignment = Alignment.Center) {
        Icon(icon, 22.dp, Theme.colors.ink)
    }
}

/** Bottom sheet built on Dialog. Sheets stay light, also in the night theme. */
@Composable
fun CalmSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        CompositionLocalProvider(LocalColors provides DayColors) {
            Box(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { onDismiss() } }, contentAlignment = Alignment.BottomCenter) {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)).background(Color.White)
                        .pointerInput(Unit) { detectTapGestures { } }
                        .windowInsetsPadding(WindowInsets.navigationBars).padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Box(Modifier.align(Alignment.CenterHorizontally).size(width = 36.dp, height = 5.dp).clip(CircleShape).background(DayColors.border))
                    Txt(title, DepressifyType.title, DayColors.ink, heading = true)
                    content()
                }
            }
        }
    }
}
