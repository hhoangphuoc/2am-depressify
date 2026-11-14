package app.depressify.shared.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.depressify.core.model.PatientLocation
import app.depressify.shared.data.TodayPlace

// shortcut: no map on iOS, only the list with its Google Maps links. Google Maps place content may
// not be drawn on another provider's map (MapKit), so this needs the Maps SDK for iOS linked into
// the Kotlin framework; add it when the iOS app is demoed.
@Composable
actual fun PlacesMap(near: PatientLocation?, places: List<TodayPlace>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier) {
}
