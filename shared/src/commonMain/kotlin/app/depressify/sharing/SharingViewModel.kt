package app.depressify.sharing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.depressify.core.model.Consent
import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.SharingConsent
import app.depressify.data.ConsentStore
import app.depressify.data.PatientStore
import app.depressify.session.StartedPatient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Sharing Consent and the ratings and Voice cues Consents, for first use and Settings.
 *
 * Consent writes are never swallowed: the stored choice changes only once the server accepts the
 * write. A failed write re-reads what is really stored, shows that, and says why where the choice was
 * made. A ratings or Voice cues row with no stored Consent counts as included (the default).
 */
class SharingViewModel(
    started: StartedPatient,
    private val patients: PatientStore,
    private val consents: ConsentStore,
    private val nowMillis: () -> Long,
    private val saveTimeout: Duration = SAVE_TIMEOUT,
) : ViewModel() {
    private val patientId = started.patientId

    private val _state = MutableStateFlow(
        SharingState(clinicianEmail = started.patient.clinicianEmail, choice = started.patient.sharingConsent),
    )
    val state: StateFlow<SharingState> = _state.asStateFlow()

    init {
        loadPurposes()
    }

    fun onAction(action: SharingAction) {
        val current = _state.value
        when (action) {
            SharingAction.Continue -> _state.update { it.copy(firstUseStep = FirstUseStep.Choice) }
            is SharingAction.Choose -> when {
                // Leaving a granted state always goes through the confirmation.
                current.choice == SharingConsent.granted && action.choice == SharingConsent.declined ->
                    onAction(SharingAction.RequestWithdrawal)
                action.choice != SharingConsent.undecided -> save(action.choice)
            }
            SharingAction.RequestWithdrawal -> if (current.choice == SharingConsent.granted && !current.isSaving) {
                _state.update { it.copy(confirmingWithdrawal = true, error = null) }
            }
            SharingAction.CancelWithdrawal -> _state.update { it.copy(confirmingWithdrawal = false) }
            SharingAction.ConfirmWithdrawal -> if (current.confirmingWithdrawal) save(SharingConsent.declined)
            is SharingAction.SetIncluded -> setIncluded(action.purpose, action.included)
            SharingAction.RetryPurposes -> if (current.purposes is PurposesState.Failed) loadPurposes()
        }
    }

    private fun save(choice: SharingConsent) {
        val before = _state.value
        if (before.isSaving || before.choice == choice) return
        _state.update { it.copy(saving = choice, error = null, confirmingWithdrawal = false) }
        viewModelScope.launch {
            val saved = attempt { patients.setSharingConsent(patientId, choice, nowMillis()) }
            // After a failure, show what is really stored. If it can't be read either, the last
            // stored choice we know of still holds.
            val stored = if (saved) choice else readOrNull { patients.get(patientId)?.sharingConsent } ?: before.choice
            _state.update {
                it.copy(
                    choice = stored,
                    saving = null,
                    error = if (stored == choice) null else SharingCopy.saveFailed(stored, it.clinicianEmail),
                )
            }
        }
    }

    private fun setIncluded(purpose: ConsentPurpose, included: Boolean) {
        val loaded = _state.value.purposes as? PurposesState.Loaded ?: return
        val row = loaded.row(purpose)
        if (row.saving || row.included == included) return
        updateRow(row.copy(included = included, saving = true, error = null))
        viewModelScope.launch {
            val saved = attempt {
                consents.set(patientId, Consent(subject = purpose.name, granted = included, changedAtMillis = nowMillis()))
            }
            val stored = if (saved) included else readOrNull { includedFrom(consents.get(patientId, purpose.name)) } ?: row.included
            updateRow(
                PurposeRow(
                    purpose = purpose,
                    included = stored,
                    error = if (stored == included) null else SharingCopy.purposeSaveFailed(stored),
                ),
            )
        }
    }

    private fun updateRow(row: PurposeRow) {
        _state.update { state ->
            val loaded = state.purposes as? PurposesState.Loaded ?: return@update state
            state.copy(purposes = loaded.with(row))
        }
    }

    private fun loadPurposes() {
        _state.update { it.copy(purposes = PurposesState.Loading) }
        viewModelScope.launch {
            val loaded = readOrNull {
                PurposesState.Loaded(
                    ratings = PurposeRow(ConsentPurpose.ratings, includedFrom(consents.get(patientId, ConsentPurpose.ratings.name))),
                    voiceCues = PurposeRow(ConsentPurpose.voice_cues, includedFrom(consents.get(patientId, ConsentPurpose.voice_cues.name))),
                )
            }
            _state.update { it.copy(purposes = loaded ?: PurposesState.Failed(SharingCopy.PURPOSES_FAILED)) }
        }
    }

    /** Runs a write; false when it throws or the server does not answer in time. */
    private suspend fun attempt(write: suspend () -> Unit): Boolean = try {
        withTimeoutOrNull(saveTimeout) { write() } != null
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }

    private suspend fun <T> readOrNull(read: suspend () -> T): T? = try {
        withTimeoutOrNull(saveTimeout) { read() }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    companion object {
        /** How long a Consent write may take before it counts as failed. */
        val SAVE_TIMEOUT: Duration = 15.seconds

        /** No stored Consent means included: the rows let the Patient leave a purpose out. */
        fun includedFrom(consent: Consent?): Boolean = consent?.granted ?: true
    }
}
