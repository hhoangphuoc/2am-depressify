package app.depressify.shared.ui

import android.content.pm.PackageManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import app.depressify.core.model.PatientLocation
import app.depressify.shared.data.TodayPlace
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.Circle
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberUpdatedMarkerState

private const val MAPS_KEY_META_DATA = "com.google.android.geo.API_KEY"
private const val ZOOM = 13.5f
private val YouBlue = Color(0xFF2F6FD6)

/** The Maps SDK for Android through Maps Compose. Without a key in the manifest it emits nothing. */
@Composable
actual fun PlacesMap(near: PatientLocation?, places: List<TodayPlace>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    // The key is maps.apiKey in secrets.properties. The SDK cannot start without one.
    val hasKey = remember {
        !runCatching { context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData?.getString(MAPS_KEY_META_DATA) }
            .getOrNull().isNullOrBlank()
    }
    val place = places.getOrNull(selected)
    if (!hasKey || place == null) return

    // Halfway between the Patient and the place, so both are in view.
    val centre = LatLng((place.latitude + (near?.latitude ?: place.latitude)) / 2, (place.longitude + (near?.longitude ?: place.longitude)) / 2)
    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(centre, ZOOM) }
    LaunchedEffect(centre) { camera.animate(CameraUpdateFactory.newLatLngZoom(centre, ZOOM)) }
    GoogleMap(
        modifier = modifier,
        cameraPositionState = camera,
        uiSettings = MapUiSettings(zoomControlsEnabled = false, mapToolbarEnabled = false, myLocationButtonEnabled = false),
        contentDescription = "Map of places near you",
    ) {
        near?.let { Circle(center = LatLng(it.latitude, it.longitude), radius = 45.0, fillColor = YouBlue.copy(alpha = 0.35f), strokeColor = YouBlue, strokeWidth = 4f) }
        places.forEachIndexed { i, p ->
            Marker(
                state = rememberUpdatedMarkerState(LatLng(p.latitude, p.longitude)),
                title = p.name,
                snippet = p.address,
                alpha = if (i == selected) 1f else 0.55f,
                onClick = { onSelect(i); false },
            )
        }
    }
}
