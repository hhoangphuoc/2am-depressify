package com.twoam.companion.session

import com.twoam.companion.core.model.PatientDoc
import com.twoam.companion.data.AuthGateway
import com.twoam.companion.data.PatientStore

/**
 * Starts the Patient's session: signs in anonymously on first open (or reuses the existing user)
 * and makes sure the Patient record exists, linked to the demo Clinician.
 */
class PatientSession(
    private val auth: AuthGateway,
    private val patients: PatientStore,
    private val clinicianEmail: String,
    private val displayName: String,
) {
    /** Returns the Patient id. Throws when sign-in or the record write fails; the caller offers a retry. */
    suspend fun start(): String {
        val patientId = auth.currentUserId() ?: auth.signInAnonymously()
        if (!patients.exists(patientId)) {
            patients.create(patientId, PatientDoc(displayName = displayName, clinicianEmail = clinicianEmail))
        }
        return patientId
    }
}
