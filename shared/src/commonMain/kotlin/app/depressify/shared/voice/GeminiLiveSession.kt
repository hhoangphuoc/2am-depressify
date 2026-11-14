package app.depressify.shared.voice

import app.depressify.core.SuggestionKind
import app.depressify.core.live.LiveProtocol
import app.depressify.core.model.Suggestion
import app.depressify.core.model.SuggestionStatus
import app.depressify.core.model.Summary
import app.depressify.shared.data.CheckInDraft
import app.depressify.shared.data.CheckInGateway
import app.depressify.shared.data.DraftTurn
import app.depressify.shared.data.PatientStore
import app.depressify.shared.voice.live.AudioIO
import app.depressify.shared.voice.live.CheckInBrief
import app.depressify.shared.voice.live.CompanionTools
import app.depressify.shared.voice.live.LiveClient
import app.depressify.shared.voice.live.ToolCard
import app.depressify.shared.voice.live.ToolEffects
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import app.depressify.core.live.LiveEvent as ServerEvent
import app.depressify.core.model.SuggestionKind as ContractKind

/**
 * A Check-in over Gemini Live. The phone asks Start Check-in for a short-lived token, opens the
 * WebSocket itself (ADR 0002), streams the microphone, plays the Companion's speech, and answers
 * the Companion's tool calls from the Patient's own records.
 *
 * While no Patient is signed in ([patientId] is null) it plays [fallback], the scripted demo.
 * The transcript lives only in [snapshot], in memory, until [finish] hands it to Finish Check-in
 * (ADR 0006).
 */
class GeminiLiveSession(
    private val scope: CoroutineScope,
    private val patients: PatientStore,
    private val checkIns: CheckInGateway,
    private val client: LiveClient,
    private val audio: AudioIO?,
    private val patientId: () -> String?,
    private val fallback: LiveSession,
    private val onCrisis: () -> Unit,
    private val nowMillis: () -> Long,
) : LiveSession {
    private val state = MutableStateFlow(LiveSnapshot())
    override val snapshot: StateFlow<LiveSnapshot> = state.asStateFlow()

    private var job: Job? = null
    private var outgoing: Channel<String>? = null
    private var scripted = true
    private var companionAudioPaused = false

    /** The Patient and the Check-in that [finish] closes. A reconnect starts a new Check-in id. */
    private var patient: String? = null
    private var checkInId: String? = null
    private val offered = mutableListOf<Suggestion>()
    private var acceptedSuggestionId: String? = null
    private var toolSuggestionSeq = 1
    private var crisis = false

    /** The speaker whose words are still arriving; their next piece joins the same line. */
    private var openLine: Speaker? = null

    override val isLive: Boolean get() = !scripted

    override fun start(returning: Boolean, typed: Boolean) {
        stop()
        val id = patientId()
        scripted = id == null
        if (id == null) {
            fallback.start(returning)
            job = scope.launch { fallback.snapshot.collect { state.value = it } }
        } else {
            patient = id
            checkInId = null
            offered.clear()
            acceptedSuggestionId = null
            toolSuggestionSeq = 1
            crisis = false
            state.value = LiveSnapshot(event = LiveEvent(LiveState.Connecting, if (returning) 0 else 1), muted = typed)
            connect(id)
        }
    }

    private fun connect(id: String) {
        val out = Channel<String>(Channel.UNLIMITED)
        outgoing = out
        openLine = null
        job = scope.launch {
            try {
                val brief = CheckInBrief.build(patients.get(id)?.intakeHighlights.orEmpty())
                val start = checkIns.startCheckIn(id, brief, typed = state.value.muted)
                checkInId = start.checkInId
                // This coroutine's scope: music still being made is cancelled with the Check-in.
                val tools = CompanionTools(patients, checkIns, id, nowMillis, effects, scope = this)
                client.run(start.endpoint, start.token, start.model, out) { handle(it, tools, out) }
                lost()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // The class only: a WebSocket error message can carry the URL, and with it the token.
                println("Check-in connection failed: " + e::class.simpleName)
                lost()
            } finally {
                audio?.stop()
                out.close()
            }
        }
    }

    private suspend fun handle(event: ServerEvent, tools: CompanionTools, out: Channel<String>) {
        when (event) {
            ServerEvent.SetupComplete -> {
                // The Companion speaks first: the app, not the Patient, opens the conversation.
                out.send(LiveProtocol.textMessage("The Check-in has started."))
                val listening = audio?.start { frame -> if (!state.value.muted) out.trySend(LiveProtocol.audioMessage(frame)) } ?: false
                if (!listening) state.update { it.copy(muted = true) }
                show(LiveState.Thinking, tool = "Getting ready")
            }
            is ServerEvent.AudioOut -> if (!companionAudioPaused) audio?.play(event.pcm) else Unit
            is ServerEvent.OutputText -> say(Speaker.Companion, event.text, LiveState.Speaking)
            is ServerEvent.InputText -> say(Speaker.You, event.text, LiveState.Listening)
            is ServerEvent.ToolCall -> {
                openLine = null
                show(LiveState.Thinking, tool = CompanionTools.label(event.name))
                out.send(LiveProtocol.toolResponseMessage(event.id, event.name, tools.dispatch(event.name, event.args)))
            }
            ServerEvent.Interrupted -> { audio?.stopPlayback(); openLine = null; show(LiveState.Listening) }
            ServerEvent.TurnComplete -> { openLine = null; show(LiveState.Listening) }
            // Usage counts, voice activity, going-away notices and the rest change nothing on screen.
            else -> Unit
        }
    }

    /** Adds [text] to the transcript, joining it to the line [speaker] is still saying. */
    private fun say(speaker: Speaker, text: String, live: LiveState) = state.update { s ->
        val last = s.transcript.lastOrNull()
        val line = if (openLine == speaker && last?.speaker == speaker) last.copy(text = last.text + text) else TranscriptLine(speaker, text.trimStart())
        val transcript = if (openLine == speaker && last?.speaker == speaker) s.transcript.dropLast(1) + line else s.transcript + line
        openLine = speaker
        s.copy(event = LiveEvent(live, step(s), speaker, line.text), transcript = transcript)
    }

    private fun show(live: LiveState, tool: String? = null) = state.update { it.copy(event = LiveEvent(live, step(it), tool = tool)) }

    private fun step(s: LiveSnapshot) = if (s.offer != null) 2 else s.event.step

    private fun lost() = state.update { it.copy(connected = false) }

    private val effects = object : ToolEffects {
        override fun show(card: ToolCard) = state.update { s ->
            val nextCards = s.cards.filterNot { c -> c::class == card::class } + card
            val nextSuggestions = when (card) {
                // Generated music plays in the in-app listening session; the card updates in place when the clip arrives.
                is ToolCard.Music -> {
                    val top = s.suggestions.firstOrNull()
                    when {
                        s.suggestions.any { it.opensListening } -> s.suggestions
                        top != null && top.kind == SuggestionKind.Music -> listOf(top.copy(opensListening = true, actionLabel = "Listen")) + s.suggestions.drop(1)
                        else ->
                        listOf(
                            SessionSuggestion(
                                id = "tool-music-${toolSuggestionSeq++}",
                                kind = SuggestionKind.Music,
                                title = card.mood.replaceFirstChar { it.uppercase() },
                                detail = SuggestionKind.Music.detail,
                                actionLabel = "Listen",
                                opensListening = true,
                            )
                        ) + s.suggestions
                    }
                }
                is ToolCard.Places -> {
                    val top = s.suggestions.firstOrNull()
                    if (top != null && top.kind == SuggestionKind.Walk && top.actionUrl == null) {
                        listOf(top.copy(actionUrl = card.url, actionLabel = "Open in Google Maps")) + s.suggestions.drop(1)
                    } else {
                        listOf(
                            SessionSuggestion(
                                id = "tool-place-${toolSuggestionSeq++}",
                                kind = SuggestionKind.Walk,
                                title = card.query.replaceFirstChar { it.uppercase() },
                                detail = SuggestionKind.Walk.detail,
                                actionUrl = card.url,
                                actionLabel = "Open in Google Maps",
                            )
                        ) + s.suggestions
                    }
                }
                is ToolCard.Weather -> s.suggestions
            }
            s.copy(cards = nextCards, suggestions = nextSuggestions)
        }

        override fun offer(suggestion: Suggestion) {
            offered += suggestion
            acceptedSuggestionId = null
            val uiKind = suggestion.kind.forScreen(suggestion.details)
            state.update { s ->
                val pendingTool = s.suggestions.firstOrNull()?.takeIf { it.id.startsWith("tool-") && it.kind == uiKind }
                val item = SessionSuggestion(
                    id = suggestion.id,
                    kind = uiKind,
                    title = uiKind.defaultCardTitle(),
                    detail = suggestion.details.ifBlank { uiKind.detail },
                    actionUrl = pendingTool?.actionUrl,
                    actionLabel = pendingTool?.actionLabel,
                    opensListening = pendingTool?.opensListening == true,
                )
                val remaining = (if (pendingTool != null) s.suggestions.drop(1) else s.suggestions).map { it.copy(accepted = false) }
                s.copy(
                    offer = uiKind,
                    offerDetails = suggestion.details,
                    accepted = false,
                    suggestions = listOf(item) + remaining,
                )
            }
        }

        override fun crisis() { crisis = true; onCrisis() }
    }

    override suspend fun finish(): Summary? {
        val id = patient
        val checkIn = checkInId
        if (scripted || id == null || checkIn == null) return null
        val snap = state.value
        val turns = snap.transcript.map { DraftTurn(fromPatient = it.speaker == Speaker.You, text = it.text) }
        val chosenId = acceptedSuggestionId
        val hasExactChosen = chosenId != null && offered.any { it.id == chosenId }
        val suggestions = offered.mapIndexed { i, s ->
            val isChosen = if (hasExactChosen) s.id == chosenId else i == offered.lastIndex
            if (snap.accepted && isChosen) s.copy(status = SuggestionStatus.accepted) else s
        }
        return checkIns.finishCheckIn(id, checkIn, CheckInDraft(turns, suggestions, crisis))
    }

    override fun sendText(text: String) {
        if (scripted) return
        openLine = null
        state.update { it.copy(transcript = it.transcript + TranscriptLine(Speaker.You, text)) }
        outgoing?.trySend(LiveProtocol.textMessage(text))
    }

    override fun selectSuggestion(suggestionId: String) {
        if (scripted) return fallback.selectSuggestion(suggestionId)
        val before = state.value
        val index = before.suggestions.indexOfFirst { it.id == suggestionId }
        val chosen = before.suggestions.getOrNull(index) ?: return respond(Reply.Accept)
        acceptedSuggestionId = suggestionId
        state.update { s ->
            s.copy(
                offer = chosen.kind,
                offerDetails = chosen.detail,
                accepted = true,
                suggestions = s.suggestions.map { it.copy(accepted = it.id == suggestionId) },
            )
        }
        sendText(if (index <= 0) "That works for me." else "That works for me: ${chosen.detail}")
    }

    override fun voteSuggestion(suggestionId: String, vote: SuggestionVote?) {
        if (scripted) return fallback.voteSuggestion(suggestionId, vote)
        state.update { s -> s.copy(suggestions = s.suggestions.map { if (it.id == suggestionId) it.copy(vote = vote) else it }) }
    }

    override fun respond(reply: Reply) {
        if (scripted) return fallback.respond(reply)
        if (reply == Reply.Accept) {
            state.update { s ->
                val chosenId = acceptedSuggestionId ?: s.suggestions.firstOrNull()?.id
                acceptedSuggestionId = chosenId
                s.copy(
                    accepted = true,
                    suggestions = s.suggestions.map { it.copy(accepted = it.id == chosenId) },
                )
            }
        }
        sendText(when (reply) { Reply.Accept -> "That works for me."; Reply.Smaller -> "Something smaller, please."; Reply.Decline -> "Not now." })
    }

    override fun interrupt() {
        if (scripted) fallback.interrupt() else audio?.stopPlayback()
    }

    override fun setCompanionAudioPaused(paused: Boolean) {
        companionAudioPaused = paused
        if (paused) audio?.stopPlayback()
    }

    override fun setMuted(muted: Boolean) {
        if (scripted) return fallback.setMuted(muted)
        state.update { it.copy(muted = muted) }
        if (muted) outgoing?.trySend(LiveProtocol.audioStreamEndMessage())
    }

    /** "Try again" after a lost connection reconnects and keeps what was said so far. */
    override fun setConnected(connected: Boolean) {
        if (scripted) return fallback.setConnected(connected)
        val id = patientId()
        if (connected && !state.value.connected && id != null) {
            job?.cancel()
            state.update { it.copy(connected = true, event = LiveEvent(LiveState.Connecting, step(it))) }
            connect(id)
        }
    }

    override fun stop() {
        companionAudioPaused = false
        job?.cancel()
        job = null
        outgoing = null
        fallback.stop()
    }
}

/** Maps the seven contract kinds onto the six Patient screen Suggestion cards. */
private fun ContractKind.forScreen(details: String = ""): SuggestionKind {
    val d = details.lowercase()
    return when (this) {
        ContractKind.music -> SuggestionKind.Music
        ContractKind.social_call -> SuggestionKind.Call
        ContractKind.breathing -> SuggestionKind.Window
        ContractKind.daylight -> if ("window" in d) SuggestionKind.Window else SuggestionKind.Walk
        ContractKind.class_activity -> when {
            listOf("read", "book", "page", "story", "poem").any { it in d } -> SuggestionKind.Read
            listOf("game", "puzzle", "play", "tangram", "crossword").any { it in d } -> SuggestionKind.Game
            else -> SuggestionKind.Walk
        }
        ContractKind.walk, ContractKind.nature -> SuggestionKind.Walk
    }
}
