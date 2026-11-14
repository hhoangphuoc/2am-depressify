package app.depressify.shared.data

import app.depressify.core.model.FlagLevel
import app.depressify.core.model.HealthSource
import app.depressify.core.model.SharingConsent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class PatientSessionTest {
    private val auth = FakeAuthGateway()
    private val store = FakePatientStore()
    private val session = PatientSession(auth, store, "  Clinician@Example.COM ")

    @Test
    fun firstOpenSignsInAnonymouslyAndCreatesThePatientLinkedToTheDemoClinician() = runTest {
        val started = session.start()

        assertEquals("patient-1", started.patientId)
        assertEquals(1, auth.signInCalls)
        val record = store.records.getValue("patient-1")
        assertEquals(record, started.patient)
        // Trimmed and lower case, as the Clinician's sign-in token carries it.
        assertEquals("clinician@example.com", record.clinicianEmail)
        assertEquals(PatientSession.LIVE_PATIENT_DISPLAY_NAME, record.displayName)
        assertEquals(FlagLevel.green, record.flagLevel)
        assertEquals(HealthSource.device, record.healthSource)
        assertEquals(SharingConsent.undecided, record.sharingConsent)
        assertFalse(record.synthetic)
        assertNull(record.lastSeenAtMillis)
    }

    @Test
    fun laterOpensReuseTheSignedInPatientAndDoNotRecreateTheRecord() = runTest {
        session.start()
        store.records["patient-1"] = store.records.getValue("patient-1").copy(sharingConsent = SharingConsent.declined)

        assertEquals(SharingConsent.declined, session.start().patient.sharingConsent)
        assertEquals(1, auth.signInCalls)
        assertEquals(1, store.creates)
    }

    @Test
    fun aSignedInPatientWithoutARecordGetsOneCreated() = runTest {
        auth.signedInUid = "returning"

        assertEquals("returning", session.start().patientId)
        assertEquals(0, auth.signInCalls)
        assertEquals("clinician@example.com", store.records.getValue("returning").clinicianEmail)
    }
}
