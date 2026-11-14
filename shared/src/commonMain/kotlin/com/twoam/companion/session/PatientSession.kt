package com.twoam.companion.session

import com.twoam.companion.core.model.PatientDoc
import com.twoam.companion.data.AuthGateway
import com.twoam.companion.data.PatientStore

/** The signed-in Patient and their record as it stood when the app started. */
data class StartedPatient(val patientId: String, val patient: PatientDoc)

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
    /** Returns the Patient and their record. Throws when sign-in, the read or the write fails; the caller offers a retry. */
    suspend fun start(): StartedPatient {
        val patientId = auth.currentUserId() ?: auth.signInAnonymously()
        val patient = patients.get(patientId)
            ?: PatientDoc(displayName = displayName, clinicianEmail = clinicianEmail).also { patients.create(patientId, it) }
        return StartedPatient(patientId, patient)
    }
}
