package com.twoam.companion.data.firebase

import com.twoam.companion.core.model.Collections
import com.twoam.companion.core.model.PatientDoc
import com.twoam.companion.data.PatientStore
import dev.gitlive.firebase.firestore.FirebaseFirestore

/** The Patient record in Firestore through the GitLive SDK. Defaults and nulls are written explicitly. */
class FirestorePatientStore(private val db: FirebaseFirestore) : PatientStore {
    private fun patient(patientId: String) = db.collection(Collections.PATIENTS).document(patientId)

    override suspend fun exists(patientId: String): Boolean = patient(patientId).get().exists

    override suspend fun create(patientId: String, patient: PatientDoc) {
        patient(patientId).set(PatientDoc.serializer(), patient) { encodeDefaults = true }
    }
}
