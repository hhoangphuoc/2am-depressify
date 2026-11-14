package app.depressify.shared.data.firebase

import app.depressify.core.model.Collections
import app.depressify.core.model.Consent
import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import app.depressify.shared.data.ConsentStore
import app.depressify.shared.data.PatientStore
import dev.gitlive.firebase.firestore.FirebaseFirestore

/** The Patient record in Firestore through the GitLive SDK. Defaults and nulls are written explicitly. */
class FirestorePatientStore(private val db: FirebaseFirestore) : PatientStore {
    private fun patient(patientId: String) = db.collection(Collections.PATIENTS).document(patientId)

    override suspend fun get(patientId: String): PatientDoc? {
        val snapshot = patient(patientId).get()
        return if (snapshot.exists) snapshot.data(PatientDoc.serializer()) else null
    }

    override suspend fun create(patientId: String, patient: PatientDoc) {
        patient(patientId).set(PatientDoc.serializer(), patient) { encodeDefaults = true }
    }

    override suspend fun setSharingConsent(patientId: String, choice: SharingConsent, atMillis: Long) {
        require(choice != SharingConsent.undecided) { "Sharing can only be granted or declined" }
        val record = patient(patientId)
        val consent = record.collection(Collections.CONSENTS).document(ConsentPurpose.sharing.name)
        // A transaction, not a batch: it fails when the server cannot be reached instead of being
        // queued offline, so a decision is never shown as saved before it is.
        db.runTransaction {
            updateFields(record) {
                "sharingConsent" to choice.name
                "sharingChangedAtMillis" to atMillis
            }
            set(
                consent,
                Consent.serializer(),
                Consent(subject = ConsentPurpose.sharing.name, granted = choice == SharingConsent.granted, changedAtMillis = atMillis),
            ) { encodeDefaults = true }
        }
    }

    override suspend fun markSeen(patientId: String, atMillis: Long) {
        patient(patientId).updateFields { "lastSeenAtMillis" to atMillis }
    }
}

/** Consents in Firestore through the GitLive SDK. */
class FirestoreConsentStore(private val db: FirebaseFirestore) : ConsentStore {
    private fun consent(patientId: String, subject: String) =
        db.collection(Collections.PATIENTS).document(patientId).collection(Collections.CONSENTS).document(subject)

    override suspend fun get(patientId: String, subject: String): Consent? {
        val snapshot = consent(patientId, subject).get()
        return if (snapshot.exists) snapshot.data(Consent.serializer()) else null
    }

    override suspend fun set(patientId: String, consent: Consent) {
        // A transaction for the same reason as sharing: fail when offline rather than queue.
        val ref = consent(patientId, consent.subject)
        db.runTransaction { set(ref, Consent.serializer(), consent) { encodeDefaults = true } }
    }
}
