package app.depressify.shared.state

import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.SharingConsent
import app.depressify.shared.data.FakeAuthGateway
import app.depressify.shared.data.FakePatientStore
import app.depressify.shared.data.PatientBackend
import app.depressify.shared.data.PatientSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Sign-in and the sharing Consent behind main's Patient screens, with fakes for Firebase. */
@OptIn(ExperimentalCoroutinesApi::class)
class PatientViewModelBackendTest {
    private val auth = FakeAuthGateway()
    private val store = FakePatientStore()
    private val backend = PatientBackend(PatientSession(auth, store, "clinician@example.com"), store, store.consents)
    private val stored get() = store.records.getValue("patient-1")

    @BeforeTest
    fun setMain() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterTest
    fun resetMain() = Dispatchers.resetMain()

    @Test
    fun withoutABackendTheAppRunsOnDemoData() {
        val vm = PatientViewModel()

        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())
        vm.setSharing(false)
        assertFalse(vm.ui.value.sharing)
    }

    @Test
    fun firstOpenCreatesThePatientAndAsksForTheSharingChoice() {
        val vm = PatientViewModel(backend, nowMillis = { 42 })

        assertEquals(SharingConsent.undecided, stored.sharingConsent)
        assertEquals(listOf<Route>(Route.Welcome), vm.backStack.toList())
        assertFalse(vm.ui.value.sharing)

        vm.finishWelcome(share = true)

        assertEquals(SharingConsent.granted, stored.sharingConsent)
        assertEquals(42, stored.sharingChangedAtMillis)
        assertTrue(store.consents.stored.getValue("patient-1").getValue(ConsentPurpose.sharing.name).granted)
        assertTrue(vm.ui.value.sharing)
        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())
    }

    @Test
    fun aLaterOpenShowsTheStoredChoiceWithoutTheWelcome() {
        PatientViewModel(backend).finishWelcome(share = false)

        val vm = PatientViewModel(backend)

        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())
        assertFalse(vm.ui.value.sharing)
    }

    @Test
    fun exploringTheDemoRecordsNoSharingChoice() {
        val vm = PatientViewModel(backend)

        vm.exploreDemo()

        assertEquals(SharingConsent.undecided, stored.sharingConsent)
        assertFalse(vm.ui.value.sharing)
        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())
    }

    @Test
    fun aFailedSaveKeepsTheStoredChoiceAndSaysSo() {
        val vm = PatientViewModel(backend)
        vm.finishWelcome(share = true)
        store.failSharingWrites = true

        vm.setSharing(false)

        assertEquals(SharingConsent.granted, stored.sharingConsent)
        assertTrue(vm.ui.value.sharing)
        assertNotNull(vm.ui.value.notice)
    }

    @Test
    fun aWriteThatCommittedBehindALostReplyCountsAsSaved() {
        val vm = PatientViewModel(backend)
        vm.finishWelcome(share = true)
        store.failSharingWrites = true
        store.commitThenFail = true

        vm.setSharing(false)

        assertEquals(SharingConsent.declined, stored.sharingConsent)
        assertFalse(vm.ui.value.sharing)
    }

    @Test
    fun anUnreachableBackendLeavesThePrototypeOnDemoData() {
        auth.failSignIn = true

        val vm = PatientViewModel(backend)

        assertEquals(listOf<Route>(Route.Today), vm.backStack.toList())
        assertTrue(vm.ui.value.sharing)
        assertNull(vm.ui.value.notice)
        vm.setSharing(false)
        assertFalse(vm.ui.value.sharing)
        assertTrue(store.records.isEmpty())
    }
}
