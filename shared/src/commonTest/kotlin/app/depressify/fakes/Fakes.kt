package app.depressify.fakes

import app.depressify.core.model.Consent
import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import app.depressify.data.AuthGateway
import app.depressify.data.ConsentStore
import app.depressify.data.PatientStore
import kotlinx.coroutines.CompletableDeferred

class FakeAuthGateway(var signedInUid: String? = null, private val newUid: String = "uid-1") : AuthGateway {
    var failSignIn: Boolean = false
    var signInCalls: Int = 0
        private set

    override suspend fun currentUserId(): String? = signedInUid

    override suspend fun signInAnonymously(): String {
        signInCalls++
        if (failSignIn) throw IllegalStateException("network down: secret-internal-detail")
        signedInUid = newUid
        return newUid
    }
}

/**
 * The Patient record and its Consents in memory. A sharing write updates the record and
 * `consents/sharing` together, like the Firestore transaction. Set [failSharingWrites] or
 * [failReads] to simulate a server that cannot be reached, and [sharingGate] to hold a write open.
 */
class FakePatientStore(val consents: FakeConsentStore = FakeConsentStore()) : PatientStore {
    val records: MutableMap<String, PatientDoc> = mutableMapOf()
    var failReads: Boolean = false
    var failSharingWrites: Boolean = false

    /** When set, a sharing write commits on the server even though the call throws (a lost reply). */
    var commitThenFail: Boolean = false
    var sharingGate: CompletableDeferred<Unit>? = null
    var creates: Int = 0
        private set
    var sharingWrites: Int = 0
        private set

    override suspend fun get(patientId: String): PatientDoc? {
        if (failReads) throw IllegalStateException("offline")
        return records[patientId]
    }

    override suspend fun create(patientId: String, patient: PatientDoc) {
        creates++
        records[patientId] = patient
    }

    override suspend fun setSharingConsent(patientId: String, choice: SharingConsent, atMillis: Long) {
        sharingWrites++
        sharingGate?.await()
        if (failSharingWrites && !commitThenFail) throw IllegalStateException("UNAVAILABLE: secret-internal-detail")
        records[patientId] = records.getValue(patientId).copy(sharingConsent = choice, sharingChangedAtMillis = atMillis)
        consents.stored.getOrPut(patientId) { mutableMapOf() }[ConsentPurpose.sharing.name] =
            Consent(ConsentPurpose.sharing.name, choice == SharingConsent.granted, atMillis)
        if (commitThenFail) throw IllegalStateException("DEADLINE_EXCEEDED")
    }
}

class FakeConsentStore : ConsentStore {
    /** patientId → subject → Consent. */
    val stored: MutableMap<String, MutableMap<String, Consent>> = mutableMapOf()
    var failReads: Boolean = false
    var failWrites: Boolean = false
    val writes: MutableList<Consent> = mutableListOf()

    override suspend fun get(patientId: String, subject: String): Consent? {
        if (failReads) throw IllegalStateException("offline")
        return stored[patientId]?.get(subject)
    }

    override suspend fun set(patientId: String, consent: Consent) {
        writes += consent
        if (failWrites) throw IllegalStateException("UNAVAILABLE")
        stored.getOrPut(patientId) { mutableMapOf() }[consent.subject] = consent
    }
}
