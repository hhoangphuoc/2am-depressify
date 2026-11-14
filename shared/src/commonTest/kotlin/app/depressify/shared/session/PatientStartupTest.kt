package app.depressify.shared.session

import app.depressify.shared.config.DemoConfig
import app.depressify.core.model.PatientDoc
import app.depressify.shared.fakes.FakeAuthGateway
import app.depressify.shared.fakes.FakePatientStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class PatientStartupTest {
    private val dispatcher = StandardTestDispatcher()
    private val auth = FakeAuthGateway(newUid = "patient-1")
    private val store = FakePatientStore()

    private fun startup() = PatientStartup(
        PatientSession(auth, store, DemoConfig.EMULATOR_CLINICIAN_EMAIL, "Live patient"),
        CoroutineScope(dispatcher),
    ).also { it.start() }

    private val ready = StartupState.Ready(
        StartedPatient("patient-1", PatientDoc(displayName = "Live patient", clinicianEmail = DemoConfig.EMULATOR_CLINICIAN_EMAIL)),
    )

    @Test
    fun startsInStartingThenBecomesReadyWithThePatientId() = runTest(dispatcher) {
        val startup = startup()
        assertEquals(StartupState.Starting, startup.state.value)

        advanceUntilIdle()

        assertEquals(ready, startup.state.value)
    }

    @Test
    fun aFailedStartupShowsVettedCopyNotTheRawError() = runTest(dispatcher) {
        auth.failSignIn = true
        val startup = startup()
        advanceUntilIdle()

        val failed = assertIs<StartupState.Failed>(startup.state.value)
        assertEquals(StartupCopy.FAILED, failed.message)
        assertFalse(failed.message.contains("secret-internal-detail"))
    }

    @Test
    fun retryAfterAFailureRecovers() = runTest(dispatcher) {
        store.failReads = true
        val startup = startup()
        advanceUntilIdle()
        assertIs<StartupState.Failed>(startup.state.value)

        store.failReads = false
        startup.retry()
        assertEquals(StartupState.Starting, startup.state.value)
        advanceUntilIdle()

        assertEquals(ready, startup.state.value)
        assertTrue(store.records.containsKey("patient-1"))
    }

    @Test
    fun retryDoesNothingUnlessStartupFailed() = runTest(dispatcher) {
        val startup = startup()
        advanceUntilIdle()

        startup.retry()

        assertEquals(ready, startup.state.value)
        assertEquals(1, auth.signInCalls)
    }
}
