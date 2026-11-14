package app.depressify.shared.voice.live

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/** What the Gemini Live server sends, reduced to what a Check-in needs. */
sealed interface ServerEvent {
    data object SetupComplete : ServerEvent
    class AudioOut(val pcm24k: ByteArray) : ServerEvent
    data class InputText(val text: String) : ServerEvent
    data class OutputText(val text: String) : ServerEvent
    data class ToolCall(val id: String, val name: String, val args: JsonObject) : ServerEvent
    data object Interrupted : ServerEvent
    data object TurnComplete : ServerEvent
}

/**
 * The Gemini Live WebSocket messages (docs/research/gemini-api.md, "Protocol"): JSON text frames,
 * 16 kHz PCM in and 24 kHz PCM out as base64. Pure, so it is tested without a connection.
 */
@OptIn(ExperimentalEncodingApi::class)
object LiveProtocol {
    /** The endpoint for short-lived tokens; the token goes in the `access_token` query parameter. */
    const val URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained"

    private val json = Json { ignoreUnknownKeys = true }

    /** The first message. The instruction and tools are locked in the token, so only the model is named. */
    fun setup(model: String): String = buildJsonObject { put("setup", buildJsonObject { put("model", "models/$model") }) }.toString()

    fun audio(pcm16k: ByteArray): String = realtime {
        put("audio", buildJsonObject { put("data", Base64.encode(pcm16k)); put("mimeType", "audio/pcm;rate=16000") })
    }

    /** Sent when the microphone is muted, so the server stops waiting for speech. */
    fun audioStreamEnd(): String = realtime { put("audioStreamEnd", true) }

    fun text(text: String): String = realtime { put("text", text) }

    fun toolResponse(id: String, name: String, result: JsonObject): String = buildJsonObject {
        put("toolResponse", buildJsonObject {
            put("functionResponses", buildJsonArray { add(buildJsonObject { put("id", id); put("name", name); put("response", result) }) })
        })
    }.toString()

    /** Every event in one server message, in order. One message can carry audio and a transcript together. */
    fun parse(message: String): List<ServerEvent> {
        val root = runCatching { json.parseToJsonElement(message).jsonObject }.getOrNull() ?: return emptyList()
        val events = mutableListOf<ServerEvent>()
        if ("setupComplete" in root) events += ServerEvent.SetupComplete
        (root["serverContent"] as? JsonObject)?.let { content ->
            ((content["modelTurn"] as? JsonObject)?.get("parts") as? JsonArray)?.forEach { part ->
                ((part as? JsonObject)?.get("inlineData") as? JsonObject)?.string("data")?.let { data ->
                    runCatching { Base64.decode(data) }.getOrNull()?.let { events += ServerEvent.AudioOut(it) }
                }
            }
            (content["inputTranscription"] as? JsonObject)?.string("text")?.takeIf { it.isNotEmpty() }?.let { events += ServerEvent.InputText(it) }
            (content["outputTranscription"] as? JsonObject)?.string("text")?.takeIf { it.isNotEmpty() }?.let { events += ServerEvent.OutputText(it) }
            if ((content["interrupted"] as? JsonPrimitive)?.content == "true") events += ServerEvent.Interrupted
            if ((content["turnComplete"] as? JsonPrimitive)?.content == "true") events += ServerEvent.TurnComplete
        }
        ((root["toolCall"] as? JsonObject)?.get("functionCalls") as? JsonArray)?.forEach { call ->
            val c = call as? JsonObject ?: return@forEach
            val name = c.string("name") ?: return@forEach
            events += ServerEvent.ToolCall(c.string("id") ?: "", name, c["args"] as? JsonObject ?: JsonObject(emptyMap()))
        }
        return events
    }

    private fun realtime(body: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): String =
        buildJsonObject { put("realtimeInput", buildJsonObject(body)) }.toString()

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
