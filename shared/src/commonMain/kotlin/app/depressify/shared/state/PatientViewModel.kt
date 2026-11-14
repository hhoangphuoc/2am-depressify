package app.depressify.shared.state

import androidx.compose.runtime.mutableStateListOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.depressify.core.BookingPlan
import app.depressify.core.Outcome
import app.depressify.core.QuietHours
import app.depressify.core.Ratings
import app.depressify.core.SignalId
import app.depressify.core.Summary
import app.depressify.core.SuggestionKind
import app.depressify.core.model.SharingConsent
import app.depressify.shared.data.PatientBackend
import app.depressify.shared.data.TodaySuggestions
import app.depressify.shared.voice.GeminiLiveSession
import app.depressify.shared.voice.LiveSession
import app.depressify.shared.voice.Reply
import app.depressify.shared.voice.ScriptedLiveSession
import app.depressify.shared.voice.Speaker
import app.depressify.shared.voice.TranscriptLine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

enum class ThemeMode(val label: String) { Auto("By time of day"), Day("Day"), Night("Night") }

enum class Scenario(val label: String) {
    Everyday("Everyday"), FirstUse("First use"), NoHistory("No history"), Offline("Offline"),
    MicDeclined("Microphone declined"), ConnectionLost("Connection lost"), SummaryFailure("Summary failure"),
    BaselineBuilding("Building a Baseline"), Crisis("Crisis notice"),
}

enum class Sheet { Demo, Booking, DeleteSignal, StopSharing, Dialler, Leave, MapsSources }

enum class FinishState { Idle, Saving, Failed }

/** Where today's Suggestions stand: [Demo] until a Patient is signed in, then the Suggest today call. */
enum class TodayLoad { Demo, Loading, Ready, Failed }

data class TypedCheckIn(
    val lines: List<TranscriptLine> = emptyList(),
    val offer: SuggestionKind? = null,
    val accepted: Boolean = false,
    val outcome: Outcome? = null,
    val offerDetails: String? = null,
)

data class PatientState(
    val displayName: String = DemoData.PatientName,
    val scenario: Scenario = Scenario.Everyday,
    val themeMode: ThemeMode = ThemeMode.Auto,
    val sharing: Boolean = true,
    val consents: Map<SignalId, Boolean> = DemoData.consents,
    val history: List<Summary> = DemoData.history,
    val quietHours: QuietHours = QuietHours.Default,
    val nudges: Boolean = true,
    val typed: Boolean = false,
    val typedCheckIn: TypedCheckIn = TypedCheckIn(),
    val ratingStep: Int = 0,
    val ratings: Ratings = Ratings(),
    val booking: BookingPlan? = null,
    val finish: FinishState = FinishState.Idle,
    val sheet: Sheet? = null,
    val selectedSignal: SignalId = SignalId.Sleep,
    val notice: String? = null,
    val todayLoad: TodayLoad = TodayLoad.Demo,
    val today: TodaySuggestions? = null,
) {
    val offline get() = scenario == Scenario.Offline
    val hasHistory get() = history.isNotEmpty()
}

/** Without a [backend], or while it cannot be reached, the app runs on local demo data only. */
class PatientViewModel(
    private val backend: PatientBackend? = null,
    private val nowMillis: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) : ViewModel() {
    private val state = MutableStateFlow(PatientState())
    val ui: StateFlow<PatientState> = state.asStateFlow()

    /** A real Gemini Live Check-in once a Patient is signed in; the scripted demo otherwise. */
    val live: LiveSession = ScriptedLiveSession(viewModelScope).let { script ->
        val checkIns = backend?.checkIns
        val client = backend?.live
        if (backend == null || checkIns == null || client == null) script
        else GeminiLiveSession(viewModelScope, backend.patients, checkIns, client, backend.audio, { patientId }, script, onCrisis = { open(Route.Crisis) }, nowMillis)
    }

    /** Navigation 3 back stack, owned here so it survives configuration changes. */
    val backStack = mutableStateListOf<Route>(Route.Today)

    /** The signed-in Patient once the backend has answered; null while the app runs on demo data. */
    private var patientId: String? = null

    init {
        if (backend != null) viewModelScope.launch { connect(backend) }
        // A typed live Check-in shows the same conversation as the spoken one.
        viewModelScope.launch {
            live.snapshot.collect { snap ->
                if (live.isLive) state.update {
                    it.copy(typedCheckIn = it.typedCheckIn.copy(lines = snap.transcript, offer = snap.offer, offerDetails = snap.offerDetails, accepted = snap.accepted))
                }
            }
        }
    }

    /** Signs in, makes sure the Patient record exists and shows the stored sharing choice. */
    private suspend fun connect(backend: PatientBackend) {
        // shortcut: when the backend can't be reached the app stays on demo data, so the sharing choice
        // shown is local and can differ from the stored one; block on a retry before real Patients use it.
        val started = attempt { backend.session.start() } ?: return
        patientId = started.patientId
        // shortcut: one sign of life per app start; the daily job (#26) should repeat it while the app runs.
        attempt { backend.patients.markSeen(started.patientId, nowMillis()) }
        val choice = started.patient.sharingConsent
        state.update { it.copy(sharing = choice == SharingConsent.granted, displayName = started.patient.displayName) }
        // First open: ask for the sharing choice, unless the Patient has already moved on from a tab root.
        if (choice == SharingConsent.undecided && backStack.size == 1) replaceAll(Route.Welcome)
        loadTodaySuggestions()
    }

    /** Asks Suggest today for the signed-in Patient's Suggestions; Today shows them, or a way to try again. */
    fun loadTodaySuggestions() {
        val id = patientId ?: return
        val checkIns = backend?.checkIns ?: return
        state.update { it.copy(todayLoad = TodayLoad.Loading) }
        viewModelScope.launch {
            val found = attempt(FINISH_TIMEOUT) { checkIns.suggestToday(id) }?.takeIf { it.suggestions.isNotEmpty() }
            state.update { it.copy(today = found, todayLoad = if (found != null) TodayLoad.Ready else TodayLoad.Failed) }
        }
    }

    /** Null when the backend throws or does not answer in time. */
    private suspend fun <T : Any> attempt(timeout: Duration = BACKEND_TIMEOUT, call: suspend () -> T?): T? = try {
        withTimeoutOrNull(timeout) { call() }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /**
     * Runs [onSaved] once the sharing choice is stored; on demo data that is at once. A failed save
     * changes nothing and says so, so the Patient never sees a choice that was not saved.
     */
    private fun saveSharing(share: Boolean, onSaved: () -> Unit) {
        val id = patientId
        if (backend == null || id == null) return onSaved()
        val choice = if (share) SharingConsent.granted else SharingConsent.declined
        state.update { it.copy(sheet = null, notice = "Saving your sharing choice…") }
        viewModelScope.launch {
            // A lost reply can hide a write that did commit, so a failure re-reads what is stored.
            val saved = attempt { backend.patients.setSharingConsent(id, choice, nowMillis()) } != null ||
                attempt { backend.patients.get(id) }?.sharingConsent == choice
            state.update { it.copy(notice = if (saved) null else "Your sharing choice could not be saved. Check your connection and try again.") }
            if (saved) onSaved()
        }
    }

    fun open(route: Route) { state.update { it.copy(notice = null) }; backStack.add(route) }
    fun back() { if (backStack.size > 1) backStack.removeAt(backStack.lastIndex) }
    fun selectTab(root: Route) { backStack.clear(); backStack.add(root) }
    private fun replaceAll(vararg routes: Route) { backStack.clear(); backStack.addAll(routes) }

    fun showSheet(sheet: Sheet?) = state.update { it.copy(sheet = sheet) }
    fun setNotice(text: String?) = state.update { it.copy(notice = text) }
    fun setThemeMode(mode: ThemeMode) = state.update { it.copy(themeMode = mode) }

    fun applyScenario(s: Scenario) {
        live.stop()
        // A signed-in Patient keeps their stored sharing choice; demo data starts from sharing on.
        state.update { PatientState(displayName = it.displayName, scenario = s, themeMode = it.themeMode, sharing = patientId == null || it.sharing, history = if (s == Scenario.NoHistory) emptyList() else DemoData.history, todayLoad = it.todayLoad, today = it.today) }
        when (s) {
            Scenario.FirstUse -> replaceAll(Route.Welcome)
            Scenario.MicDeclined -> replaceAll(Route.Today, Route.CheckInIntro)
            Scenario.ConnectionLost -> { replaceAll(Route.Today); startCheckIn(typed = false); live.setConnected(false) }
            Scenario.SummaryFailure -> replaceAll(Route.Today, Route.Finishing)
            Scenario.BaselineBuilding -> replaceAll(Route.Settings, Route.Signals)
            Scenario.Crisis -> replaceAll(Route.Today, Route.Crisis)
            else -> replaceAll(Route.Today)
        }
    }

    fun finishWelcome(share: Boolean) = saveSharing(share) { state.update { it.copy(sharing = share) }; replaceAll(Route.Today) }

    /** Leaves the welcome without recording a sharing choice. On demo data, sharing shows as on. */
    fun exploreDemo() { if (patientId == null) state.update { it.copy(sharing = true) }; replaceAll(Route.Today) }

    fun beginCheckIn(typed: Boolean) {
        if (state.value.offline) { setNotice("Connect to the internet to begin a Check-in."); return }
        state.update { it.copy(typed = typed) }
        open(Route.CheckInIntro)
    }

    fun startCheckIn(typed: Boolean) {
        val returning = state.value.hasHistory
        state.update {
            it.copy(
                typed = typed, ratings = Ratings(), ratingStep = 0, booking = null, finish = FinishState.Idle,
                typedCheckIn = TypedCheckIn(lines = listOf(TranscriptLine(Speaker.Companion,
                    if (returning) "It’s good to hear from you. Did you try the walk?" else "You can take your time. How are you feeling today?"))),
            )
        }
        live.start(returning, typed)
        if (typed) live.setMuted(true)
        open(Route.CheckIn)
    }

    fun setTyped(typed: Boolean) { state.update { it.copy(typed = typed) }; live.setMuted(typed) }

    fun typedOutcome(outcome: Outcome, said: String) = if (live.isLive) {
        live.sendText(said)
        state.update { it.copy(typedCheckIn = it.typedCheckIn.copy(outcome = outcome)) }
    } else state.update {
        it.copy(typedCheckIn = it.typedCheckIn.copy(
            outcome = outcome,
            lines = it.typedCheckIn.lines + TranscriptLine(Speaker.You, said) + TranscriptLine(Speaker.Companion, "Would a little time outside feel right tomorrow?"),
            offer = SuggestionKind.Walk,
        ))
    }

    fun typedFeeling(v: Int) = state.update { it.copy(typedCheckIn = it.typedCheckIn.copy(outcome = Outcome.Tried(v))) }

    fun sendTyped(text: String) {
        if (text.isBlank()) return
        if (live.isLive) return live.sendText(text.trim())
        state.update {
            it.copy(typedCheckIn = it.typedCheckIn.copy(
                lines = it.typedCheckIn.lines + TranscriptLine(Speaker.You, text.trim()) + TranscriptLine(Speaker.Companion, "Thank you for sharing. We can keep the next step small."),
                offer = it.typedCheckIn.offer ?: SuggestionKind.Walk,
            ))
        }
    }

    fun reply(reply: Reply) {
        if (state.value.typed && !live.isLive) {
            when (reply) {
                Reply.Accept -> state.update { it.copy(typedCheckIn = it.typedCheckIn.copy(accepted = true, lines = it.typedCheckIn.lines + TranscriptLine(Speaker.You, "That works for me."))) }
                Reply.Smaller -> state.update { it.copy(typedCheckIn = it.typedCheckIn.copy(offer = SuggestionKind.Window)) }
                Reply.Decline -> finishCheckIn()
            }
        } else live.respond(reply)
    }

    fun finishCheckIn() {
        live.stop()
        val ratingsOn = state.value.consents[SignalId.Ratings] == true
        if (ratingsOn) { state.update { it.copy(ratingStep = 0) }; open(Route.Ratings) } else open(Route.Finishing)
    }

    fun leaveCheckIn() { live.stop(); state.update { it.copy(sheet = null) }; replaceAll(Route.Today) }

    fun rate(value: Int?) = state.update {
        val r = it.ratings
        it.copy(ratings = when (it.ratingStep) { 0 -> r.copy(mood = value); 1 -> r.copy(energy = value); else -> r.copy(sleepQuality = value) })
    }

    fun nextRating() { if (state.value.ratingStep < 2) state.update { it.copy(ratingStep = it.ratingStep + 1) } else open(Route.Finishing) }
    fun previousRating() = state.update { it.copy(ratingStep = (it.ratingStep - 1).coerceAtLeast(0)) }

    fun makeSummary() {
        state.update { it.copy(finish = FinishState.Saving) }
        viewModelScope.launch {
            if (live.isLive) return@launch makeLiveSummary()
            delay(700)
            val s = state.value
            if (s.scenario == Scenario.SummaryFailure) { state.update { it.copy(finish = FinishState.Failed) }; return@launch }
            val snap = live.snapshot.value
            val accepted = if (s.typed) s.typedCheckIn.accepted else snap.accepted
            val kind = if (s.typed) s.typedCheckIn.offer else snap.offer
            val chosen = if (accepted) kind else null
            val summary = Summary(
                id = "demo-" + s.history.size, date = "13 November",
                title = chosen?.title ?: "A moment to check in",
                text = if (chosen == SuggestionKind.Walk) DemoData.SharedSummary
                else if (chosen != null) "You made space for a Check-in. You chose " + chosen.title.lowercase() + " as your next small step."
                else "You made space for a Check-in. No Suggestion was chosen this time.",
                ratings = if (s.consents[SignalId.Ratings] == true) s.ratings else Ratings(),
                suggestion = chosen,
                previousOutcome = if (s.typed) s.typedCheckIn.outcome else snap.outcome,
                voiceObservation = if (!s.typed && s.consents[SignalId.VoiceObservations] == true) "Long pauses" else null,
            )
            state.update { it.copy(history = listOf(summary) + it.history, finish = FinishState.Idle) }
            replaceAll(Route.Today, Route.Summary(summary.id))
        }
    }

    fun retrySummary() { state.update { it.copy(scenario = Scenario.Everyday) }; makeSummary() }

    /** A live Check-in's Summary comes from Finish Check-in. A failure offers the retry, which reuses the Check-in. */
    private suspend fun makeLiveSummary() {
        val s = state.value
        val r = s.ratings
        val ratingsLine = if (s.consents[SignalId.Ratings] != true) null
        else "My ratings on the screen: mood " + (r.mood ?: "skipped") + ", energy " + (r.energy ?: "skipped") + ", sleep quality " + (r.sleepQuality ?: "skipped") + ", each from 1 to 5."
        val saved = attempt(FINISH_TIMEOUT) { live.finish(ratingsLine) }
        if (saved == null) { state.update { it.copy(finish = FinishState.Failed) }; return }
        val snap = live.snapshot.value
        val rating = { value: Int? -> value?.takeIf { it in 1..5 } }
        val today = Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault()).date
        val summary = Summary(
            id = saved.checkInId,
            date = today.day.toString() + " " + today.month.name.lowercase().replaceFirstChar { it.uppercase() },
            title = saved.suggestion ?: "A moment to check in",
            text = (saved.themes + saved.sleepLine).filter { it.isNotBlank() }.joinToString(". ").ifEmpty { "You made space for a Check-in." },
            ratings = Ratings(rating(saved.mood), rating(saved.energy), rating(saved.sleepQuality)),
            suggestion = snap.offer.takeIf { snap.accepted },
            previousOutcome = null,
            voiceObservation = saved.voiceCues.firstOrNull()?.label,
        )
        state.update { it.copy(history = listOf(summary) + it.history.filterNot { h -> h.id == summary.id }, finish = FinishState.Idle) }
        replaceAll(Route.Today, Route.Summary(summary.id))
    }

    fun book(plan: BookingPlan) { state.update { it.copy(booking = plan, sheet = null, notice = "Added to your demo calendar.") } }

    fun selectSignal(id: SignalId) { state.update { it.copy(selectedSignal = id) }; open(Route.Signal(id)) }

    fun allowSignal(id: SignalId) = state.update { it.copy(consents = it.consents + (id to true), notice = "Consent saved in this demo. No device permission was requested.") }

    fun stopAndDelete(id: SignalId) = state.update {
        it.copy(
            consents = it.consents + (id to false), sheet = null, notice = id.label + " is off. Demo data removed.",
            history = if (id == SignalId.Ratings) it.history.map { h -> h.copy(ratings = Ratings()) } else it.history,
        )
    }

    fun saveQuietHours(q: QuietHours): Boolean {
        if (!q.isValid) return false
        state.update { it.copy(quietHours = q, notice = "Quiet hours saved.") }
        return true
    }

    fun setNudges(on: Boolean) = state.update { it.copy(nudges = on, notice = if (on) "Nudges on. At most one a day." else "Nudges off.") }

    fun setSharing(on: Boolean) = saveSharing(on) {
        state.update { it.copy(sharing = on, sheet = null, notice = if (on) "Sharing turned on for future progress." else "Sharing stopped. Your Clinician no longer sees new progress.") }
    }

    fun keepTalkingAfterCrisis() {
        state.update { it.copy(scenario = Scenario.Everyday, typed = true, typedCheckIn = TypedCheckIn(lines = listOf(TranscriptLine(Speaker.Companion, "I’m here while you choose human support.")))) }
        live.stop()
        open(Route.CheckIn)
    }

    private companion object {
        /** How long sign-in or a Consent write may take before it counts as failed. */
        val BACKEND_TIMEOUT = 15.seconds

        /** Finish Check-in and Suggest today wait on the text model, which the functions give 40 seconds. */
        val FINISH_TIMEOUT = 60.seconds
    }
}
