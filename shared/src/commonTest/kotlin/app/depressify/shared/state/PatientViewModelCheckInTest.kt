package app.depressify.shared.state

import app.depressify.core.Ratings
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

private class MemoryPreferences : DevicePreferences {
    val values = mutableMapOf<String, String>()
    override fun read(key: String) = values[key]
    override fun write(key: String, value: String) { values[key] = value }
}

/** The Patient's own steps through a demo Check-in, and choices kept on the phone. */
@OptIn(ExperimentalCoroutinesApi::class)
class PatientViewModelCheckInTest {
    private val main = StandardTestDispatcher()

    @BeforeTest
    fun setMain() = Dispatchers.setMain(main)

    @AfterTest
    fun resetMain() = Dispatchers.resetMain()

    @Test
    fun finishAsksForTheThreeRatingsAnyOfWhichCanBeSkippedBeforeTheSummary() = runTest(main) {
        val vm = PatientViewModel()
        vm.startCheckIn(typed = true)

        vm.finishCheckIn()
        assertEquals(Route.Ratings, vm.backStack.last())
        vm.rate(4)
        vm.nextRating()
        vm.rate(null)
        vm.nextRating()
        vm.previousRating()
        vm.rate(2)
        vm.nextRating()
        vm.nextRating()
        assertEquals(Route.Finishing, vm.backStack.last())
        advanceUntilIdle()

        assertEquals(Ratings(4, 2, null), vm.ui.value.history.first().ratings)
        assertEquals(Route.Summary(vm.ui.value.history.first().id), vm.backStack.last())
    }

    @Test
    fun theAppearanceTheyChooseIsKeptForTheNextLaunch() {
        val preferences = MemoryPreferences()
        assertEquals(ThemeMode.Auto, PatientViewModel(preferences = preferences).ui.value.themeMode)

        PatientViewModel(preferences = preferences).setThemeMode(ThemeMode.Day)

        assertEquals(ThemeMode.Day, PatientViewModel(preferences = preferences).ui.value.themeMode)
    }
}
