package app.depressify.shared.data

import app.depressify.core.model.PatientDoc

/** The signed-in Patient and their record as it stood when the app started. */
data class StartedPatient(val patientId: String, val patient: PatientDoc)

/**
 * Starts the Patient's session: signs in anonymously on first open (or reuses the existing user)
 * and makes sure the Patient record exists, linked to the demo Clinician. V1 has one Clinician; the
 * security rules accept the link only if the email is in the `clinicians` allowlist.
 */
class PatientSession(
    private val auth: AuthGateway,
    private val patients: PatientStore,
    clinicianEmail: String,
    private val displayName: String = LIVE_PATIENT_DISPLAY_NAME,
) {
    /** Trimmed and lower case, as the Clinician's sign-in token carries it. */
    private val clinicianEmail = clinicianEmail.trim().lowercase()

    /** Returns the Patient and their record. Throws when sign-in, the read or the write fails. */
    suspend fun start(): StartedPatient {
        val patientId = auth.currentUserId() ?: auth.signInAnonymously()
        val patient = patients.get(patientId)
            ?: PatientDoc(displayName = displayName, clinicianEmail = clinicianEmail).also { patients.create(patientId, it) }
        return StartedPatient(patientId, patient)
    }

    companion object {
        /** Display name of the Patient created on the demo phone. The Clinician can rename them. */
        const val LIVE_PATIENT_DISPLAY_NAME: String = "Live patient"
    }
}

/** What the Patient app reaches Firebase through. The app runs on demo data without one. */
class PatientBackend(val session: PatientSession, val patients: PatientStore, val consents: ConsentStore)
