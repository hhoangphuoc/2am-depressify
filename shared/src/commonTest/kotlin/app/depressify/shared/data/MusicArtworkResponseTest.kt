package app.depressify.shared.data

import app.depressify.shared.data.firebase.MusicArtworkResponse
import kotlinx.serialization.json.Json
import kotlin.test.*

class MusicArtworkResponseTest {
    @Test
    fun decodesGeneratedArtAndRejectsUnsupportedOrBrokenData() {
        val art = Json.decodeFromString<MusicArtworkResponse>("""{"mimeType":"image/jpeg","imageBase64":"AQID"}""")
        assertContentEquals(byteArrayOf(1, 2, 3), art.decode())
        assertNull(art.copy(mimeType = "image/svg+xml").decode())
        assertNull(art.copy(imageBase64 = "%").decode())
        assertNull(art.copy(imageBase64 = "").decode())
        assertNull(art.copy(imageBase64 = "A".repeat(4 * 1024 * 1024 + 4)).decode())
    }
}
