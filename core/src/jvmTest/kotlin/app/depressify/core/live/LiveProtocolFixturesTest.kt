package app.depressify.core.live

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Parses every server message recorded in the #6 spike (`fixtures/spike/live/messages/` and the
 * whole session in `session-ktor-okhttp.json`) and checks the client builders against the recorded
 * client messages. Long base64 audio was cut when the fixtures were saved
 * (`...<N base64 chars truncated>`); the cut is undone to valid base64 before parsing.
 */
class LiveProtocolFixturesTest {

    private val dir: File = File(System.getProperty("spike.live.fixtures") ?: "../fixtures/spike/live")
    private val messages: File = File(dir, "messages")

    private fun read(name: String): JsonObject = Json.parseToJsonElement(File(messages, name).readText()).jsonObject

    /** The recorded message, with truncated base64 restored to a valid (shorter) string. */
    private fun message(fixture: JsonObject): String = repair(fixture["message"]!!).toString()

    private fun repair(element: JsonElement): JsonElement = when (element) {
        is JsonObject -> JsonObject(element.mapValues { (_, v) -> repair(v) })
        is kotlinx.serialization.json.JsonArray -> kotlinx.serialization.json.JsonArray(element.map(::repair))
        is JsonPrimitive -> if (element.isString && element.content.contains("base64 chars truncated")) {
            val head = element.content.substringBefore("...")
            JsonPrimitive(head.take(head.length - head.length % 4))
        } else {
            element
        }
    }

    private fun server(name: String): List<LiveEvent> {
        val fixture = read(name)
        assertEquals("server->client", fixture["direction"]!!.jsonPrimitive.content, name)
        assertEquals("binary", fixture["websocketFrame"]!!.jsonPrimitive.content, name)
        // Server frames are binary UTF-8 JSON: parse the bytes, as the client will.
        return LiveProtocol.parse(message(fixture).encodeToByteArray())
    }

    @Test
    fun everyRecordedServerMessageIsExpected() {
        val expected: Map<String, (List<LiveEvent>) -> Boolean> = mapOf(
            "server-setupComplete.json" to { it == listOf(LiveEvent.SetupComplete) },
            "server-sessionResumptionUpdate.json" to { it.isEmpty() },
            "server-empty-object.json" to { it.isEmpty() },
            "server-serverContent-empty.json" to { it.isEmpty() },
            "server-modelTurn-audio.json" to { it.size == 1 && (it[0] as LiveEvent.AudioOut).sampleRate == 24_000 && (it[0] as LiveEvent.AudioOut).pcm.isNotEmpty() },
            "server-modelTurn-audio-with-outputTranscription.json" to {
                it == listOf(LiveEvent.AudioOut(byteArrayOf(0, 0), 24_000), LiveEvent.OutputText("Hello! I'm doing "))
            },
            "server-inputTranscription.json" to {
                it == listOf(LiveEvent.InputText("Hi there. I slept badly last night, but I went for a short walk this morning and that helped a little."))
            },
            "server-interrupted.json" to { it == listOf(LiveEvent.Interrupted) },
            "server-generationComplete.json" to { it == listOf(LiveEvent.GenerationComplete) },
            "server-turnComplete-usageMetadata.json" to { it == listOf(LiveEvent.TurnComplete, LiveEvent.Usage(640, 106, 746)) },
            "server-toolCall.json" to { it == listOf(LiveEvent.ToolCall("fc_18429171870273940054", "get_time", JsonObject(emptyMap()))) },
            "server-voiceActivity-start.json" to { it == listOf(LiveEvent.VoiceActivity(true)) },
            "server-voiceActivity-end.json" to { it == listOf(LiveEvent.VoiceActivity(false)) },
        )
        val recorded = messages.listFiles { f -> f.name.startsWith("server-") }!!.map { it.name }.sorted()
        assertTrue(recorded.isNotEmpty(), "no fixtures found in $messages")
        assertEquals(expected.keys.sorted(), recorded, "every recorded server message has an expectation")
        for ((name, check) in expected) {
            val events = server(name)
            if (!check(events)) fail("$name parsed to $events")
        }
    }

    @Test
    fun theWholeRecordedSessionParsesInOrder() {
        val session = Json.parseToJsonElement(File(dir, "session-ktor-okhttp.json").readText()).jsonObject
        val events = session["frames"]!!.jsonArray
            .map { it.jsonObject }
            .filter { it["dir"]!!.jsonPrimitive.content == "in" }
            .flatMap { frame -> LiveProtocol.parse(repair(frame["msg"]!!).toString().encodeToByteArray()) }

        assertEquals(LiveEvent.SetupComplete, events.first())
        assertEquals(1, events.count { it is LiveEvent.ToolCall })
        assertEquals(1, events.count { it == LiveEvent.Interrupted })
        assertEquals(5, events.count { it == LiveEvent.TurnComplete })
        assertEquals(5, events.count { it == LiveEvent.GenerationComplete })
        assertEquals(5, events.count { it is LiveEvent.Usage })
        assertEquals(2, events.count { it is LiveEvent.InputText })
        assertEquals(83, events.count { it is LiveEvent.AudioOut })
        assertEquals(22, events.count { it is LiveEvent.OutputText })
        // The interruption is the order the spike found: voice activity starts, then interrupted, then the cut turn completes.
        val interrupted = events.indexOf(LiveEvent.Interrupted)
        assertEquals(LiveEvent.VoiceActivity(true), events.subList(0, interrupted).last { it is LiveEvent.VoiceActivity })
        assertTrue(events.subList(interrupted, events.size).contains(LiveEvent.TurnComplete))
        // The first reply's words, rebuilt from the output transcript pieces.
        val firstReply = events.takeWhile { it != LiveEvent.TurnComplete }.filterIsInstance<LiveEvent.OutputText>().joinToString("") { it.text }
        assertTrue(firstReply.startsWith("Hello! I'm doing"), firstReply)
    }

    @Test
    fun clientBuildersMatchTheRecordedClientMessages() {
        fun recorded(name: String): JsonElement = read(name)["message"]!!
        fun built(text: String): JsonElement = Json.parseToJsonElement(text)

        assertEquals(recorded("client-setup.json"), built(LiveProtocol.setupMessage("models/gemini-3.8-live")))
        assertEquals(recorded("client-realtimeInput-text.json"), built(LiveProtocol.textMessage("Hello! This is a short test. How are you?")))
        assertEquals(recorded("client-realtimeInput-audioStreamEnd.json"), built(LiveProtocol.audioStreamEndMessage()))
        assertEquals(
            recorded("client-toolResponse.json"),
            built(LiveProtocol.toolResponseMessage("fc_18429171870273940054", "get_time", buildJsonObject { put("time", "14:05") })),
        )
        // Audio: same shape and format as the recorded chunk (its data was cut when saved).
        val audio = recorded("client-realtimeInput-audio.json").jsonObject["realtimeInput"]!!.jsonObject["audio"]!!.jsonObject
        val ours = built(LiveProtocol.audioMessage(ByteArray(1_280))).jsonObject["realtimeInput"]!!.jsonObject["audio"]!!.jsonObject
        assertEquals(audio.keys, ours.keys)
        assertEquals(audio["mimeType"], ours["mimeType"])
    }
}
