package app.depressify.shared.voice

import app.depressify.core.SuggestionKind
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.FlagLevel
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import app.depressify.core.model.Signal
import app.depressify.shared.data.FakeCheckInGateway
import app.depressify.shared.data.FakePatientStore
import app.depressify.shared.voice.live.LiveClient
import app.depressify.shared.voice.live.ServerEvent
import app.depressify.shared.voice.live.ToolCard
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Plays scripted server events and keeps what the session sent. */
private class FakeLiveClient(private val events: List<ServerEvent>, private val thenDrop: Boolean = false) : LiveClient {
    val sent = mutableListOf<String>()
    var token: String? = null
    private val open = CompletableDeferred<Unit>()

    override suspend fun run(token: String, model: String, outgoing: ReceiveChannel<String>, onEvent: suspend (ServerEvent) -> Unit) {
        this.token = token
        events.forEach { onEvent(it) }
        while (true) sent += outgoing.tryReceive().getOrNull() ?: break
        if (!thenDrop) open.await()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class GeminiLiveSessionTest {
    private val scope = TestScope(UnconfinedTestDispatcher())
    private val patients = FakePatientStore().apply { records["p1"] = PatientDoc("Live patient", "c@example.com", sharingConsent = SharingConsent.granted) }
    private val gateway = FakeCheckInGateway()
    private var crisisShown = 0

    private fun session(client: LiveClient, patientId: String? = "p1") =
        GeminiLiveSession(scope, patients, gateway, client, audio = null, { patientId }, ScriptedLiveSession(scope), onCrisis = { crisisShown++ }, nowMillis = { 1000 })

    private fun call(name: String, vararg args: Pair<String, JsonPrimitive>) = ServerEvent.ToolCall("c-$name", name, JsonObject(args.toMap()))

    @Test
    fun withoutASignedInPatientItPlaysTheScript() {
        val client = FakeLiveClient(emptyList())
        val live = session(client, patientId = null)
        live.start(returning = true)

        assertFalse(live.isLive)
        assertEquals(null, client.token)
        live.stop()
    }

    @Test
    fun itConnectsWithTheTokenOpensTheConversationAndJoinsTranscriptPieces() {
        val client = FakeLiveClient(listOf(
            ServerEvent.SetupComplete,
            ServerEvent.OutputText("Hi, "), ServerEvent.OutputText("good to hear you."), ServerEvent.TurnComplete,
            ServerEvent.InputText("I slept badly."),
        ))
        val live = session(client)
        live.start(returning = false)
        val snap = live.snapshot.value

        assertTrue(live.isLive)
        assertEquals("token-1", client.token)
        assertTrue(client.sent.first().contains("The Check-in has started."))
        assertEquals(listOf(TranscriptLine(Speaker.Companion, "Hi, good to hear you."), TranscriptLine(Speaker.You, "I slept badly.")), snap.transcript)
        assertEquals(LiveState.Listening, snap.event.state)
        // No microphone here, so the Check-in continues typed.
        assertTrue(snap.muted)
        live.stop()
    }

    @Test
    fun toolCallsReadThePatientsRecordsShowCardsAndAreAnswered() {
        gateway.days = listOf(
            DailyDoc.of("2026-11-13", mapOf(Signal.SLEEP_MINUTES to 300.0), mapOf(Signal.SLEEP_MINUTES to -1.6, Signal.STEPS to 0.2), null, sharedWithClinician = true),
            DailyDoc.of("2026-11-12", emptyMap(), emptyMap(), null, sharedWithClinician = true),
        )
        val client = FakeLiveClient(listOf(
            call("get_health_summary", "days" to JsonPrimitive(7)),
            call("record_suggestion", "kind" to JsonPrimitive("music"), "details" to JsonPrimitive("One calm song tonight")),
            call("suggest_music", "query" to JsonPrimitive("calm piano")),
            call("find_places", "query" to JsonPrimitive("park near me")),
            call("no_such_tool"),
            call("wrap_up"),
        ))
        val live = session(client)
        live.start(returning = true)
        val snap = live.snapshot.value

        // A missing day stays missing: only the day with a value is described, in words.
        assertEquals(listOf("Sleep: lower than usual", "Steps: about the same as usual"), assertIs<ToolCard.Insight>(snap.cards[0]).lines)
        assertEquals("https://music.youtube.com/search?q=calm%20piano", assertIs<ToolCard.Music>(snap.cards[1]).url)
        assertEquals("https://www.google.com/maps/search/?api=1&query=park%20near%20me", assertIs<ToolCard.Places>(snap.cards[2]).url)
        assertEquals(SuggestionKind.Music to "One calm song tonight", snap.offer to snap.offerDetails)
        assertTrue(snap.wrapped)
        assertTrue(gateway.suggestions.single().sharedWithClinician)
        assertEquals(6, client.sent.count { it.contains("toolResponse") })
        assertTrue(client.sent.any { it.contains("\"c-no_such_tool\"") && it.contains("unknown_tool") })
        live.stop()
    }

    @Test
    fun aCrisisShowsTheNoticeEvenWhenTheFlagCannotBeSaved() {
        gateway.failWrites = true
        val client = FakeLiveClient(listOf(call("raise_crisis", "reason" to JsonPrimitive("said they want to disappear"))))
        val live = session(client)
        live.start(returning = true)

        assertEquals(1, crisisShown)
        assertTrue(client.sent.single().contains("crisis_notice_shown"))

        gateway.failWrites = false
        session(FakeLiveClient(listOf(call("raise_crisis")))).start(returning = true)
        assertEquals(FlagLevel.red, gateway.flags.single().level)
        live.stop()
    }

    @Test
    fun aLostConnectionKeepsTheTranscriptAndAFailedStartShowsAsLost() {
        val live = session(FakeLiveClient(listOf(ServerEvent.OutputText("Hello.")), thenDrop = true))
        live.start(returning = true)
        assertFalse(live.snapshot.value.connected)
        assertEquals(1, live.snapshot.value.transcript.size)

        gateway.failStart = true
        val failed = session(FakeLiveClient(emptyList()))
        failed.start(returning = true)
        assertFalse(failed.snapshot.value.connected)
    }
}
