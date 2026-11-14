package app.depressify.shared.data.firebase

import app.depressify.core.model.Collections
import app.depressify.core.model.Consent
import app.depressify.shared.data.ConsentStore
import dev.gitlive.firebase.firestore.FirebaseFirestore

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
