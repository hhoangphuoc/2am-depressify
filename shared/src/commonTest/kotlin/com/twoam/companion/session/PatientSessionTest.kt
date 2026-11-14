package com.twoam.companion.session

import com.twoam.companion.config.DemoConfig
import com.twoam.companion.core.model.FlagLevel
import com.twoam.companion.core.model.HealthSource
import com.twoam.companion.core.model.SharingConsent
import com.twoam.companion.fakes.FakeAuthGateway
import com.twoam.companion.fakes.FakePatientStore
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class PatientSessionTest {
    private val auth = FakeAuthGateway(newUid = "patient-1")
    private val store = FakePatientStore()
    private val clinician = DemoConfig.EMULATOR_CLINICIAN_EMAIL
    private val session = PatientSession(auth, store, clinician, DemoConfig.LIVE_PATIENT_DISPLAY_NAME)

    @Test
    fun firstOpenSignsInAnonymouslyAndCreatesThePatientLinkedToTheDemoClinician() = runTest {
        val started = session.start()

        assertEquals("patient-1", started.patientId)
        assertEquals(store.records.getValue("patient-1"), started.patient)
        assertEquals(1, auth.signInCalls)
        val record = store.records.getValue("patient-1")
        assertEquals(clinician, record.clinicianEmail)
        assertEquals(DemoConfig.LIVE_PATIENT_DISPLAY_NAME, record.displayName)
        assertEquals(FlagLevel.green, record.flagLevel)
        assertEquals(HealthSource.device, record.healthSource)
        assertEquals(SharingConsent.undecided, record.sharingConsent)
        assertFalse(record.synthetic)
        assertNull(record.lastSeenAtMillis)
    }

    @Test
    fun laterOpensReuseTheSignedInPatientAndDoNotRecreateTheRecord() = runTest {
        session.start()
        session.start()

        assertEquals(1, auth.signInCalls)
        assertEquals(1, store.creates)
    }

    @Test
    fun laterOpensReturnTheStoredRecordWithTheSharingDecision() = runTest {
        session.start()
        store.records["patient-1"] = store.records.getValue("patient-1").copy(sharingConsent = SharingConsent.declined)

        assertEquals(SharingConsent.declined, session.start().patient.sharingConsent)
    }

    @Test
    fun aSignedInPatientWithoutARecordGetsOneCreated() = runTest {
        auth.signedInUid = "returning"

        assertEquals("returning", session.start().patientId)
        assertEquals(0, auth.signInCalls)
        assertEquals(clinician, store.records.getValue("returning").clinicianEmail)
    }
}
