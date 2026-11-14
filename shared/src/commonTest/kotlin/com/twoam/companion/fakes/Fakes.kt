package com.twoam.companion.fakes

import com.twoam.companion.core.model.PatientDoc
import com.twoam.companion.data.AuthGateway
import com.twoam.companion.data.PatientStore

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

class FakePatientStore : PatientStore {
    val records: MutableMap<String, PatientDoc> = mutableMapOf()
    var failReads: Boolean = false
    var creates: Int = 0
        private set

    override suspend fun exists(patientId: String): Boolean {
        if (failReads) throw IllegalStateException("offline")
        return patientId in records
    }

    override suspend fun create(patientId: String, patient: PatientDoc) {
        creates++
        records[patientId] = patient
    }
}
