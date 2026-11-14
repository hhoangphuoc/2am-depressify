package app.depressify.shared.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitView
import app.depressify.core.model.PatientLocation
import app.depressify.core.model.SuggestionKind
import app.depressify.shared.data.TodayPlace
import platform.UIKit.UIView

/** One point on the map, as the Swift map reads it. */
class MapPlace(val name: String, val latitude: Double, val longitude: Double)

/** Called when a pin is tapped, with the place's index. */
fun interface PlaceSelection {
    fun select(index: Int)
}

/** A Google map drawn by the Maps SDK for iOS, implemented in Swift (GooglePlacesMap.swift). */
interface NativePlacesMap {
    val view: UIView
    fun show(places: List<MapPlace>, near: MapPlace?, selected: Int, symbol: String, onSelect: PlaceSelection)
}

/**
 * The Maps SDK for iOS is a Swift package that Kotlin cannot link, so the app registers a factory
 * here at launch, and only when it has a Maps key (MapsApiKey in Secrets.plist).
 */
object NativeMaps {
    var factory: (() -> NativePlacesMap)? = null
}

@Composable
actual fun mapsAvailable(): Boolean = NativeMaps.factory != null

@Composable
actual fun PlacesMap(near: PatientLocation?, places: List<TodayPlace>, selected: Int, onSelect: (Int) -> Unit, kind: SuggestionKind, modifier: Modifier) {
    val factory = NativeMaps.factory ?: return
    val map = remember { factory() }
    val select by rememberUpdatedState(onSelect)
    val pins = remember(places) { places.map { MapPlace(it.name, it.latitude, it.longitude) } }
    val you = remember(near) { near?.let { MapPlace("Your area", it.latitude, it.longitude) } }
    UIKitView(
        factory = { map.view },
        modifier = modifier,
        update = { map.show(pins, you, selected, kind.symbol, PlaceSelection { select(it) }) },
    )
}

/** The SF Symbol on a pin, matching [placeIcon] on Android. */
private val SuggestionKind.symbol: String
    get() = when (this) {
        SuggestionKind.walk, SuggestionKind.nature -> "tree.fill"
        SuggestionKind.class_activity -> "figure.mind.and.body"
        SuggestionKind.breathing -> "wind"
        SuggestionKind.daylight -> "sun.horizon.fill"
        else -> "mappin"
    }

