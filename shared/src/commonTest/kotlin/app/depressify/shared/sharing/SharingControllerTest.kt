package app.depressify.shared.sharing

import app.depressify.core.model.Consent
import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import app.depressify.shared.fakes.FakeConsentStore
import app.depressify.shared.fakes.FakePatientStore
import app.depressify.shared.session.StartedPatient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class SharingControllerTest {
    private val dispatcher = StandardTestDispatcher()
    private val consents = FakeConsentStore()
    private val patients = FakePatientStore(consents)
    private val clinician = "clinician@example.com"
    private val now = 1_763_000_000_000L

    private fun controller(sharing: SharingConsent = SharingConsent.undecided): SharingController {
        val record = PatientDoc(displayName = "Live patient", clinicianEmail = clinician, sharingConsent = sharing)
        patients.records["p1"] = record
        return SharingController(
            StartedPatient("p1", record), patients, consents, nowMillis = { now }, scope = CoroutineScope(dispatcher), saveTimeout = 5.seconds,
        )
    }

    private fun stored() = patients.records.getValue("p1")

    // ---- The sharing choice ------------------------------------------------------------------------------

    @Test
    fun anUndecidedPatientIsInFirstUseWithTheirClinicianNamed() = runTest(dispatcher) {
        val state = controller().state.value

        assertTrue(state.inFirstUse)
        assertEquals(clinician, state.clinicianEmail)
    }

    @Test
    fun sharingSavesTheRecordAndTheSharingConsentThenLeavesFirstUse() = runTest(dispatcher) {
        val vm = controller()
        vm.onAction(SharingAction.Choose(SharingConsent.granted))
        assertEquals(SharingConsent.granted, vm.state.value.saving)
        assertTrue(vm.state.value.inFirstUse) // not before the server accepts it

        advanceUntilIdle()

        assertEquals(SharingConsent.granted, vm.state.value.choice)
        assertNull(vm.state.value.saving)
        assertNull(vm.state.value.error)
        assertFalse(vm.state.value.inFirstUse)
        assertEquals(SharingConsent.granted, stored().sharingConsent)
        assertEquals(now, stored().sharingChangedAtMillis)
        assertEquals(Consent("sharing", granted = true, changedAtMillis = now), consents.stored["p1"]?.get("sharing"))
    }

    @Test
    fun decliningTakesTheSameOneStepAndAlsoLeavesFirstUse() = runTest(dispatcher) {
        val vm = controller()
        vm.onAction(SharingAction.Choose(SharingConsent.declined))
        advanceUntilIdle()

        assertEquals(SharingConsent.declined, vm.state.value.choice)
        assertFalse(vm.state.value.inFirstUse)
        assertEquals(1, patients.sharingWrites)
        assertEquals(Consent("sharing", granted = false, changedAtMillis = now), consents.stored["p1"]?.get("sharing"))
    }

    @Test
    fun sharingConsentIsSeparateFromEveryOtherConsent() = runTest(dispatcher) {
        val vm = controller()
        advanceUntilIdle()
        vm.onAction(SharingAction.Choose(SharingConsent.granted))
        advanceUntilIdle()

        assertEquals(setOf("sharing"), consents.stored.getValue("p1").keys)
        assertTrue(consents.writes.isEmpty()) // no Signal, ratings or Voice cues Consent was written
    }

    @Test
    fun aFailedFirstUseSaveKeepsThePatientUndecidedAndSaysWhy() = runTest(dispatcher) {
        patients.failSharingWrites = true
        val vm = controller()
        vm.onAction(SharingAction.Choose(SharingConsent.granted))
        advanceUntilIdle()

        val state = vm.state.value
        assertEquals(SharingConsent.undecided, state.choice)
        assertTrue(state.inFirstUse)
        assertNull(state.saving)
        assertEquals(SharingCopy.saveFailed(SharingConsent.undecided, clinician), state.error)
        assertFalse(state.error!!.contains("secret-internal-detail"))
        assertEquals(SharingConsent.undecided, stored().sharingConsent)
    }

    @Test
    fun aWriteThatNeverAnswersCountsAsFailed() = runTest(dispatcher) {
        val vm = controller()
        patients.sharingGate = CompletableDeferred() // never completed: the server never answers
        vm.onAction(SharingAction.Choose(SharingConsent.granted))
        runCurrent()
        assertEquals(SharingConsent.granted, vm.state.value.saving)

        advanceUntilIdle() // the 5 s timeout passes in virtual time

        assertEquals(SharingConsent.undecided, vm.state.value.choice)
        assertNotNull(vm.state.value.error)
    }

    @Test
    fun aFailureAfterTheServerCommittedShowsTheSavedChoiceWithoutAnError() = runTest(dispatcher) {
        patients.failSharingWrites = true
        patients.commitThenFail = true
        val vm = controller()
        vm.onAction(SharingAction.Choose(SharingConsent.declined))
        advanceUntilIdle()

        assertEquals(SharingConsent.declined, vm.state.value.choice)
        assertNull(vm.state.value.error)
    }

    @Test
    fun aSecondChoiceWhileSavingIsIgnored() = runTest(dispatcher) {
        val gate = CompletableDeferred<Unit>()
        patients.sharingGate = gate
        val vm = controller()
        vm.onAction(SharingAction.Choose(SharingConsent.granted))
        runCurrent()
        vm.onAction(SharingAction.Choose(SharingConsent.declined))
        gate.complete(Unit)
        advanceUntilIdle()

        assertEquals(1, patients.sharingWrites)
        assertEquals(SharingConsent.granted, vm.state.value.choice)
    }

    // ---- Settings: withdraw and share again -----------------------------------------------------

    @Test
    fun withdrawingAsksForConfirmationBeforeAnythingIsWritten() = runTest(dispatcher) {
        val vm = controller(SharingConsent.granted)
        vm.onAction(SharingAction.RequestWithdrawal)
        advanceUntilIdle()

        assertTrue(vm.state.value.confirmingWithdrawal)
        assertEquals(0, patients.sharingWrites)

        vm.onAction(SharingAction.ConfirmWithdrawal)
        advanceUntilIdle()

        assertEquals(SharingConsent.declined, vm.state.value.choice)
        assertFalse(vm.state.value.confirmingWithdrawal)
        assertEquals(SharingConsent.declined, stored().sharingConsent)
    }

    @Test
    fun choosingDeclineWhileSharingAlsoGoesThroughTheConfirmation() = runTest(dispatcher) {
        val vm = controller(SharingConsent.granted)
        vm.onAction(SharingAction.Choose(SharingConsent.declined))
        advanceUntilIdle()

        assertTrue(vm.state.value.confirmingWithdrawal)
        assertEquals(0, patients.sharingWrites)
    }

    @Test
    fun cancellingAWithdrawalChangesNothing() = runTest(dispatcher) {
        val vm = controller(SharingConsent.granted)
        vm.onAction(SharingAction.RequestWithdrawal)
        vm.onAction(SharingAction.CancelWithdrawal)
        vm.onAction(SharingAction.ConfirmWithdrawal) // no longer confirming: ignored
        advanceUntilIdle()

        assertEquals(SharingConsent.granted, vm.state.value.choice)
        assertFalse(vm.state.value.confirmingWithdrawal)
        assertEquals(0, patients.sharingWrites)
    }

    @Test
    fun aFailedWithdrawalRestoresTheRealStateAndSaysTheClinicianStillSees() = runTest(dispatcher) {
        patients.failSharingWrites = true
        val vm = controller(SharingConsent.granted)
        vm.onAction(SharingAction.RequestWithdrawal)
        vm.onAction(SharingAction.ConfirmWithdrawal)
        advanceUntilIdle()

        assertEquals(SharingConsent.granted, vm.state.value.choice)
        assertEquals(SharingCopy.saveFailed(SharingConsent.granted, clinician), vm.state.value.error)
    }

    @Test
    fun aFailedSaveWhoseReReadAlsoFailsKeepsTheLastStoredChoice() = runTest(dispatcher) {
        patients.failSharingWrites = true
        val vm = controller(SharingConsent.declined)
        patients.failReads = true
        vm.onAction(SharingAction.Choose(SharingConsent.granted))
        advanceUntilIdle()

        assertEquals(SharingConsent.declined, vm.state.value.choice)
        assertEquals(SharingCopy.saveFailed(SharingConsent.declined, clinician), vm.state.value.error)
    }

    @Test
    fun sharingAgainAfterDecliningSavesGrantedWithTheNewTime() = runTest(dispatcher) {
        val vm = controller(SharingConsent.declined)
        vm.onAction(SharingAction.Choose(SharingConsent.granted))
        advanceUntilIdle()

        assertEquals(SharingConsent.granted, vm.state.value.choice)
        assertEquals(now, stored().sharingChangedAtMillis)
        assertTrue(consents.stored.getValue("p1").getValue("sharing").granted)
    }

    @Test
    fun aDecisionThatIsAlreadyStoredIsNotWrittenAgain() = runTest(dispatcher) {
        val vm = controller(SharingConsent.declined)
        vm.onAction(SharingAction.Choose(SharingConsent.declined))
        vm.onAction(SharingAction.Choose(SharingConsent.undecided))
        advanceUntilIdle()

        assertEquals(0, patients.sharingWrites)
    }

    // ---- Ratings and Voice cues ----------------------------------------------------------------

    @Test
    fun ratingsAndVoiceCuesAreIncludedUntilThePatientLeavesThemOut() = runTest(dispatcher) {
        consents.stored["p1"] = mutableMapOf("voice_cues" to Consent("voice_cues", granted = false, changedAtMillis = 1))
        val vm = controller(SharingConsent.granted)
        assertEquals(PurposesState.Loading, vm.state.value.purposes)
        advanceUntilIdle()

        val loaded = assertIs<PurposesState.Loaded>(vm.state.value.purposes)
        assertTrue(loaded.ratings.included)
        assertFalse(loaded.voiceCues.included)
    }

    @Test
    fun leavingRatingsOutWritesItsOwnConsentAndNothingElse() = runTest(dispatcher) {
        val vm = controller(SharingConsent.granted)
        advanceUntilIdle()
        vm.onAction(SharingAction.SetIncluded(ConsentPurpose.ratings, false))
        assertTrue(assertIs<PurposesState.Loaded>(vm.state.value.purposes).ratings.saving)
        advanceUntilIdle()

        val loaded = assertIs<PurposesState.Loaded>(vm.state.value.purposes)
        assertEquals(PurposeRow(ConsentPurpose.ratings, included = false), loaded.ratings)
        assertEquals(listOf(Consent("ratings", granted = false, changedAtMillis = now)), consents.writes)
        assertEquals(SharingConsent.granted, stored().sharingConsent)
    }

    @Test
    fun aFailedRowSaveRestoresTheStoredValueAndSaysWhyOnThatRow() = runTest(dispatcher) {
        consents.failWrites = true
        val vm = controller(SharingConsent.granted)
        advanceUntilIdle()
        vm.onAction(SharingAction.SetIncluded(ConsentPurpose.voice_cues, false))
        advanceUntilIdle()

        val loaded = assertIs<PurposesState.Loaded>(vm.state.value.purposes)
        assertTrue(loaded.voiceCues.included)
        assertFalse(loaded.voiceCues.saving)
        assertEquals(SharingCopy.purposeSaveFailed(true), loaded.voiceCues.error)
        assertNull(loaded.ratings.error)
        assertNull(vm.state.value.error) // the sharing choice shows nothing
    }

    @Test
    fun aFailedLoadOffersARetry() = runTest(dispatcher) {
        consents.failReads = true
        val vm = controller(SharingConsent.granted)
        advanceUntilIdle()
        assertEquals(PurposesState.Failed(SharingCopy.PURPOSES_FAILED), vm.state.value.purposes)

        consents.failReads = false
        vm.onAction(SharingAction.RetryPurposes)
        advanceUntilIdle()

        assertIs<PurposesState.Loaded>(vm.state.value.purposes)
    }

    @Test
    fun aMissingConsentCountsAsIncluded() {
        assertTrue(SharingController.includedFrom(null))
        assertFalse(SharingController.includedFrom(Consent("ratings", granted = false, changedAtMillis = 1)))
    }
}
