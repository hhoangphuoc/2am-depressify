package app.depressify.shared.data.firebase

import kotlinx.serialization.Serializable
import kotlin.io.encoding.Base64

@Serializable
internal data class MusicArtworkResponse(val mimeType: String, val imageBase64: String) {
    fun decode(): ByteArray? {
        if (mimeType !in listOf("image/jpeg", "image/png", "image/webp") || imageBase64.length > 4 * 1024 * 1024) return null
        return runCatching { Base64.decode(imageBase64).takeIf { it.isNotEmpty() } }.getOrNull()
    }
}
