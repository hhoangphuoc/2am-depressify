package app.depressify.shared.sharing

import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.SharingConsent

/**
 * Sharing Consent and the purpose Consents (ratings, Voice cues), as stored for the Patient. The
 * app state ([app.depressify.shared.state.PatientViewModel]) shows them in first use (the welcome
 * and the sharing choice), in Sharing & privacy and on the ratings and Voice observations Signals.
 *
 * [choice] is always the stored decision, never an optimistic one: it changes only after the server
 * accepts the write, or when a failed write is followed by re-reading what is really stored.
 */
data class SharingState(
    /** The linked Clinician, shown by email until the Invite brings a name. */
    val clinicianEmail: String,
    val choice: SharingConsent,
    /** The decision being saved, or null. Both choices are disabled while it is set. */
    val saving: SharingConsent? = null,
    /** Vetted copy after a failed save, shown where the choice was made. */
    val error: String? = null,
    /** Settings is asking the Patient to confirm a withdrawal. */
    val confirmingWithdrawal: Boolean = false,
    val purposes: PurposesState = PurposesState.Loading,
) {
    /** First use (the welcome and the sharing choice) shows until the Patient has decided. */
    val inFirstUse: Boolean get() = choice == SharingConsent.undecided

    val isSaving: Boolean get() = saving != null
}

/** The ratings and Voice cues rows. Separate from sharing and from every Signal Consent. */
sealed interface PurposesState {
    data object Loading : PurposesState

    /** The stored choices could not be read. [message] is vetted copy. */
    data class Failed(val message: String) : PurposesState

    data class Loaded(val ratings: PurposeRow, val voiceCues: PurposeRow) : PurposesState {
        fun row(purpose: ConsentPurpose): PurposeRow = if (purpose == ConsentPurpose.voice_cues) voiceCues else ratings

        fun with(row: PurposeRow): Loaded =
            if (row.purpose == ConsentPurpose.voice_cues) copy(voiceCues = row) else copy(ratings = row)
    }
}

/**
 * One purpose row. [included] is true when the purpose is part of future Check-ins. While [saving],
 * it shows the value being saved; a failed save puts back what is really stored and sets [error].
 */
data class PurposeRow(
    val purpose: ConsentPurpose,
    val included: Boolean,
    val saving: Boolean = false,
    val error: String? = null,
)

sealed interface SharingAction {
    /** Share (granted) or Don't share (declined) in first use, or Share again in Settings. */
    data class Choose(val choice: SharingConsent) : SharingAction

    /** Settings: Stop sharing. Asks for confirmation first. */
    data object RequestWithdrawal : SharingAction

    data object ConfirmWithdrawal : SharingAction

    data object CancelWithdrawal : SharingAction

    data class SetIncluded(val purpose: ConsentPurpose, val included: Boolean) : SharingAction

    data object RetryPurposes : SharingAction
}
