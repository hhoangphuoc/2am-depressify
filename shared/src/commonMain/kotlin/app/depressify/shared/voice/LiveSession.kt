package app.depressify.shared.voice

import app.depressify.core.Outcome
import app.depressify.core.SuggestionKind
import app.depressify.shared.voice.live.ToolCard
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Voice session states, each mapped to a Gemini Live event (docs/research/gemini-api.md):
 * Connecting = token + setupComplete, Speaking = model audio + outputTranscription,
 * Listening = mic stream + inputTranscription, Thinking = toolCall, Paused = audioStreamEnd.
 */
enum class LiveState(val label: String) {
    Connecting("Connecting"), Speaking("Speaking"), Listening("Listening"), Thinking("One moment"), Paused("Microphone off")
}

enum class Speaker(val label: String) { Companion("Companion"), You("You") }

enum class Reply { Accept, Smaller, Decline }

data class TranscriptLine(val speaker: Speaker, val text: String)

data class LiveEvent(
    val state: LiveState,
    val step: Int,
    val speaker: Speaker? = null,
    val text: String? = null,
    val tool: String? = null,
    val millis: Long? = null,
    val outcome: Outcome? = null,
    val offer: SuggestionKind? = null,
    val wrap: Boolean = false,
    val waitForPatient: Boolean = false,
) {
    val duration: Long get() = millis ?: if (text == null) 1200 else text.split(' ').size * (if (speaker == Speaker.You) 300L else 250L) + 900
}

data class LiveSnapshot(
    val event: LiveEvent = LiveEvent(LiveState.Connecting, 0),
    val muted: Boolean = false,
    val connected: Boolean = true,
    val transcript: List<TranscriptLine> = emptyList(),
    val outcome: Outcome? = null,
    val offer: SuggestionKind? = null,
    val accepted: Boolean = false,
    val wrapped: Boolean = false,
    /** The Companion's own wording of the Suggestion, when it comes from a live Check-in. */
    val offerDetails: String? = null,
    /** What tool calls have put on screen, oldest first. */
    val cards: List<ToolCard> = emptyList(),
) {
    val shownState: LiveState get() = if (muted || !connected) LiveState.Paused else event.state
}

/** The contract a real Gemini Live client will implement; the prototype plays a script. */
interface LiveSession {
    val snapshot: StateFlow<LiveSnapshot>

    /** True while the running Check-in is a real Gemini Live connection, not the script. */
    val isLive: Boolean get() = false

    /** [typed] starts a live Check-in with the microphone off. */
    fun start(returning: Boolean, typed: Boolean = false)
    fun interrupt()
    fun setMuted(muted: Boolean)
    fun respond(reply: Reply)
    fun setConnected(connected: Boolean)
    fun stop()

    /** Sends typed words to the Companion. The script ignores them. */
    fun sendText(text: String) {}

    /**
     * Hands a live Check-in to Finish Check-in and returns the Summary it wrote; [ratingsLine] is
     * what the Patient rated on screen, in words. Null when the Check-in was the script. Throws when
     * the finish fails; calling again retries the same Check-in.
     */
    suspend fun finish(ratingsLine: String?): app.depressify.core.model.Summary? = null
}

object LiveScript {
    val steps = listOf("Last time", "Your day", "One idea", "Wrap up")
    private const val tool = "Checking tomorrow’s weather and places nearby"

    val returning = listOf(
        LiveEvent(LiveState.Connecting, 0, millis = 1200),
        LiveEvent(LiveState.Speaking, 0, Speaker.Companion, "Hi Alex, good to hear from you. Did you get to try the walk?"),
        LiveEvent(LiveState.Listening, 0, Speaker.You, "I did. About ten minutes. It felt a bit lighter.", outcome = Outcome.Tried(null)),
        LiveEvent(LiveState.Speaking, 0, Speaker.Companion, "That’s good to hear. From 1 to 5, how did it feel?"),
        LiveEvent(LiveState.Listening, 0, Speaker.You, "Maybe a four.", outcome = Outcome.Tried(4)),
        LiveEvent(LiveState.Speaking, 1, Speaker.Companion, "Thank you. How has today been so far?"),
        LiveEvent(LiveState.Listening, 1, Speaker.You, "Tired. I slept badly and stayed in most of the morning."),
        LiveEvent(LiveState.Thinking, 2, tool = tool, millis = 1900),
        LiveEvent(LiveState.Speaking, 2, Speaker.Companion, "Tomorrow looks dry around eleven, and Töölönlahti is about nine minutes away. Would a short walk there feel right?", offer = SuggestionKind.Walk),
        LiveEvent(LiveState.Listening, 2, waitForPatient = true),
    )

    val firstTime = listOf(
        LiveEvent(LiveState.Connecting, 0, millis = 1200),
        LiveEvent(LiveState.Speaking, 1, Speaker.Companion, "Hi, I’m your AI Companion. I’m not a clinician. How are you feeling today?"),
        LiveEvent(LiveState.Listening, 1, Speaker.You, "Okay, I guess. A bit flat."),
        LiveEvent(LiveState.Thinking, 2, tool = tool, millis = 1900),
        LiveEvent(LiveState.Speaking, 2, Speaker.Companion, "Thanks for telling me. Tomorrow looks dry around eleven. Would a short walk feel right?", offer = SuggestionKind.Walk),
        LiveEvent(LiveState.Listening, 2, waitForPatient = true),
    )

    fun reply(reply: Reply): List<LiveEvent> = when (reply) {
        Reply.Accept -> listOf(
            LiveEvent(LiveState.Speaking, 2, Speaker.Companion, "Good. I can add it to your calendar for eleven, if you like."),
            LiveEvent(LiveState.Speaking, 3, Speaker.Companion, "Before we finish, three quick ratings. You can skip any of them.", wrap = true),
        )
        Reply.Smaller -> listOf(
            LiveEvent(LiveState.Speaking, 2, Speaker.Companion, "Of course. How about one minute by a window, whenever it suits you?", offer = SuggestionKind.Window),
            LiveEvent(LiveState.Listening, 2, waitForPatient = true),
        )
        Reply.Decline -> listOf(LiveEvent(LiveState.Speaking, 3, Speaker.Companion, "That’s okay. Rest counts too. Shall we wrap up?", wrap = true))
    }
}

/** Plays [LiveScript] with timed events. Muting or losing the connection pauses the script in place. */
class ScriptedLiveSession(private val scope: CoroutineScope) : LiveSession {
    private val state = MutableStateFlow(LiveSnapshot())
    override val snapshot: StateFlow<LiveSnapshot> = state.asStateFlow()
    private var queue = mutableListOf<LiveEvent>()
    private var index = 0
    private var job: Job? = null

    override fun start(returning: Boolean, typed: Boolean) {
        queue = (if (returning) LiveScript.returning else LiveScript.firstTime).toMutableList()
        state.value = LiveSnapshot()
        enter(0)
        play()
    }

    override fun interrupt() {
        if (state.value.event.state != LiveState.Speaking) return
        advance()
        play()
    }

    override fun setMuted(muted: Boolean) {
        state.update { it.copy(muted = muted) }
        play()
    }

    override fun setConnected(connected: Boolean) {
        state.update { it.copy(connected = connected) }
        play()
    }

    override fun respond(reply: Reply) {
        val spoken = when (reply) { Reply.Accept -> "That works for me."; Reply.Smaller -> "Something smaller, please."; Reply.Decline -> "Not now." }
        state.update { it.copy(transcript = it.transcript + TranscriptLine(Speaker.You, spoken), accepted = reply == Reply.Accept || it.accepted) }
        queue = (queue.take(index + 1) + LiveScript.reply(reply)).toMutableList()
        enter(index + 1)
        play()
    }

    override fun stop() { job?.cancel() }

    private fun play() {
        job?.cancel()
        job = scope.launch {
            while (true) {
                val s = state.value
                if (s.event.waitForPatient || s.muted || !s.connected) return@launch
                delay(s.event.duration)
                advance()
            }
        }
    }

    private fun advance() {
        if (index >= queue.lastIndex) queue += LiveEvent(LiveState.Listening, queue[index].step, waitForPatient = true)
        enter(index + 1)
    }

    private fun enter(i: Int) {
        index = i
        val e = queue[i]
        state.update { s ->
            s.copy(
                event = e,
                transcript = if (e.text != null && e.speaker != null) s.transcript + TranscriptLine(e.speaker, e.text) else s.transcript,
                outcome = e.outcome ?: s.outcome,
                offer = e.offer ?: s.offer,
                wrapped = s.wrapped || e.wrap,
            )
        }
    }
}
