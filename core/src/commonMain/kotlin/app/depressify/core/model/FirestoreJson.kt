package app.depressify.core.model

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * The one encoding of the data contract into Firestore field maps: defaults and nulls are always
 * written, and enumerations become their lower-case entry names.
 */
object FirestoreJson {
    val json: Json = Json {
        encodeDefaults = true
        explicitNulls = true
        ignoreUnknownKeys = true
    }

    /** Encodes [value] into a Firestore field map. Whole numbers become Long, others Double. */
    fun <T> encode(serializer: SerializationStrategy<T>, value: T): Map<String, Any?> {
        val element = json.encodeToJsonElement(serializer, value)
        require(element is JsonObject) { "A Firestore document must encode to an object" }
        return toMap(element)
    }

    /** Decodes a Firestore field map produced by [encode] (or by the TypeScript mirror). */
    fun <T> decode(deserializer: DeserializationStrategy<T>, fields: Map<String, Any?>): T =
        json.decodeFromJsonElement(deserializer, toJson(fields))

    private fun toMap(obj: JsonObject): Map<String, Any?> = obj.mapValues { (_, v) -> toValue(v) }

    private fun toValue(element: JsonElement): Any? = when (element) {
        JsonNull -> null
        is JsonObject -> toMap(element)
        is JsonArray -> element.map { toValue(it) }
        is JsonPrimitive -> when {
            element.isString -> element.content
            element.booleanOrNull != null -> element.booleanOrNull
            isWholeNumber(element.content) -> element.longOrNull
            else -> element.doubleOrNull
        }
    }

    private fun isWholeNumber(content: String): Boolean =
        content.all { it.isDigit() || it == '-' } && content.any { it.isDigit() }

    private fun toJson(value: Any?): JsonElement = when (value) {
        null -> JsonNull
        is String -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to toJson(v) })
        is List<*> -> JsonArray(value.map { toJson(it) })
        else -> throw IllegalArgumentException("Unsupported Firestore value type: ${value::class.simpleName}")
    }
}
