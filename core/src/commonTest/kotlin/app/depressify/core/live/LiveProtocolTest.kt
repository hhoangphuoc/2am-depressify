package app.depressify.core.live

import kotlin.io.encoding.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

class LiveProtocolTest {

    private fun json(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    @Test
    fun parsesAudioAndTranscriptInOneMessage() {
        val events = LiveProtocol.parse(
            """{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AAA="}}],"role":"model"},"outputTranscription":{"text":"Hello! I'm doing "}}}""",
        )
        assertEquals(listOf(LiveEvent.AudioOut(byteArrayOf(0, 0), 24_000), LiveEvent.OutputText("Hello! I'm doing ")), events)
    }

    @Test
    fun parsesSeveralPartsInOrder() {
        val events = LiveProtocol.parse(
            """{"serverContent":{"modelTurn":{"parts":[{"text":"thinking","thought":true},{"text":"Hi"},{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQID"}}]},"generationComplete":true,"turnComplete":true},"usageMetadata":{"promptTokenCount":3,"totalTokenCount":5}}""",
        )
        assertEquals(
            listOf(
                LiveEvent.ModelText("Hi"),
                LiveEvent.AudioOut(byteArrayOf(1, 2, 3), 24_000),
                LiveEvent.GenerationComplete,
                LiveEvent.TurnComplete,
                LiveEvent.Usage(promptTokens = 3, responseTokens = null, totalTokens = 5),
            ),
            events,
        )
    }

    @Test
    fun parsesToolCall() {
        val events = LiveProtocol.parse(
            """{"toolCall":{"functionCalls":[{"name":"get_time","args":{"zone":"Helsinki"},"id":"fc_1"},{"name":"no_id"}]}}""",
        )
        assertEquals(listOf(LiveEvent.ToolCall("fc_1", "get_time", buildJsonObject { put("zone", "Helsinki") })), events)
    }

    @Test
    fun parsesToolCallWithoutArgsAsEmptyObject() {
        val events = LiveProtocol.parse("""{"toolCall":{"functionCalls":[{"name":"get_time","id":"fc_2"}]}}""")
        assertEquals(listOf(LiveEvent.ToolCall("fc_2", "get_time", JsonObject(emptyMap()))), events)
    }

    @Test
    fun parsesInterruptionFirst() {
        val events = LiveProtocol.parse("""{"serverContent":{"outputTranscription":{"text":"and then"},"interrupted":true}}""")
        assertEquals(LiveEvent.Interrupted, events.first())
    }

    @Test
    fun parsesInputTranscriptVoiceActivityGoAwayAndCancellation() {
        assertEquals(listOf(LiveEvent.InputText("I slept badly.")), LiveProtocol.parse("""{"serverContent":{"inputTranscription":{"text":"I slept badly."}}}"""))
        assertEquals(listOf(LiveEvent.VoiceActivity(true)), LiveProtocol.parse("""{"voiceActivity":{"type":"ACTIVITY_START","audioOffset":"0.200s"}}"""))
        assertEquals(listOf(LiveEvent.VoiceActivity(false)), LiveProtocol.parse("""{"voiceActivity":{"type":"ACTIVITY_END"}}"""))
        assertEquals(listOf(LiveEvent.GoAway("10s")), LiveProtocol.parse("""{"goAway":{"timeLeft":"10s"}}"""))
        assertEquals(listOf(LiveEvent.ToolCallCancellation(listOf("fc_1"))), LiveProtocol.parse("""{"toolCallCancellation":{"ids":["fc_1"]}}"""))
    }

    @Test
    fun unknownEmptyAndMalformedMessagesGiveNoEvents() {
        for (message in listOf("{}", """{"serverContent":{}}""", """{"somethingNew":{"x":1}}""", "not json", "[1,2]", "", """{"sessionResumptionUpdate":{"newHandle":"h","resumable":true}}""")) {
            assertEquals(emptyList(), LiveProtocol.parse(message), message)
        }
    }

    @Test
    fun badAudioIsSkippedNotThrown() {
        val events = LiveProtocol.parse("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"%%%"}}]},"turnComplete":true}}""")
        assertEquals(listOf(LiveEvent.TurnComplete), events)
    }

    @Test
    fun parsesBinaryFrameBytes() {
        assertEquals(listOf(LiveEvent.SetupComplete), LiveProtocol.parse("""{"setupComplete":{}}""".encodeToByteArray()))
    }

    @Test
    fun audioMessageIsBase64Pcm16k() {
        val pcm = byteArrayOf(1, 0, -1, 127)
        val message = json(LiveProtocol.audioMessage(pcm))
        val audio = message["realtimeInput"]!!.jsonObject["audio"]!!.jsonObject
        assertEquals("audio/pcm;rate=16000", (audio["mimeType"] as JsonPrimitive).content)
        assertTrue(Base64.decode((audio["data"] as JsonPrimitive).content).contentEquals(pcm))
    }

    @Test
    fun textMessagesMatchTheSpikeAndClientContentShapes() {
        assertEquals(json("""{"realtimeInput":{"text":"Hello"}}"""), json(LiveProtocol.textMessage("Hello")))
        assertEquals(
            json("""{"clientContent":{"turns":[{"role":"user","parts":[{"text":"Hello"}]}],"turnComplete":true}}"""),
            json(LiveProtocol.clientContentMessage("Hello")),
        )
        assertEquals(json("""{"realtimeInput":{"audioStreamEnd":true}}"""), json(LiveProtocol.audioStreamEndMessage()))
        assertEquals(json("""{"setup":{"model":"models/gemini-3.8-live"}}"""), json(LiveProtocol.setupMessage("models/gemini-3.8-live")))
        assertEquals(json("""{"setup":{}}"""), json(LiveProtocol.setupMessage()))
    }

    @Test
    fun toolResponseCarriesCallId() {
        val message = LiveProtocol.toolResponseMessage("fc_9", "get_time", buildJsonObject { put("time", "14:05") })
        assertEquals(
            json("""{"toolResponse":{"functionResponses":[{"id":"fc_9","name":"get_time","response":{"time":"14:05"}}]}}"""),
            json(message),
        )
    }
}
