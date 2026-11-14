package com.twoam.companion.data

import com.twoam.companion.core.model.Consent

/**
 * The Patient's Consents at `patients/{patientId}/consents/{subject}`, where subject is a Signal key
 * or a ConsentPurpose word. Sharing Consent is written through [PatientStore.setSharingConsent],
 * together with the record, and never through here.
 */
interface ConsentStore {
    /** The Consent for [subject], or null when the Patient has not chosen yet. Throws when it cannot be read. */
    suspend fun get(patientId: String, subject: String): Consent?

    /** Writes the Consent. Returns once the server has accepted it; throws when it fails. */
    suspend fun set(patientId: String, consent: Consent)
}
