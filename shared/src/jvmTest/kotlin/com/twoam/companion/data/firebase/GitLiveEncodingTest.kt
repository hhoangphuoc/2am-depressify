package com.twoam.companion.data.firebase

import com.twoam.companion.core.model.FirestoreJson
import com.twoam.companion.core.model.PatientDoc
import dev.gitlive.firebase.internal.encode
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The app writes through the GitLive SDK's own encoder, not FirestoreJson. This checks the two agree
 * for the Patient record: every field present, nulls explicit, enumerations as lower-case words.
 */
class GitLiveEncodingTest {
    @Test
    fun gitLiveWritesThePatientRecordExactlyLikeTheContract() {
        val patient = PatientDoc(displayName = "Live patient", clinicianEmail = "clinician@example.com")

        @Suppress("UNCHECKED_CAST")
        val written = encode(PatientDoc.serializer(), patient) { encodeDefaults = true } as Map<String, Any?>
        val contract = FirestoreJson.encode(PatientDoc.serializer(), patient)

        assertEquals(contract.keys, written.keys)
        for ((key, value) in contract) {
            assertEquals(value?.toString(), written[key]?.toString(), "field $key")
        }
    }
}
