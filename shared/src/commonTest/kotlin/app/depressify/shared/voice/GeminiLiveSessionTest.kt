package app.depressify.shared.voice

import app.depressify.core.SuggestionKind
import app.depressify.core.live.LiveEvent as ServerEvent
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.FlagLevel
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.PatientLocation as StoredPatientLocation
import app.depressify.core.model.SharingConsent
import app.depressify.core.model.Signal
import app.depressify.core.model.SuggestionStatus
import app.depressify.shared.data.FakeCheckInGateway
import app.depressify.shared.data.FakePatientStore
import app.depressify.shared.data.MusicClip
import app.depressify.shared.data.NearbyPlace
import app.depressify.shared.data.PatientLocation
import app.depressify.shared.data.Weather
import app.depressify.shared.voice.live.LiveClient
import app.depressify.shared.voice.live.AudioIO
import app.depressify.shared.voice.live.ToolCard
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Plays scripted server events and keeps what the session sent. */
private class FakeLiveClient(private val events: List<ServerEvent>, private val thenDrop: Boolean = false) : LiveClient {
    var eventSink: (suspend (ServerEvent) -> Unit)? = null
    val sent = mutableListOf<String>()
    var token: String? = null
    private val open = CompletableDeferred<Unit>()

    override suspend fun run(endpoint: String, token: String, model: String, outgoing: ReceiveChannel<String>, onEvent: suspend (ServerEvent) -> Unit) {
        this.token = token
        eventSink = onEvent
        events.forEach { onEvent(it) }
        while (true) sent += outgoing.tryReceive().getOrNull() ?: break
        if (!thenDrop) open.await()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class GeminiLiveSessionTest {
    private val scope = TestScope(UnconfinedTestDispatcher())
    private val patients = FakePatientStore().apply { records["p1"] = PatientDoc("Live patient", "c@example.com", intakeHighlights = "- Likes the sea", sharingConsent = SharingConsent.granted) }
    private val gateway = FakeCheckInGateway()
    private var crisisShown = 0

    private fun session(client: LiveClient, patientId: String? = "p1") =
        GeminiLiveSession(scope, patients, gateway, client, audio = null, { patientId }, ScriptedLiveSession(scope), onCrisis = { crisisShown++ }, nowMillis = { 1000 })

    private fun call(name: String, vararg args: Pair<String, JsonPrimitive>) = ServerEvent.ToolCall("c-$name", name, JsonObject(args.toMap()))

    @Test
    fun generatedMusicSuppressesNewCompanionAudioUntilItIsPausedOrFinished() = runTest {
        val client = FakeLiveClient(emptyList())
        var played = 0
        val audio = object : AudioIO {
            override fun start(onFrame: (ByteArray) -> Unit) = true
            override fun play(pcm24k: ByteArray) { played++ }
            override fun stopPlayback() = Unit
            override fun stop() = Unit
        }
        val live = GeminiLiveSession(scope, patients, gateway, client, audio, { "p1" }, ScriptedLiveSession(scope), {}, { 1000 })
        live.start(returning = true)
        live.setCompanionAudioPaused(true)
        client.eventSink!!.invoke(ServerEvent.AudioOut(byteArrayOf(1, 2), 24000))
        assertEquals(0, played)
        live.setCompanionAudioPaused(false)
        client.eventSink!!.invoke(ServerEvent.AudioOut(byteArrayOf(1, 2), 24000))
        assertEquals(1, played)
        live.stop()
    }

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
        // The Brief carries the Patient's background; the safety rules are the server's.
        assertTrue(gateway.brief!!.contains("- Likes the sea"))
        assertTrue(client.sent.first().contains("The Check-in has started."))
        assertEquals(listOf(TranscriptLine(Speaker.Companion, "Hi, good to hear you."), TranscriptLine(Speaker.You, "I slept badly.")), snap.transcript)
        assertEquals(LiveState.Listening, snap.event.state)
        // No microphone here, so the Check-in continues typed.
        assertTrue(snap.muted)
        live.stop()
    }

    @Test
    fun contextToolsAnswerGeminiWithoutCardsWhileSuggestionsStillShow() {
        gateway.days = listOf(
            DailyDoc.of("2026-11-13", mapOf(Signal.SLEEP_MINUTES to 300.0), mapOf(Signal.SLEEP_MINUTES to -1.6, Signal.STEPS to 0.2), null, sharedWithClinician = true),
            DailyDoc.of("2026-11-12", emptyMap(), emptyMap(), null, sharedWithClinician = true),
        )
        gateway.summaries = listOf(app.depressify.core.model.Summary("saved", 1000, 2, null, null, "Broken sleep", listOf("Missing a friend"), emptyList(), null, null, emptyList(), true))
        val client = FakeLiveClient(listOf(
            call("get_health_summary", "days" to JsonPrimitive(7)),
            call("get_recent_summaries", "count" to JsonPrimitive(3)),
            call("record_suggestion", "kind" to JsonPrimitive("music"), "details" to JsonPrimitive("One calm song tonight")),
            call("suggest_music", "mood" to JsonPrimitive("tired after a long week")),
            call("find_places", "query" to JsonPrimitive("park near me")),
            call("no_such_tool"),
        ))
        val live = session(client)
        live.start(returning = true)
        val snap = live.snapshot.value

        // A missing day stays missing: only the day with a value is described, in words.
        assertTrue(client.sent.any { it.contains("Sleep: lower than usual") && it.contains("Steps: about the same as usual") })
        assertTrue(client.sent.any { it.contains("Missing a friend") && it.contains("mood_1_to_5") })
        assertEquals(2, snap.cards.size)
        // The fake has no music, so the card ends in its failed state while the Check-in goes on.
        assertEquals(ToolCard.Music("tired after a long week", null, failed = true), snap.cards.filterIsInstance<ToolCard.Music>().single())
        assertEquals("https://www.google.com/maps/search/?api=1&query=park%20near%20me", snap.cards.filterIsInstance<ToolCard.Places>().single().url)
        assertEquals(SuggestionKind.Music to "One calm song tonight", snap.offer to snap.offerDetails)
        assertTrue(gateway.suggestions.single().sharedWithClinician)
        assertEquals(6, client.sent.count { it.contains("toolResponse") })
        assertTrue(client.sent.any { it.contains("\"c-no_such_tool\"") && it.contains("unknown_tool") })
        live.stop()
    }

    @Test
    fun findPlacesShowsRealPlacesAndFallsBackToTheSearchLinkWhenTheLookupFails() {
        gateway.places = listOf(NearbyPlace("Otaniemi Yoga", "https://maps.google.com/?cid=1", 1240), NearbyPlace("Flowel yoga", "https://maps.google.com/?cid=2", 1605, walkMinutes = 28))
        val found = FakeLiveClient(listOf(call("find_places", "query" to JsonPrimitive("yoga studio"))))
        session(found).apply { start(returning = true) }.let { live ->
            assertEquals(gateway.places, assertIs<ToolCard.Places>(live.snapshot.value.cards.single()).places)
            assertTrue(found.sent.any { it.contains("Otaniemi Yoga") && it.contains("1.2 km") && it.contains("\"minutes_on_foot\":28") })
            live.stop()
        }

        gateway.places = null
        val failed = FakeLiveClient(listOf(call("find_places", "query" to JsonPrimitive("yoga studio"))))
        session(failed).apply { start(returning = true) }.let { live ->
            val card = assertIs<ToolCard.Places>(live.snapshot.value.cards.single())
            assertEquals(emptyList(), card.places)
            assertEquals("https://www.google.com/maps/search/?api=1&query=yoga%20studio", card.url)
            assertTrue(failed.sent.any { it.contains("lookup_failed") })
            live.stop()
        }
    }

    @Test
    fun theVoiceSheetsPlaceCardNamesTheNearestPlaceAndOpensItInGoogleMaps() {
        gateway.places = listOf(
            NearbyPlace("Karhupuisto", "https://maps.google.com/?cid=1", 350, walkMinutes = 5),
            NearbyPlace("Kaisaniemi Park", "https://maps.google.com/?cid=2", 1400, walkMinutes = 18),
        )
        val client = FakeLiveClient(listOf(
            call("record_suggestion", "kind" to JsonPrimitive("walk"), "details" to JsonPrimitive("Ten minutes outside before dark")),
            call("find_places", "query" to JsonPrimitive("park")),
        ))
        session(client).apply { start(returning = true) }.let { live ->
            val card = live.snapshot.value.suggestions.single()
            assertEquals("Karhupuisto · 5 min walk" to "https://maps.google.com/?cid=1", card.actionLabel to card.actionUrl)
            live.stop()
        }
    }

    @Test
    fun getWeatherShowsTheWeatherWithItsSourceAndAFailedLookupIsANamedError() {
        gateway.weather = Weather("Cloudy", 3, -3, 10, 26, goodForAWalk = true, sourceTitle = "Weather for Espoo - Google", sourceUrl = "https://www.google.com/search?q=Weather")
        val found = FakeLiveClient(listOf(call("get_weather")))
        session(found).apply { start(returning = true) }.let { live ->
            assertEquals(ToolCard.Weather("Cloudy, 3 °C, feels like -3 °C", "Weather for Espoo - Google", "https://www.google.com/search?q=Weather"), live.snapshot.value.cards.single())
            assertTrue(found.sent.any { it.contains("\"good_for_a_walk\":true") })
            live.stop()
        }

        gateway.weather = null
        val failed = FakeLiveClient(listOf(call("get_weather")))
        session(failed).apply { start(returning = true) }.let { live ->
            assertEquals(emptyList(), live.snapshot.value.cards)
            assertTrue(failed.sent.any { it.contains("backend_failed") })
            live.stop()
        }
    }

    @Test
    fun theCompanionLooksForPlacesAroundThePatientsOwnLocation() {
        patients.records["p1"] = patients.records.getValue("p1").copy(location = StoredPatientLocation("Kallio, Helsinki", 60.1841, 24.9497))
        val client = FakeLiveClient(listOf(call("find_places", "query" to JsonPrimitive("park"))))
        session(client).apply { start(returning = true) }.let { live ->
            assertEquals(PatientLocation("Kallio, Helsinki", 60.1841, 24.9497), gateway.lookedNear)
            live.stop()
        }
    }

    @Test
    fun suggestMusicAnswersAtOnceAndTheCardGetsTheClip() {
        val clip = MusicClip("audio/mpeg", byteArrayOf(1, 2, 3))
        gateway.music = clip
        // The token minted before the change still sends "query".
        val client = FakeLiveClient(listOf(call("suggest_music", "query" to JsonPrimitive("tense and tired"))))
        session(client).apply { start(returning = true) }.let { live ->
            assertEquals(ToolCard.Music("tense and tired", clip), live.snapshot.value.cards.single())
            assertTrue(client.sent.any { it.contains("being_made") })
            live.stop()
        }
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

    @Test
    fun finishingHandsOverTheConversationAndTheAgreedSuggestion() = runTest {
        val client = FakeLiveClient(listOf(
            ServerEvent.OutputText("How was today?"), ServerEvent.TurnComplete, ServerEvent.InputText("Tired."),
            call("record_suggestion", "kind" to JsonPrimitive("music"), "details" to JsonPrimitive("One calm song tonight")),
        ))
        val live = session(client)
        live.start(returning = true)
        live.respond(Reply.Accept)
        live.stop()

        val summary = live.finish()

        assertEquals("check-in-1", summary?.checkInId)
        val (checkInId, draft) = gateway.finished.single()
        assertEquals("check-in-1", checkInId)
        assertEquals(listOf(false to "How was today?", true to "Tired.", true to "That works for me."), draft.turns.map { it.fromPatient to it.text })
        assertEquals(SuggestionStatus.accepted, draft.suggestions.single().status)
        assertFalse(draft.crisis)
    }

    @Test
    fun suggestionsStackNewestFirstMapReadAndGameAndAllowSelectingAnyCard() = runTest {
        val client = FakeLiveClient(listOf(
            ServerEvent.OutputText("Would reading or a puzzle feel gentle?"),
            ServerEvent.TurnComplete,
            ServerEvent.InputText("Maybe."),
            call("record_suggestion", "kind" to JsonPrimitive("class_activity"), "details" to JsonPrimitive("Read two pages of a book with tea")),
            call("record_suggestion", "kind" to JsonPrimitive("class_activity"), "details" to JsonPrimitive("Fifteen minutes of a cozy puzzle game")),
            call("record_suggestion", "kind" to JsonPrimitive("music"), "details" to JsonPrimitive("One calm album")),
            call("suggest_music", "query" to JsonPrimitive("nordic ambient")),
        ))
        val live = session(client)
        live.start(returning = true)

        val snap = live.snapshot.value
        // Companion caption stays anchored on the AI's response even after Patient input.
        assertEquals(TranscriptLine(Speaker.Companion, "Would reading or a puzzle feel gentle?"), snap.companionLine)
        // Newest suggestion is at index 0; generated music opens the in-app listening session from the top Music card.
        assertEquals(listOf(SuggestionKind.Music, SuggestionKind.Game, SuggestionKind.Read), snap.suggestions.map { it.kind })
        assertTrue(snap.suggestions.first().opensListening)
        assertEquals(1, snap.suggestions.count { it.opensListening })

        val readCard = snap.suggestions.last()
        live.voteSuggestion(readCard.id, SuggestionVote.Up)
        assertEquals(SuggestionVote.Up, live.snapshot.value.suggestions.last().vote)

        // Selecting an older card in the horizontal stack marks that exact card accepted.
        live.selectSuggestion(readCard.id)
        assertEquals(SuggestionKind.Read, live.snapshot.value.offer)
        assertEquals(listOf(false, false, true), live.snapshot.value.suggestions.map { it.accepted })
        live.stop()

        live.finish()
        val statuses = gateway.finished.single().second.suggestions.map { it.details to it.status }
        assertEquals(
            listOf(
                "Read two pages of a book with tea" to SuggestionStatus.accepted,
                "Fifteen minutes of a cozy puzzle game" to SuggestionStatus.proposed,
                "One calm album" to SuggestionStatus.proposed,
            ),
            statuses,
        )
    }

    @Test
    fun scriptedSessionSeedsHorizontalStackNewestFirstAndPrependsSmallerIdeas() = runTest {
        val scripted = ScriptedLiveSession(this)
        scripted.start(returning = false)
        testScheduler.advanceUntilIdle()

        assertEquals(listOf(SuggestionKind.Walk, SuggestionKind.Music, SuggestionKind.Read), scripted.snapshot.value.suggestions.map { it.kind })

        scripted.respond(Reply.Smaller)
        testScheduler.advanceUntilIdle()
        assertEquals(SuggestionKind.Game, scripted.snapshot.value.suggestions.first().kind)
        assertEquals(4, scripted.snapshot.value.suggestions.size)

        scripted.respond(Reply.Smaller)
        testScheduler.advanceUntilIdle()
        assertEquals(SuggestionKind.Window, scripted.snapshot.value.suggestions.first().kind)
        assertEquals(5, scripted.snapshot.value.suggestions.size)
        scripted.stop()
    }
}
