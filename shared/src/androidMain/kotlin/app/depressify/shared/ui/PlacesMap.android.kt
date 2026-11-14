package app.depressify.shared.ui

import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.depressify.core.model.PatientLocation
import app.depressify.core.model.SuggestionKind
import app.depressify.shared.data.TodayPlace
import app.depressify.shared.ui.theme.Theme
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.MapStyleOptions
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberUpdatedMarkerState

private const val MAPS_KEY_META_DATA = "com.google.android.geo.API_KEY"
private val YouBlue = Color(0xFF2F6FD6)

/** The Maps SDK for Android cannot start without maps.apiKey from secrets.properties in the manifest. */
@Composable
actual fun mapsAvailable(): Boolean {
    val context = LocalContext.current
    return remember {
        !runCatching { context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData?.getString(MAPS_KEY_META_DATA) }
            .getOrNull().isNullOrBlank()
    }
}

/** The Maps SDK for Android through Maps Compose. A preview inside a scrolling card: only the pins respond to touch. */
@Composable
actual fun PlacesMap(near: PatientLocation?, places: List<TodayPlace>, selected: Int, onSelect: (Int) -> Unit, kind: SuggestionKind, modifier: Modifier) {
    val camera = rememberCameraPositionState()
    val padding = with(LocalDensity.current) { 56.dp.roundToPx() }
    var loaded by remember { mutableStateOf(false) }
    // Fit the Patient's area and every place once; choosing a pin leaves the map still.
    LaunchedEffect(loaded, places, near) {
        if (!loaded) return@LaunchedEffect
        val points = places.map { LatLng(it.latitude, it.longitude) } + listOfNotNull(near?.let { LatLng(it.latitude, it.longitude) })
        if (points.isEmpty()) return@LaunchedEffect
        camera.move(
            if (points.size == 1) CameraUpdateFactory.newLatLngZoom(points.single(), 15f)
            else CameraUpdateFactory.newLatLngBounds(LatLngBounds.builder().apply { points.forEach(::include) }.build(), padding),
        )
    }
    GoogleMap(
        modifier = modifier,
        cameraPositionState = camera,
        properties = remember { MapProperties(mapStyleOptions = MapStyleOptions(CALM_MAP_STYLE)) },
        uiSettings = MapUiSettings(
            compassEnabled = false, indoorLevelPickerEnabled = false, mapToolbarEnabled = false, myLocationButtonEnabled = false,
            rotationGesturesEnabled = false, scrollGesturesEnabled = false, scrollGesturesEnabledDuringRotateOrZoom = false,
            tiltGesturesEnabled = false, zoomControlsEnabled = false, zoomGesturesEnabled = false,
        ),
        onMapLoaded = { loaded = true },
        contentDescription = "Map of places near you",
    ) {
        near?.let {
            MarkerComposable(state = rememberUpdatedMarkerState(LatLng(it.latitude, it.longitude)), title = "Your area", anchor = Offset(0.5f, 0.5f), zIndex = 0f) {
                Box(Modifier.size(18.dp).background(YouBlue, CircleShape).border(3.dp, Color.White, CircleShape))
            }
        }
        places.forEachIndexed { i, place ->
            val on = i == selected
            MarkerComposable(
                on,
                state = rememberUpdatedMarkerState(LatLng(place.latitude, place.longitude)),
                title = place.name,
                zIndex = if (on) 2f else 1f,
                onClick = { onSelect(i); true },
            ) { Pin(kind, on) }
        }
    }
}

/** A round tile with the place's icon; the chosen one is larger and filled with ink. */
@Composable
private fun Pin(kind: SuggestionKind, on: Boolean) {
    val c = Theme.colors
    Box(
        Modifier.size(if (on) 44.dp else 34.dp).background(if (on) c.ink else Color.White, CircleShape).border(2.dp, if (on) Color.White else c.border, CircleShape),
        contentAlignment = Alignment.Center,
    ) { Icon(kind.placeIcon, if (on) 22.dp else 18.dp, if (on) c.onInk else c.accent) }
}

