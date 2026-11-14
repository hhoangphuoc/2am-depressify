package app.depressify.shared.data

import app.depressify.core.model.Consent
import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent

class FakeAuthGateway(var signedInUid: String? = null, private val newUid: String = "patient-1") : AuthGateway {
    var failSignIn: Boolean = false
    var signInCalls: Int = 0
        private set

    override suspend fun currentUserId(): String? = signedInUid

    override suspend fun signInAnonymously(): String {
        signInCalls++
        if (failSignIn) throw IllegalStateException("network down")
        signedInUid = newUid
        return newUid
    }
}

/**
 * The Patient record and its Consents in memory. A sharing write updates the record and
 * `consents/sharing` together, like the Firestore transaction.
 */
class FakePatientStore(val consents: FakeConsentStore = FakeConsentStore()) : PatientStore {
    val records: MutableMap<String, PatientDoc> = mutableMapOf()
    var failSharingWrites: Boolean = false

    /** When set, a sharing write commits on the server even though the call throws (a lost reply). */
    var commitThenFail: Boolean = false
    var creates: Int = 0
        private set

    override suspend fun get(patientId: String): PatientDoc? = records[patientId]

    override suspend fun create(patientId: String, patient: PatientDoc) {
        creates++
        records[patientId] = patient
    }

    override suspend fun setSharingConsent(patientId: String, choice: SharingConsent, atMillis: Long) {
        if (failSharingWrites && !commitThenFail) throw IllegalStateException("UNAVAILABLE")
        records[patientId] = records.getValue(patientId).copy(sharingConsent = choice, sharingChangedAtMillis = atMillis)
        consents.stored.getOrPut(patientId) { mutableMapOf() }[ConsentPurpose.sharing.name] =
            Consent(ConsentPurpose.sharing.name, choice == SharingConsent.granted, atMillis)
        if (commitThenFail) throw IllegalStateException("DEADLINE_EXCEEDED")
    }
}

class FakeConsentStore : ConsentStore {
    /** patientId → subject → Consent. */
    val stored: MutableMap<String, MutableMap<String, Consent>> = mutableMapOf()

    override suspend fun get(patientId: String, subject: String): Consent? = stored[patientId]?.get(subject)

    override suspend fun set(patientId: String, consent: Consent) {
        stored.getOrPut(patientId) { mutableMapOf() }[consent.subject] = consent
    }
}
