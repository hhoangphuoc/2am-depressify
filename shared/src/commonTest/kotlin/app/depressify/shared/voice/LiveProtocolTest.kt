package app.depressify.shared.voice

import app.depressify.shared.voice.live.LiveProtocol
import app.depressify.shared.voice.live.ServerEvent
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class LiveProtocolTest {
    @Test
    fun oneMessageCanCarryAudioAndBothTranscripts() {
        val events = LiveProtocol.parse(
            """{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQID"}}]},
               "outputTranscription":{"text":"Hi there"},"inputTranscription":{"text":"hello"},"turnComplete":true}}""",
        )
        assertContentEquals(byteArrayOf(1, 2, 3), assertIs<ServerEvent.AudioOut>(events[0]).pcm24k)
        assertEquals(listOf(ServerEvent.InputText("hello"), ServerEvent.OutputText("Hi there"), ServerEvent.TurnComplete), events.drop(1))
    }

    @Test
    fun parsesSetupToolCallsAndInterruption() {
        assertEquals(listOf<ServerEvent>(ServerEvent.SetupComplete), LiveProtocol.parse("""{"setupComplete":{}}"""))
        assertEquals(listOf<ServerEvent>(ServerEvent.Interrupted), LiveProtocol.parse("""{"serverContent":{"interrupted":true}}"""))
        val call = assertIs<ServerEvent.ToolCall>(
            LiveProtocol.parse("""{"toolCall":{"functionCalls":[{"id":"c1","name":"get_health_summary","args":{"days":7}}]}}""").single(),
        )
        assertEquals("c1" to "get_health_summary", call.id to call.name)
        assertEquals("7", call.args["days"].toString())
    }

    @Test
    fun unknownOrBrokenMessagesGiveNoEvents() {
        assertTrue(LiveProtocol.parse("""{"usageMetadata":{"totalTokenCount":3}}""").isEmpty())
        assertTrue(LiveProtocol.parse("not json").isEmpty())
    }

    @Test
    fun buildsTheClientMessages() {
        assertEquals("""{"setup":{"model":"models/gemini-3.8-live"}}""", LiveProtocol.setup("gemini-3.8-live"))
        assertEquals("""{"realtimeInput":{"audio":{"data":"AQID","mimeType":"audio/pcm;rate=16000"}}}""", LiveProtocol.audio(byteArrayOf(1, 2, 3)))
        assertEquals("""{"realtimeInput":{"text":"hello"}}""", LiveProtocol.text("hello"))
        assertEquals(
            """{"toolResponse":{"functionResponses":[{"id":"c1","name":"wrap_up","response":{"ok":true}}]}}""",
            LiveProtocol.toolResponse("c1", "wrap_up", buildJsonObject { put("ok", true) }),
        )
    }
}
