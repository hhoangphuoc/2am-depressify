package app.depressify.shared.data

import app.depressify.core.model.PatientLocation
import kotlin.test.Test
import kotlin.test.assertEquals

class TodayPlaceTest {
    private fun place(latitude: Double, longitude: Double) = TodayPlace("p", "A park", latitude = latitude, longitude = longitude, mapsUrl = "https://maps.google.com/?cid=1")

    @Test
    fun distanceFromThePatientsAreaIsAStraightLineInMetres() {
        val home = PatientLocation("Vallila, Helsinki", 60.0, 25.0)
        // A hundredth of a degree of latitude is about 1.11 km anywhere on Earth.
        assertEquals(1112, place(60.01, 25.0).metersFrom(home))
        // A degree of longitude at 60° north is half of one at the equator: 0.01° is about 556 m.
        assertEquals(556, place(60.0, 25.01).metersFrom(home))
        assertEquals(0, place(60.0, 25.0).metersFrom(home))
    }
}
