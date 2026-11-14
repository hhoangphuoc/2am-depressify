package app.depressify.shared.data

import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent

/** The Patient record at `patients/{patientId}`. */
interface PatientStore {
    /** The Patient record, or null when it does not exist. Throws when it cannot be read. */
    suspend fun get(patientId: String): PatientDoc?

    /** Writes a new Patient record. Throws when the write fails. */
    suspend fun create(patientId: String, patient: PatientDoc)

    /**
     * Records the Patient's sharing decision ([choice] is granted or declined): `sharingConsent` and
     * `sharingChangedAtMillis` on the record and the `consents/sharing` document, together or not at
     * all. Returns only once the server has accepted the write; throws when it fails, so the caller
     * never assumes a decision that was not saved.
     */
    suspend fun setSharingConsent(patientId: String, choice: SharingConsent, atMillis: Long)
}
