package app.depressify.shared.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.depressify.core.model.PatientLocation
import app.depressify.shared.data.TodayPlace

/**
 * A Google map of [places] around [near], with the [selected] place in view; tapping a pin calls
 * [onSelect]. Emits nothing where no Google map can be shown (see each platform), so the list of
 * places beside it must stand on its own.
 */
@Composable
expect fun PlacesMap(near: PatientLocation?, places: List<TodayPlace>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier)
