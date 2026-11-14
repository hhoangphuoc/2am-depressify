package app.depressify.shared.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import app.depressify.core.model.PatientLocation
import app.depressify.core.model.SuggestionKind
import app.depressify.shared.data.TodayPlace

/** Whether this build can draw a Google map: the platform's Maps SDK has its key. */
@Composable
expect fun mapsAvailable(): Boolean

/**
 * A calm Google map of [places] around [near], each a pin with the [kind]'s icon and the [selected]
 * one emphasised; tapping a pin calls [onSelect]. Call only when [mapsAvailable].
 */
@Composable
expect fun PlacesMap(near: PatientLocation?, places: List<TodayPlace>, selected: Int, onSelect: (Int) -> Unit, kind: SuggestionKind, modifier: Modifier)

/** The icon on a place's pin and row: what the place is for. */
val SuggestionKind.placeIcon: ImageVector
    get() = when (this) {
        SuggestionKind.walk, SuggestionKind.nature -> PhosphorIcons.tree
        SuggestionKind.class_activity -> PhosphorIcons.personSimpleTaiChi
        SuggestionKind.breathing -> PhosphorIcons.flowerLotus
        SuggestionKind.daylight -> PhosphorIcons.sunHorizon
        else -> PhosphorIcons.mapPin
    }

/**
 * A quiet map style (JSON, for both Maps SDKs): shops, transit and road icons hidden so only the
 * suggested places stand out; parks and water stay, softly tinted, because they are the point.
 */
const val CALM_MAP_STYLE: String = """[
  {"featureType":"poi","stylers":[{"visibility":"off"}]},
  {"featureType":"poi.park","elementType":"geometry","stylers":[{"visibility":"on"},{"color":"#d6e6d3"}]},
  {"featureType":"transit","stylers":[{"visibility":"off"}]},
  {"featureType":"road","elementType":"labels.icon","stylers":[{"visibility":"off"}]},
  {"featureType":"road","elementType":"geometry","stylers":[{"color":"#ffffff"}]},
  {"featureType":"landscape","elementType":"geometry","stylers":[{"color":"#f1f3f0"}]},
  {"featureType":"water","elementType":"geometry","stylers":[{"color":"#cddfe6"}]},
  {"elementType":"labels.text.fill","stylers":[{"color":"#6b777c"}]}
]"""
