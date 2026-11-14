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

enum class SuggestionVote { Up, Down }

data class TranscriptLine(val speaker: Speaker, val text: String)

/** One activity recommendation card in the Voice Check-in horizontal stack (newest at index 0). */
data class SessionSuggestion(
    val id: String,
    val kind: SuggestionKind,
    val kicker: String = kind.defaultKicker(),
    val title: String = kind.defaultCardTitle(),
    val detail: String = kind.detail,
    val accepted: Boolean = false,
    val vote: SuggestionVote? = null,
    val actionUrl: String? = null,
    val actionLabel: String? = null,
    /** Opens the in-app listening session for this Check-in's generated music. */
    val opensListening: Boolean = false,
)

fun SuggestionKind.defaultKicker(): String = when (this) {
    SuggestionKind.Walk -> "Outdoors · ~10 min"
    SuggestionKind.Music -> "Listen · 10–15 min"
    SuggestionKind.Read -> "Read · At your pace"
    SuggestionKind.Game -> "Play · Gentle focus"
    SuggestionKind.Window -> "Smallest step · 1 min"
    SuggestionKind.Call -> "Connect · Your choice"
}

fun SuggestionKind.defaultCardTitle(): String = when (this) {
    SuggestionKind.Walk -> "Quiet walk by Töölönlahti"
    SuggestionKind.Music -> "Put on one calm, familiar album"
    SuggestionKind.Read -> "Read two pages with warm tea"
    SuggestionKind.Game -> "15 min of a cozy puzzle or game"
    SuggestionKind.Window -> "One minute by an open window"
    SuggestionKind.Call -> "A short call to someone close"
}

data class LiveEvent(
    val state: LiveState,
    val step: Int,
    val speaker: Speaker? = null,
    val text: String? = null,
    val tool: String? = null,
    val millis: Long? = null,
    val outcome: Outcome? = null,
    val offer: SuggestionKind? = null,
    val stackedOffers: List<SuggestionKind> = emptyList(),
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
    /** The Companion's own wording of the Suggestion, when it comes from a live Check-in. */
    val offerDetails: String? = null,
    /** What tool calls have put on screen, oldest first. */
    val cards: List<ToolCard> = emptyList(),
    /** Session activity suggestions, newest first (index 0 = top of horizontal stack). */
    val suggestions: List<SessionSuggestion> = emptyList(),
) {
    val shownState: LiveState get() = if (muted || !connected) LiveState.Paused else event.state

    /** Latest utterance from the AI Companion; stays visible as an anchor while listening to the Patient. */
    val companionLine: TranscriptLine?
        get() = if (event.speaker == Speaker.Companion && event.text != null) {
            TranscriptLine(Speaker.Companion, event.text)
        } else {
            transcript.lastOrNull { it.speaker == Speaker.Companion }
        }
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
    /** Suppresses Companion speech while generated music is playing. */
    fun setCompanionAudioPaused(paused: Boolean) {}
    fun respond(reply: Reply)
    fun selectSuggestion(suggestionId: String) { respond(Reply.Accept) }
    fun voteSuggestion(suggestionId: String, vote: SuggestionVote?) {}
    fun setConnected(connected: Boolean)
    fun stop()

    /** Sends typed words to the Companion. The script ignores them. */
    fun sendText(text: String) {}

    /**
     * Hands a live Check-in to Finish Check-in and returns the Summary it wrote. Null when the
     * Check-in was the script. Throws when the finish fails; calling again retries the same Check-in.
     */
    suspend fun finish(): app.depressify.core.model.Summary? = null
}

object LiveScript {
    val steps = listOf("Last time", "Your day", "One idea", "Wrap up")
    private const val tool = "Checking tomorrow’s weather and gentle ideas"

    private val initialStack = listOf(SuggestionKind.Walk, SuggestionKind.Music, SuggestionKind.Read)

    val returning = listOf(
        LiveEvent(LiveState.Connecting, 0, millis = 1200),
        LiveEvent(LiveState.Speaking, 0, Speaker.Companion, "Hi Alex, good to hear from you. Did you get to try the walk?"),
        LiveEvent(LiveState.Listening, 0, Speaker.You, "I did. About ten minutes. It felt a bit lighter.", outcome = Outcome.Tried(null)),
        LiveEvent(LiveState.Speaking, 0, Speaker.Companion, "That’s good to hear. From 1 to 5, how did it feel?"),
        LiveEvent(LiveState.Listening, 0, Speaker.You, "Maybe a four.", outcome = Outcome.Tried(4)),
        LiveEvent(LiveState.Speaking, 1, Speaker.Companion, "Thank you. How has today been so far?"),
        LiveEvent(LiveState.Listening, 1, Speaker.You, "Tired. I slept badly and stayed in most of the morning."),
        LiveEvent(LiveState.Thinking, 2, tool = tool, millis = 1900),
        LiveEvent(
            LiveState.Speaking,
            2,
            Speaker.Companion,
            "Tomorrow looks dry around eleven, and Töölönlahti is nine minutes away—would a quiet walk feel right, or something gentle indoors?",
            offer = SuggestionKind.Walk,
            stackedOffers = initialStack,
        ),
        LiveEvent(LiveState.Listening, 2, waitForPatient = true),
    )

    val firstTime = listOf(
        LiveEvent(LiveState.Connecting, 0, millis = 1200),
        LiveEvent(LiveState.Speaking, 1, Speaker.Companion, "Hi, I’m your AI Companion. I’m not a clinician. How are you feeling today?"),
        LiveEvent(LiveState.Listening, 1, Speaker.You, "Okay, I guess. A bit flat."),
        LiveEvent(LiveState.Thinking, 2, tool = tool, millis = 1900),
        LiveEvent(
            LiveState.Speaking,
            2,
            Speaker.Companion,
            "Thanks for telling me. Tomorrow looks dry around eleven—would a short walk feel right, or something calm at home?",
            offer = SuggestionKind.Walk,
            stackedOffers = initialStack,
        ),
        LiveEvent(LiveState.Listening, 2, waitForPatient = true),
    )

    fun reply(reply: Reply, smallerCount: Int = 0): List<LiveEvent> = when (reply) {
        Reply.Accept -> listOf(
            LiveEvent(LiveState.Speaking, 2, Speaker.Companion, "Good. We’ll keep it gentle and unhurried."),
            LiveEvent(LiveState.Speaking, 3, Speaker.Companion, "I’m here if there’s anything else on your mind. Tap Finish whenever you’re ready."),
        )
        Reply.Smaller -> if (smallerCount == 0) listOf(
            LiveEvent(
                LiveState.Speaking,
                2,
                Speaker.Companion,
                "Of course. Fifteen unhurried minutes with a cozy puzzle or game can give busy thoughts somewhere soft to land.",
                offer = SuggestionKind.Game,
            ),
            LiveEvent(LiveState.Listening, 2, waitForPatient = true),
        ) else listOf(
            LiveEvent(
                LiveState.Speaking,
                2,
                Speaker.Companion,
                "Let’s make it tiny: standing by an open window for one quiet minute, whenever it suits you.",
                offer = SuggestionKind.Window,
            ),
            LiveEvent(LiveState.Listening, 2, waitForPatient = true),
        )
        Reply.Decline -> listOf(LiveEvent(LiveState.Speaking, 3, Speaker.Companion, "That’s okay. Rest counts too. Tap Finish whenever you’re ready."))
    }
}

/** Plays [LiveScript] with timed events. Muting or losing the connection pauses the script in place. */
class ScriptedLiveSession(private val scope: CoroutineScope) : LiveSession {
    private val state = MutableStateFlow(LiveSnapshot())
    override val snapshot: StateFlow<LiveSnapshot> = state.asStateFlow()
    private var queue = mutableListOf<LiveEvent>()
    private var index = 0
    private var smallerCount = 0
    private var nextSuggestionSeq = 1
    private var job: Job? = null

    override fun start(returning: Boolean, typed: Boolean) {
        queue = (if (returning) LiveScript.returning else LiveScript.firstTime).toMutableList()
        smallerCount = 0
        nextSuggestionSeq = 1
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

    override fun selectSuggestion(suggestionId: String) {
        state.update { s ->
            val target = s.suggestions.firstOrNull { it.id == suggestionId } ?: return@update s
            s.copy(
                offer = target.kind,
                offerDetails = target.detail,
                accepted = true,
                suggestions = s.suggestions.map { it.copy(accepted = it.id == suggestionId) },
            )
        }
        respond(Reply.Accept)
    }

    override fun voteSuggestion(suggestionId: String, vote: SuggestionVote?) {
        state.update { s ->
            s.copy(suggestions = s.suggestions.map { if (it.id == suggestionId) it.copy(vote = vote) else it })
        }
    }

    override fun respond(reply: Reply) {
        val spoken = when (reply) { Reply.Accept -> "That works for me."; Reply.Smaller -> "Something smaller, please."; Reply.Decline -> "Not now." }
        val stepSmaller = smallerCount
        if (reply == Reply.Smaller) smallerCount++
        state.update { s ->
            val updatedSuggestions = if (reply == Reply.Accept && s.suggestions.none { it.accepted }) {
                s.suggestions.mapIndexed { idx, item -> item.copy(accepted = idx == 0) }
            } else s.suggestions
            s.copy(
                transcript = s.transcript + TranscriptLine(Speaker.You, spoken),
                accepted = reply == Reply.Accept || s.accepted,
                suggestions = updatedSuggestions,
            )
        }
        queue = (queue.take(index + 1) + LiveScript.reply(reply, stepSmaller)).toMutableList()
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
            val incomingKinds = when {
                e.stackedOffers.isNotEmpty() -> e.stackedOffers
                e.offer != null -> listOf(e.offer)
                else -> emptyList()
            }
            val prepended = incomingKinds.map { kind ->
                SessionSuggestion(
                    id = "script-${nextSuggestionSeq++}",
                    kind = kind,
                    actionUrl = if (kind == SuggestionKind.Walk) "https://www.google.com/maps/search/?api=1&query=T%C3%B6%C3%B6l%C3%B6nlahti%20Helsinki" else null,
                    actionLabel = if (kind == SuggestionKind.Walk) "Open in Google Maps" else null,
                )
            }
            s.copy(
                event = e,
                transcript = if (e.text != null && e.speaker != null) s.transcript + TranscriptLine(e.speaker, e.text) else s.transcript,
                outcome = e.outcome ?: s.outcome,
                offer = e.offer ?: s.offer,
                accepted = if (prepended.isNotEmpty()) false else s.accepted,
                suggestions = if (prepended.isNotEmpty()) prepended.map { it.copy(accepted = false) } + s.suggestions.map { it.copy(accepted = false) } else s.suggestions,
            )
        }
    }
}
