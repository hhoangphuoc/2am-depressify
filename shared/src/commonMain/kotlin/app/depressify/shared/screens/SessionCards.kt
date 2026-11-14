package app.depressify.shared.screens

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import app.depressify.shared.ui.*
import app.depressify.shared.ui.theme.DepressifyType
import app.depressify.shared.ui.theme.Theme
import app.depressify.shared.voice.live.*

/** The same actionable content in both conversation modes; the music stays near the conversation. */
@Composable
internal fun SessionToolCards(cards: List<ToolCard>, playback: MusicPlayback, onOpenMusic: () -> Unit, musicActions: @Composable () -> Unit) {
    cards.filterIsInstance<ToolCard.Music>().forEach { MusicSuggestionCard(it, playback, onOpenMusic, musicActions) }
    cards.asReversed().filterNot { it is ToolCard.Music }.forEach { card ->
        when (card) {
            is ToolCard.Places -> PlacesSessionCard(card)
            is ToolCard.Weather -> {
                val uri = LocalUriHandler.current
                SoftCard {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(PhosphorIcons.sunHorizon, 24.dp, Theme.colors.accent)
                        Txt("Outside right now", DepressifyType.titleSmall, Theme.colors.ink)
                    }
                    Txt(card.line, DepressifyType.body, Theme.colors.ink)
                    TextLink(card.sourceTitle, { uri.openUri(card.sourceUrl) })
                }
            }
            is ToolCard.Music -> Unit
        }
    }
}

@Composable
private fun PlacesSessionCard(card: ToolCard.Places) {
    val c = Theme.colors
    val uri = LocalUriHandler.current
    SoftCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(PhosphorIcons.mapPin, 22.dp, c.accent)
            Txt("A little time outside", DepressifyType.titleSmall, c.ink)
        }
        Txt(card.query, DepressifyType.body, c.ink)
        card.places.forEach { place ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Txt(place.name, DepressifyType.bodyStrong, c.ink)
                    Txt(place.walkMinutes?.let { "$it min walk" } ?: (CompanionTools.distanceLabel(place.distanceMeters) + " away"), DepressifyType.small, c.muted)
                }
                IconButton(PhosphorIcons.arrowSquareOut, "Open ${place.name} in Google Maps", { uri.openUri(place.mapsUrl) })
            }
        }
        if (card.places.isEmpty()) TextLink("Search in Google Maps", { uri.openUri(card.url) })
        Txt("Places from Google Maps", DepressifyType.small, c.muted)
    }
}
