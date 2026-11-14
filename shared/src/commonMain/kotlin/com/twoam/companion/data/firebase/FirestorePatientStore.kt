package com.twoam.companion.data.firebase

import com.twoam.companion.core.model.Collections
import com.twoam.companion.core.model.Consent
import com.twoam.companion.core.model.ConsentPurpose
import com.twoam.companion.core.model.PatientDoc
import com.twoam.companion.core.model.SharingConsent
import com.twoam.companion.data.PatientStore
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
}
