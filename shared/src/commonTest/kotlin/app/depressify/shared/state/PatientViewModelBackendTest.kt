package app.depressify.shared.state

import app.depressify.core.SignalId
import app.depressify.core.model.Consent
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import app.depressify.shared.config.DemoConfig
import app.depressify.shared.fakes.FakeAuthGateway
import app.depressify.shared.fakes.FakeConsentStore
import app.depressify.shared.fakes.FakePatientStore
import app.depressify.shared.session.PatientBackend
import app.depressify.shared.session.PatientSession
import app.depressify.shared.session.StartupCopy
import app.depressify.shared.session.StartupState
import app.depressify.shared.sharing.SharingCopy
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

/** The app start and the Patient's choices reach the backend through the app state (fakes, no Firebase). */
@OptIn(ExperimentalCoroutinesApi::class)
class PatientViewModelBackendTest {
    private val dispatcher = StandardTestDispatcher()
    private val auth = FakeAuthGateway(newUid = "patient-1")
    private val consents = FakeConsentStore()
    private val patients = FakePatientStore(consents)
    private val clinician = DemoConfig.EMULATOR_CLINICIAN_EMAIL
    private val now = 1_763_000_000_000L

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    private fun backend() = PatientBackend(
        session = PatientSession(auth, patients, clinician, DemoConfig.LIVE_PATIENT_DISPLAY_NAME),
        patients = patients,
        consents = consents,
        nowMillis = { now },
    )

    /** A Patient who opened the app before and chose [sharing]. */
    private fun returning(sharing: SharingConsent) {
        auth.signedInUid = "patient-1"
        patients.records["patient-1"] = PatientDoc(displayName = "Live patient", clinicianEmail = clinician, sharingConsent = sharing)
    }

    @Test
    fun withoutABackendTheAppRunsOnDemoDataOnly() = runTest(dispatcher) {
        val vm = PatientViewModel()
        advanceUntilIdle()

        assertEquals(StartupState.Disabled, vm.startupState.value)
        assertTrue(vm.ui.value.sharing)
        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())

        vm.setSharing(false)
        assertFalse(vm.ui.value.sharing)
    }

    @Test
    fun appStartSignsInAndCreatesThePatientLinkedToTheClinician() = runTest(dispatcher) {
        val vm = PatientViewModel(backend())
        assertEquals(StartupState.Starting, vm.startupState.value)

        advanceUntilIdle()

        val ready = assertIs<StartupState.Ready>(vm.startupState.value)
        assertEquals("patient-1", ready.started.patientId)
        assertEquals(1, auth.signInCalls)
        assertEquals(clinician, patients.records.getValue("patient-1").clinicianEmail)
    }

    @Test
    fun aFailedStartOffersARetryAndTheDemoKeepsWorking() = runTest(dispatcher) {
        auth.failSignIn = true
        val vm = PatientViewModel(backend())
        advanceUntilIdle()

        assertEquals(StartupState.Failed(StartupCopy.FAILED), vm.startupState.value)
        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())

        auth.failSignIn = false
        vm.retryStartup()
        advanceUntilIdle()

        assertIs<StartupState.Ready>(vm.startupState.value)
    }

    @Test
    fun aNewPatientSeesTheWelcomeAndTheSharingChoiceSavesTheirDecision() = runTest(dispatcher) {
        val vm = PatientViewModel(backend())
        advanceUntilIdle()
        assertEquals(listOf<Route>(Route.Welcome), vm.backStack.toList())
        assertFalse(vm.ui.value.sharing) // undecided: nothing is shared

        vm.open(Route.Sharing)
        vm.finishWelcome(share = true)
        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())
        advanceUntilIdle()

        assertEquals(SharingConsent.granted, patients.records.getValue("patient-1").sharingConsent)
        assertEquals(Consent("sharing", granted = true, changedAtMillis = now), consents.stored["patient-1"]?.get("sharing"))
        assertTrue(vm.ui.value.sharing)
    }

    @Test
    fun continuingWithoutSharingSavesDeclined() = runTest(dispatcher) {
        val vm = PatientViewModel(backend())
        advanceUntilIdle()

        vm.open(Route.Sharing)
        vm.finishWelcome(share = false)
        advanceUntilIdle()

        assertEquals(SharingConsent.declined, patients.records.getValue("patient-1").sharingConsent)
        assertFalse(vm.ui.value.sharing)
    }

    @Test
    fun exploringTheDemoFromTheWelcomeRecordsNoDecision() = runTest(dispatcher) {
        val vm = PatientViewModel(backend())
        advanceUntilIdle()

        vm.finishWelcome(share = true)
        advanceUntilIdle()

        assertEquals(0, patients.sharingWrites)
        assertEquals(SharingConsent.undecided, patients.records.getValue("patient-1").sharingConsent)
        assertFalse(vm.ui.value.sharing)
    }

    @Test
    fun aReturningPatientWhoHasDecidedStartsOnTodayWithTheirStoredChoice() = runTest(dispatcher) {
        returning(SharingConsent.declined)
        val vm = PatientViewModel(backend())
        advanceUntilIdle()

        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())
        assertFalse(vm.ui.value.sharing)
        assertEquals(0, auth.signInCalls)
        assertEquals(0, patients.creates)
    }

    @Test
    fun stoppingSharingSavesDeclinedAndSaysSoOnlyOnceSaved() = runTest(dispatcher) {
        returning(SharingConsent.granted)
        val vm = PatientViewModel(backend())
        advanceUntilIdle()
        assertTrue(vm.ui.value.sharing)

        vm.showSheet(Sheet.StopSharing)
        vm.setSharing(false)
        assertEquals(null, vm.ui.value.sheet)
        assertTrue(vm.ui.value.sharing) // not before the server accepts it
        advanceUntilIdle()

        assertEquals(SharingConsent.declined, patients.records.getValue("patient-1").sharingConsent)
        assertFalse(vm.ui.value.sharing)
        assertEquals("Sharing stopped. Your Clinician no longer sees new progress.", vm.ui.value.notice)
    }

    @Test
    fun aFailedSharingSaveKeepsTheStoredChoiceAndSaysWhy() = runTest(dispatcher) {
        returning(SharingConsent.granted)
        patients.failSharingWrites = true
        val vm = PatientViewModel(backend())
        advanceUntilIdle()

        vm.setSharing(false)
        advanceUntilIdle()

        assertTrue(vm.ui.value.sharing)
        assertEquals(SharingCopy.saveFailed(SharingConsent.granted, clinician), vm.ui.value.notice)
    }

    @Test
    fun theRatingsAndVoiceObservationsSignalsSaveTheirConsents() = runTest(dispatcher) {
        returning(SharingConsent.granted)
        val vm = PatientViewModel(backend())
        advanceUntilIdle()

        vm.stopAndDelete(SignalId.Ratings)
        vm.stopAndDelete(SignalId.VoiceObservations)
        advanceUntilIdle()

        assertEquals(
            listOf(Consent("ratings", granted = false, changedAtMillis = now), Consent("voice_cues", granted = false, changedAtMillis = now)),
            consents.writes,
        )
        assertFalse(vm.ui.value.consents.getValue(SignalId.Ratings))
        assertFalse(vm.ui.value.consents.getValue(SignalId.VoiceObservations))
    }

    @Test
    fun deviceSignalConsentsStayLocal() = runTest(dispatcher) {
        returning(SharingConsent.granted)
        val vm = PatientViewModel(backend())
        advanceUntilIdle()

        vm.allowSignal(SignalId.HeartRate)
        advanceUntilIdle()

        assertTrue(consents.writes.isEmpty())
        assertTrue(vm.ui.value.consents.getValue(SignalId.HeartRate))
    }

    @Test
    fun aFailedPurposeSavePutsBackTheStoredValueAndSaysWhy() = runTest(dispatcher) {
        returning(SharingConsent.granted)
        consents.failWrites = true
        val vm = PatientViewModel(backend())
        advanceUntilIdle()

        vm.stopAndDelete(SignalId.VoiceObservations)
        advanceUntilIdle()

        assertTrue(vm.ui.value.consents.getValue(SignalId.VoiceObservations))
        assertEquals(SharingCopy.purposeSaveFailed(true), vm.ui.value.notice)
    }
}
