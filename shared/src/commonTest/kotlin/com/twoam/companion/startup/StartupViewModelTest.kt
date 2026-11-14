package com.twoam.companion.startup

import com.twoam.companion.fakes.FakeAuthGateway
import com.twoam.companion.fakes.FakePatientStore
import com.twoam.companion.session.PatientSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class StartupViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val auth = FakeAuthGateway(newUid = "patient-1")
    private val store = FakePatientStore()

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel() = StartupViewModel(PatientSession(auth, store, "clinician@example.com", "Live patient"))

    @Test
    fun startsInStartingThenBecomesReadyWithThePatientId() = runTest(dispatcher) {
        val vm = viewModel()
        assertEquals(StartupState.Starting, vm.state.value)

        advanceUntilIdle()

        assertEquals(StartupState.Ready("patient-1"), vm.state.value)
    }

    @Test
    fun aFailedStartupShowsVettedCopyNotTheRawError() = runTest(dispatcher) {
        auth.failSignIn = true
        val vm = viewModel()
        advanceUntilIdle()

        val failed = assertIs<StartupState.Failed>(vm.state.value)
        assertEquals(StartupCopy.FAILED, failed.message)
        assertFalse(failed.message.contains("secret-internal-detail"))
    }

    @Test
    fun retryAfterAFailureRecovers() = runTest(dispatcher) {
        store.failReads = true
        val vm = viewModel()
        advanceUntilIdle()
        assertIs<StartupState.Failed>(vm.state.value)

        store.failReads = false
        vm.onAction(StartupAction.Retry)
        assertEquals(StartupState.Starting, vm.state.value)
        advanceUntilIdle()

        assertEquals(StartupState.Ready("patient-1"), vm.state.value)
        assertTrue(store.records.containsKey("patient-1"))
    }
}
