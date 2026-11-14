package app.depressify.core.live

import kotlin.io.encoding.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * One thing the Gemini Live server told the phone. A server message can carry several of these
 * (audio plus its output transcript, or `turnComplete` plus usage), and many carry none (`{}`).
 * No SDK or transport types appear here: the WebSocket client in `shared` turns frames into these.
 */
sealed interface LiveEvent {
    /** `setupComplete`: the session is ready for input. */
    data object SetupComplete : LiveEvent

    /** Model audio: 16-bit PCM, mono, at [sampleRate] (24 kHz from `gemini-3.8-live`). */
    class AudioOut(val pcm: ByteArray, val sampleRate: Int) : LiveEvent {
        override fun equals(other: Any?): Boolean =
            other is AudioOut && other.sampleRate == sampleRate && other.pcm.contentEquals(pcm)

        override fun hashCode(): Int = 31 * pcm.contentHashCode() + sampleRate
        override fun toString(): String = "AudioOut(${pcm.size} bytes, $sampleRate Hz)"
    }

    /** A text part of the model's turn (not a thought). With AUDIO output the words come as [OutputText]. */
    data class ModelText(val text: String) : LiveEvent

    /** What the Patient said, as the server transcribed it. Arrives whole, at the end of the utterance. */
    data class InputText(val text: String) : LiveEvent

    /** A piece of what the Companion is saying. Pieces arrive alongside the audio; append them. */
    data class OutputText(val text: String) : LiveEvent

    /** The Patient talked over the Companion: stop playback at once. */
    data object Interrupted : LiveEvent

    /** The model has produced its whole reply (playback may still be going). */
    data object GenerationComplete : LiveEvent

    /** The turn is over, about when real-time playback of the reply would end. */
    data object TurnComplete : LiveEvent

    /** The model calls a tool; answer with [LiveProtocol.toolResponseMessage] using the same [id]. */
    data class ToolCall(val id: String, val name: String, val args: JsonObject) : LiveEvent

    /** The server withdrew tool calls it no longer needs answered. */
    data class ToolCallCancellation(val ids: List<String>) : LiveEvent

    /** The server's voice activity detection: the Patient started ([started] true) or stopped speaking. */
    data class VoiceActivity(val started: Boolean) : LiveEvent

    /** Token counts for the turn. Null where the server left a count out. */
    data class Usage(val promptTokens: Int?, val responseTokens: Int?, val totalTokens: Int?) : LiveEvent

    /** The server will close the connection soon; [timeLeft] as the server wrote it (for example "10s"). */
    data class GoAway(val timeLeft: String?) : LiveEvent
}

/**
 * Pure Gemini Live protocol: client messages to send, and server messages parsed into [LiveEvent]s.
 * Written against the messages captured in the #6 spike (`fixtures/spike/live/messages/`).
 *
 * - Every server frame is a binary WebSocket frame holding UTF-8 JSON: pass its bytes to
 *   [parse]. Client frames may be text.
 * - [parse] never throws. Malformed JSON, an unknown message and an empty `{}` yield no events.
 * - `sessionResumptionUpdate` is sent even though resumption is never asked for; the spec does not
 *   resume, so it yields no events.
 */
object LiveProtocol {
    private val json = Json { ignoreUnknownKeys = true }

    /** Parses one server frame's bytes (UTF-8 JSON). */
    fun parse(frame: ByteArray): List<LiveEvent> = parse(frame.decodeToString())

    /** Parses one server message's text. */
    fun parse(message: String): List<LiveEvent> {
        val element = try {
            json.parseToJsonElement(message)
        } catch (_: Exception) {
            return emptyList()
        }
        return (element as? JsonObject)?.let(::parse) ?: emptyList()
    }

    /** Parses one server message. The order of events follows what the phone must do first. */
    fun parse(message: JsonObject): List<LiveEvent> {
        val events = mutableListOf<LiveEvent>()
        if (message["setupComplete"] is JsonObject) events += LiveEvent.SetupComplete

        (message["serverContent"] as? JsonObject)?.let { content ->
            if (content.flag("interrupted")) events += LiveEvent.Interrupted
            content.obj("inputTranscription")?.text()?.let { events += LiveEvent.InputText(it) }
            content.obj("modelTurn")?.array("parts")?.forEach { part -> modelPart(part)?.let { events += it } }
            content.obj("outputTranscription")?.text()?.let { events += LiveEvent.OutputText(it) }
            if (content.flag("generationComplete")) events += LiveEvent.GenerationComplete
            if (content.flag("turnComplete")) events += LiveEvent.TurnComplete
        }

        message.obj("toolCall")?.array("functionCalls")?.forEach { call ->
            val c = call as? JsonObject ?: return@forEach
            val id = c.string("id") ?: return@forEach
            val name = c.string("name") ?: return@forEach
            events += LiveEvent.ToolCall(id, name, c.obj("args") ?: JsonObject(emptyMap()))
        }
        message.obj("toolCallCancellation")?.array("ids")?.let { ids ->
            val list = ids.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            if (list.isNotEmpty()) events += LiveEvent.ToolCallCancellation(list)
        }
        message.obj("voiceActivity")?.string("type")?.let { type ->
            when (type) {
                "ACTIVITY_START" -> events += LiveEvent.VoiceActivity(started = true)
                "ACTIVITY_END" -> events += LiveEvent.VoiceActivity(started = false)
            }
        }
        message.obj("usageMetadata")?.let { usage ->
            events += LiveEvent.Usage(usage.int("promptTokenCount"), usage.int("responseTokenCount"), usage.int("totalTokenCount"))
        }
        message.obj("goAway")?.let { events += LiveEvent.GoAway(it.string("timeLeft")) }
        return events
    }

    private fun modelPart(part: JsonElement): LiveEvent? {
        val p = part as? JsonObject ?: return null
        p.obj("inlineData")?.let { data ->
            val mime = data.string("mimeType") ?: return null
            if (!mime.startsWith("audio/pcm")) return null
            val pcm = data.string("data")?.let { decodeBase64(it) } ?: return null
            return LiveEvent.AudioOut(pcm, sampleRate(mime) ?: OUTPUT_SAMPLE_RATE)
        }
        if (p["thought"].let { it is JsonPrimitive && it.booleanOrNull == true }) return null
        return p.string("text")?.takeIf { it.isNotEmpty() }?.let { LiveEvent.ModelText(it) }
    }

    private fun decodeBase64(data: String): ByteArray? = try {
        Base64.decode(data)
    } catch (_: IllegalArgumentException) {
        null
    }

    private fun sampleRate(mime: String): Int? =
        Regex("""rate=(\d+)""").find(mime)?.groupValues?.get(1)?.toIntOrNull()

    // -----------------------------------------------------------------------------------------
    // Client messages
    // -----------------------------------------------------------------------------------------

    /** The microphone format the server expects. */
    const val INPUT_SAMPLE_RATE = 16_000

    /** The audio format `gemini-3.8-live` sends. */
    const val OUTPUT_SAMPLE_RATE = 24_000

    /**
     * The first message. The token already locks the model, Brief and tools, so the setup only names
     * the model (or nothing): anything else in it would be ignored.
     */
    fun setupMessage(model: String? = null): String = encode(buildJsonObject {
        put("setup", buildJsonObject { if (model != null) put("model", model) })
    })

    /** A typed turn, as the spike sent it: `realtimeInput.text`. The server answers it at once. */
    fun textMessage(text: String): String = encode(buildJsonObject {
        put("realtimeInput", buildJsonObject { put("text", text) })
    })

    /**
     * A typed turn as ordered conversation content: `clientContent` with one user turn. Not used in
     * the spike; [textMessage] is the verified path.
     */
    fun clientContentMessage(text: String, turnComplete: Boolean = true): String = encode(buildJsonObject {
        put("clientContent", buildJsonObject {
            put("turns", buildJsonArray {
                add(buildJsonObject {
                    put("role", "user")
                    put("parts", buildJsonArray { add(buildJsonObject { put("text", text) }) })
                })
            })
            put("turnComplete", turnComplete)
        })
    })

    /** One microphone chunk: 16 kHz mono 16-bit PCM, base64 (the spike used 40 ms, 1,280 bytes). */
    fun audioMessage(pcm16k: ByteArray): String = encode(buildJsonObject {
        put("realtimeInput", buildJsonObject {
            put("audio", buildJsonObject {
                put("data", Base64.encode(pcm16k))
                put("mimeType", "audio/pcm;rate=$INPUT_SAMPLE_RATE")
            })
        })
    })

    /** Sent when the Patient mutes, so the server ends the turn without waiting for more audio. */
    fun audioStreamEndMessage(): String = encode(buildJsonObject {
        put("realtimeInput", buildJsonObject { put("audioStreamEnd", true) })
    })

    /** The answer to a [LiveEvent.ToolCall], carrying its id and name. */
    fun toolResponseMessage(id: String, name: String, response: JsonObject): String = encode(buildJsonObject {
        put("toolResponse", buildJsonObject {
            put("functionResponses", buildJsonArray {
                add(buildJsonObject {
                    put("id", id)
                    put("name", name)
                    put("response", response)
                })
            })
        })
    })

    private fun encode(obj: JsonObject): String = json.encodeToString(JsonObject.serializer(), obj)

    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
    private fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray
    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
    private fun JsonObject.flag(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull == true
    private fun JsonObject.text(): String? = string("text")?.takeIf { it.isNotEmpty() }
}
