package app.depressify.shared.voice

import app.depressify.core.SuggestionKind
import app.depressify.shared.data.CheckInGateway
import app.depressify.shared.data.PatientStore
import app.depressify.shared.voice.live.AudioIO
import app.depressify.shared.voice.live.CompanionTools
import app.depressify.shared.voice.live.LiveClient
import app.depressify.shared.voice.live.LiveProtocol
import app.depressify.shared.voice.live.ServerEvent
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
import app.depressify.core.model.SuggestionKind as ContractKind

/**
 * A Check-in over Gemini Live. The phone asks Start Check-in for a short-lived token, opens the
 * WebSocket itself (ADR 0002), streams the microphone, plays the Companion's speech, and answers
 * the Companion's tool calls from the Patient's own records.
 *
 * While no Patient is signed in ([patientId] is null) it plays [fallback], the scripted demo.
 * The transcript lives only in [snapshot], in memory (ADR 0006).
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

    /** The speaker whose words are still arriving; their next piece joins the same line. */
    private var openLine: Speaker? = null

    override val isLive: Boolean get() = !scripted

    override fun start(returning: Boolean) {
        stop()
        val id = patientId()
        scripted = id == null
        if (id == null) {
            fallback.start(returning)
            job = scope.launch { fallback.snapshot.collect { state.value = it } }
        } else {
            state.value = LiveSnapshot(event = LiveEvent(LiveState.Connecting, if (returning) 0 else 1))
            connect(id)
        }
    }

    private fun connect(id: String) {
        val out = Channel<String>(Channel.UNLIMITED)
        outgoing = out
        openLine = null
        job = scope.launch {
            try {
                val start = checkIns.startCheckIn(id)
                val tools = CompanionTools(patients, checkIns, id, nowMillis, effects)
                client.run(start.token, start.model, out) { handle(it, tools, out) }
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
                out.send(LiveProtocol.text("The Check-in has started."))
                val listening = audio?.start { frame -> if (!state.value.muted) out.trySend(LiveProtocol.audio(frame)) } ?: false
                if (!listening) state.update { it.copy(muted = true) }
                show(LiveState.Thinking, tool = "Getting ready")
            }
            is ServerEvent.AudioOut -> audio?.play(event.pcm24k)
            is ServerEvent.OutputText -> say(Speaker.Companion, event.text, LiveState.Speaking)
            is ServerEvent.InputText -> say(Speaker.You, event.text, LiveState.Listening)
            is ServerEvent.ToolCall -> {
                openLine = null
                show(LiveState.Thinking, tool = CompanionTools.label(event.name))
                out.send(LiveProtocol.toolResponse(event.id, event.name, tools.dispatch(event.name, event.args)))
            }
            ServerEvent.Interrupted -> { audio?.stopPlayback(); openLine = null; show(LiveState.Listening) }
            ServerEvent.TurnComplete -> { openLine = null; show(LiveState.Listening) }
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

    private fun step(s: LiveSnapshot) = when { s.wrapped -> 3; s.offer != null -> 2; else -> s.event.step }

    private fun lost() = state.update { it.copy(connected = false) }

    private val effects = object : ToolEffects {
        override fun show(card: ToolCard) = state.update { it.copy(cards = it.cards.filterNot { c -> c::class == card::class && (c as? ToolCard.Insight)?.title == (card as? ToolCard.Insight)?.title } + card) }
        override fun offer(kind: ContractKind, details: String) = state.update { it.copy(offer = kind.forScreen(), offerDetails = details, accepted = false) }
        override fun wrapUp() = state.update { it.copy(wrapped = true) }
        override fun crisis() = onCrisis()
    }

    override fun sendText(text: String) {
        if (scripted) return
        openLine = null
        state.update { it.copy(transcript = it.transcript + TranscriptLine(Speaker.You, text)) }
        outgoing?.trySend(LiveProtocol.text(text))
    }

    override fun respond(reply: Reply) {
        if (scripted) return fallback.respond(reply)
        if (reply == Reply.Accept) state.update { it.copy(accepted = true) }
        sendText(when (reply) { Reply.Accept -> "That works for me."; Reply.Smaller -> "Something smaller, please."; Reply.Decline -> "Not now." })
    }

    override fun interrupt() {
        if (scripted) fallback.interrupt() else audio?.stopPlayback()
    }

    override fun setMuted(muted: Boolean) {
        if (scripted) return fallback.setMuted(muted)
        state.update { it.copy(muted = muted) }
        if (muted) outgoing?.trySend(LiveProtocol.audioStreamEnd())
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
        job?.cancel()
        job = null
        outgoing = null
        fallback.stop()
    }
}

/** The screen has four Suggestion cards; the contract has seven kinds. */
private fun ContractKind.forScreen(): SuggestionKind = when (this) {
    ContractKind.music -> SuggestionKind.Music
    ContractKind.social_call -> SuggestionKind.Call
    ContractKind.breathing -> SuggestionKind.Window
    ContractKind.walk, ContractKind.nature, ContractKind.daylight, ContractKind.class_activity -> SuggestionKind.Walk
}
