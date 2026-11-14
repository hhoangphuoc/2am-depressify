package app.depressify.shared.state

import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.SharingConsent
import app.depressify.core.model.SuggestionKind
import app.depressify.shared.data.FakeAuthGateway
import app.depressify.shared.data.FakeCheckInGateway
import app.depressify.shared.data.FakePatientStore
import app.depressify.shared.data.PatientBackend
import app.depressify.shared.data.PatientSession
import app.depressify.shared.data.TodaySuggestion
import app.depressify.shared.data.TodaySuggestions
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

        assertEquals(stored.displayName, vm.ui.value.displayName)
        assertEquals(SharingConsent.undecided, stored.sharingConsent)
        assertEquals(listOf<Route>(Route.Welcome), vm.backStack.toList())
        assertFalse(vm.ui.value.sharing)
        // Opening the app is a sign of life, so the silence check does not flag a phone that is in use.
        assertEquals(42, stored.lastSeenAtMillis)

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

    @Test
    fun aSignedInPatientGetsTodaysSuggestionsAndCanRetryAfterAFailure() {
        val checkIns = FakeCheckInGateway()
        val vm = PatientViewModel(PatientBackend(PatientSession(auth, store, "clinician@example.com"), store, store.consents, checkIns))

        // Suggest today failed: Today offers the retry and keeps the demo places out.
        assertEquals(TodayLoad.Failed, vm.ui.value.todayLoad)
        assertNull(vm.ui.value.today)

        checkIns.today = TodaySuggestions(suggestions = listOf(TodaySuggestion(SuggestionKind.walk, "Ten minutes by the water.")))
        vm.loadTodaySuggestions()

        assertEquals(TodayLoad.Ready, vm.ui.value.todayLoad)
        assertEquals(checkIns.today, vm.ui.value.today)
    }

    @Test
    fun historyUsesThePatientsStoredRecordsAndOnlyTheLastSevenCalendarDays() {
        val checkIns = FakeCheckInGateway().apply {
            summaries = listOf(app.depressify.core.model.Summary("aino-1", 1794564000000, 2, null, null, "Broken sleep", listOf("A quieter week"), emptyList(), null, null, emptyList(), true))
            days = listOf("2026-11-14", "2026-11-08", "2026-11-07").map {
                app.depressify.core.model.DailyDoc.of(it, mapOf(app.depressify.core.model.Signal.STEPS to 1200.0), emptyMap(), null, true)
            }
        }
        val vm = PatientViewModel(PatientBackend(PatientSession(auth, store, "clinician@example.com"), store, store.consents, checkIns), nowMillis = { 1794650400000 })

        assertEquals(HistoryLoad.Ready, vm.ui.value.historyLoad)
        assertEquals(listOf("aino-1"), vm.ui.value.history.map { it.id })
        assertEquals(2, vm.ui.value.history.single().ratings.mood)
        assertEquals(listOf("2026-11-14", "2026-11-08"), vm.ui.value.historyDays.map { it.date })
        checkIns.failReads = true
        vm.loadHistory()
        assertEquals(HistoryLoad.Failed, vm.ui.value.historyLoad)
        assertEquals(listOf("aino-1"), vm.ui.value.history.map { it.id })
        checkIns.failReads = false
        checkIns.summaries = emptyList()
        checkIns.days = emptyList()
        vm.loadHistory()
        assertEquals(HistoryLoad.Ready, vm.ui.value.historyLoad)
        assertTrue(vm.ui.value.history.isEmpty())
        assertTrue(vm.ui.value.historyDays.isEmpty())
    }

    @Test
    fun withoutASignedInPatientTodayStaysOnDemoPlaces() {
        assertEquals(TodayLoad.Demo, PatientViewModel().ui.value.todayLoad)
        assertEquals(TodayLoad.Demo, PatientViewModel(backend).ui.value.todayLoad)
    }
}
