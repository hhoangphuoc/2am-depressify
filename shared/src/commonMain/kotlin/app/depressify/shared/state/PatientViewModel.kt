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
import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.SharingConsent
import app.depressify.shared.session.PatientBackend
import app.depressify.shared.session.PatientStartup
import app.depressify.shared.session.StartedPatient
import app.depressify.shared.session.StartupState
import app.depressify.shared.sharing.PurposesState
import app.depressify.shared.sharing.SharingAction
import app.depressify.shared.sharing.SharingController
import app.depressify.shared.sharing.SharingState
import app.depressify.shared.voice.LiveSession
import app.depressify.shared.voice.Reply
import app.depressify.shared.voice.ScriptedLiveSession
import app.depressify.shared.voice.Speaker
import app.depressify.shared.voice.TranscriptLine
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ThemeMode(val label: String) { Auto("By time of day"), Day("Day"), Night("Night") }

enum class Scenario(val label: String) {
    Everyday("Everyday"), FirstUse("First use"), NoHistory("No history"), Offline("Offline"),
    MicDeclined("Microphone declined"), ConnectionLost("Connection lost"), SummaryFailure("Summary failure"),
    BaselineBuilding("Building a Baseline"), Crisis("Crisis notice"),
}

enum class Sheet { Demo, Booking, DeleteSignal, StopSharing, Dialler, Leave, MapsSources }

enum class FinishState { Idle, Saving, Failed }

data class TypedCheckIn(
    val lines: List<TranscriptLine> = emptyList(),
    val offer: SuggestionKind? = null,
    val accepted: Boolean = false,
    val outcome: Outcome? = null,
)

data class PatientState(
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
) {
    val offline get() = scenario == Scenario.Offline
    val hasHistory get() = history.isNotEmpty()
}

/**
 * The Patient app's state. With a [backend] (the app as installed), start-up signs the Patient in and
 * creates their record, and the sharing choice and the ratings and Voice observations Consents are
 * saved through it. Everything else still runs on [DemoData]. Without one (previews, tests) the
 * whole app runs on [DemoData].
 */
class PatientViewModel(private val backend: PatientBackend? = null) : ViewModel() {
    private val state = MutableStateFlow(PatientState())
    val ui: StateFlow<PatientState> = state.asStateFlow()

    val live: LiveSession = ScriptedLiveSession(viewModelScope)

    /** Navigation 3 back stack, owned here so it survives configuration changes. */
    val backStack = mutableStateListOf<Route>(Route.Today)

    fun open(route: Route) { state.update { it.copy(notice = null) }; backStack.add(route) }
    fun back() { if (backStack.size > 1) backStack.removeAt(backStack.lastIndex) }
    fun selectTab(root: Route) { backStack.clear(); backStack.add(root) }
    private fun replaceAll(vararg routes: Route) { backStack.clear(); backStack.addAll(routes) }

    fun showSheet(sheet: Sheet?) = state.update { it.copy(sheet = sheet) }
    fun setNotice(text: String?) = state.update { it.copy(notice = text) }
    fun setThemeMode(mode: ThemeMode) = state.update { it.copy(themeMode = mode) }

    fun applyScenario(s: Scenario) {
        live.stop()
        state.update { PatientState(scenario = s, themeMode = it.themeMode, history = if (s == Scenario.NoHistory) emptyList() else DemoData.history) }
        sharingController?.let { mirror(it.state.value, quiet = true) } // keep what the backend has stored
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

    fun finishWelcome(share: Boolean) {
        val controller = sharingController
        when {
            controller == null -> state.update { it.copy(sharing = share) }
            // Only the sharing choice records a decision; the welcome's "Explore the demo" showed none.
            backStack.lastOrNull() == Route.Sharing -> choose(controller, share)
            else -> mirror(controller.state.value, quiet = true)
        }
        replaceAll(Route.Today)
    }

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
        live.start(returning)
        if (typed) live.setMuted(true)
        open(Route.CheckIn)
    }

    fun setTyped(typed: Boolean) { state.update { it.copy(typed = typed) }; live.setMuted(typed) }

    fun typedOutcome(outcome: Outcome, said: String) = state.update {
        it.copy(typedCheckIn = it.typedCheckIn.copy(
            outcome = outcome,
            lines = it.typedCheckIn.lines + TranscriptLine(Speaker.You, said) + TranscriptLine(Speaker.Companion, "Would a little time outside feel right tomorrow?"),
            offer = SuggestionKind.Walk,
        ))
    }

    fun typedFeeling(v: Int) = state.update { it.copy(typedCheckIn = it.typedCheckIn.copy(outcome = Outcome.Tried(v))) }

    fun sendTyped(text: String) {
        if (text.isBlank()) return
        state.update {
            it.copy(typedCheckIn = it.typedCheckIn.copy(
                lines = it.typedCheckIn.lines + TranscriptLine(Speaker.You, text.trim()) + TranscriptLine(Speaker.Companion, "Thank you for sharing. We can keep the next step small."),
                offer = it.typedCheckIn.offer ?: SuggestionKind.Walk,
            ))
        }
    }

    fun reply(reply: Reply) {
        if (state.value.typed) {
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

    fun book(plan: BookingPlan) { state.update { it.copy(booking = plan, sheet = null, notice = "Added to your demo calendar.") } }

    fun selectSignal(id: SignalId) { state.update { it.copy(selectedSignal = id) }; open(Route.Signal(id)) }

    fun allowSignal(id: SignalId) {
        state.update { it.copy(consents = it.consents + (id to true), notice = "Consent saved in this demo. No device permission was requested.") }
        savePurpose(id, included = true)
    }

    fun stopAndDelete(id: SignalId) {
        state.update {
            it.copy(
                consents = it.consents + (id to false), sheet = null, notice = id.label + " is off. Demo data removed.",
                history = if (id == SignalId.Ratings) it.history.map { h -> h.copy(ratings = Ratings()) } else it.history,
            )
        }
        savePurpose(id, included = false)
    }

    fun saveQuietHours(q: QuietHours): Boolean {
        if (!q.isValid) return false
        state.update { it.copy(quietHours = q, notice = "Quiet hours saved.") }
        return true
    }

    fun setNudges(on: Boolean) = state.update { it.copy(nudges = on, notice = if (on) "Nudges on. At most one a day." else "Nudges off.") }

    fun setSharing(on: Boolean) {
        val controller = sharingController
        if (controller == null) { state.update { it.copy(sharing = on, sheet = null, notice = sharingNotice(on)) }; return }
        // Saved through the backend: the switch and the notice change once the server accepts the choice.
        state.update { it.copy(sheet = null) }
        val current = controller.state.value
        if (current.saving == null && current.choice == sharingChoice(on)) { setNotice(sharingNotice(on)); return }
        sharingNoticePending = true
        choose(controller, on)
    }

    private fun sharingNotice(on: Boolean) =
        if (on) "Sharing turned on for future progress." else "Sharing stopped. Your Clinician no longer sees new progress."

    fun keepTalkingAfterCrisis() {
        state.update { it.copy(scenario = Scenario.Everyday, typed = true, typedCheckIn = TypedCheckIn(lines = listOf(TranscriptLine(Speaker.Companion, "I’m here while you choose human support.")))) }
        live.stop()
        open(Route.CheckIn)
    }

    // ---- Backend: start-up, the sharing choice and the purpose Consents ---------------------------

    private val startup: PatientStartup? = backend?.let { PatientStartup(it.session, viewModelScope) }

    /**
     * Sign-in and the Patient record. [StartupState.Disabled] without a backend; otherwise Starting,
     * then Ready, or Failed with vetted copy and [retryStartup]. No screen shows it yet.
     */
    val startupState: StateFlow<StartupState> = startup?.state ?: MutableStateFlow(StartupState.Disabled).asStateFlow()

    /** Starts the backend again after [StartupState.Failed]. */
    fun retryStartup() { startup?.retry() }

    /** Saves the sharing and purpose Consents once start-up is Ready; null until then and without a backend. */
    private var sharingController: SharingController? = null
    private var sharingNoticePending = false
    private var lastSharingError: String? = null
    private val lastPurposeErrors = mutableMapOf<ConsentPurpose, String?>()

    init {
        if (backend != null && startup != null) {
            viewModelScope.launch {
                startup.state.collect { if (it is StartupState.Ready && sharingController == null) onStarted(it.started, backend) }
            }
            startup.start()
        }
    }

    private fun onStarted(started: StartedPatient, backend: PatientBackend) {
        val controller = SharingController(started, backend.patients, backend.consents, backend.nowMillis, viewModelScope)
        sharingController = controller
        mirror(controller.state.value, quiet = true)
        viewModelScope.launch { controller.state.collect { mirror(it, quiet = false) } }
        // The welcome and the sharing choice show while sharing is undecided (docs/firestore-schema.md, Sharing Consent).
        if (started.patient.sharingConsent == SharingConsent.undecided && state.value.scenario == Scenario.Everyday &&
            backStack.toList() == listOf(Route.Today)
        ) {
            replaceAll(Route.Welcome)
        }
    }

    /** Shows what the backend has stored: sharing, and the ratings and Voice observations Signals. Failures become the notice. */
    private fun mirror(stored: SharingState, quiet: Boolean) {
        var notice: String? = null
        if (!quiet) {
            if (sharingNoticePending && stored.saving == null) {
                sharingNoticePending = false
                notice = stored.error ?: sharingNotice(stored.choice == SharingConsent.granted)
            } else if (stored.error != null && stored.error != lastSharingError) {
                notice = stored.error
            }
            (stored.purposes as? PurposesState.Loaded)?.let { loaded ->
                listOf(loaded.ratings, loaded.voiceCues).forEach { row ->
                    if (row.error != null && row.error != lastPurposeErrors[row.purpose]) notice = row.error
                    lastPurposeErrors[row.purpose] = row.error
                }
            }
        }
        lastSharingError = stored.error
        state.update { s ->
            val loaded = stored.purposes as? PurposesState.Loaded
            s.copy(
                sharing = stored.choice == SharingConsent.granted,
                consents = if (loaded == null) s.consents else s.consents +
                    (SignalId.Ratings to loaded.ratings.included) + (SignalId.VoiceObservations to loaded.voiceCues.included),
                notice = notice ?: s.notice,
            )
        }
    }

    private fun savePurpose(id: SignalId, included: Boolean) {
        val purpose = when (id) {
            SignalId.Ratings -> ConsentPurpose.ratings
            SignalId.VoiceObservations -> ConsentPurpose.voice_cues
            else -> return // device Signal Consents stay local until Signals are collected (#19)
        }
        sharingController?.onAction(SharingAction.SetIncluded(purpose, included))
    }

    private fun sharingChoice(on: Boolean) = if (on) SharingConsent.granted else SharingConsent.declined

    /** The app's own sheet has already confirmed a withdrawal, so it is confirmed here too. */
    private fun choose(controller: SharingController, on: Boolean) {
        controller.onAction(SharingAction.Choose(sharingChoice(on)))
        if (controller.state.value.confirmingWithdrawal) controller.onAction(SharingAction.ConfirmWithdrawal)
    }
}
