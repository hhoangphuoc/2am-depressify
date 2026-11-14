package app.depressify.shell

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import app.depressify.history.HistoryCopy
import app.depressify.core.model.SharingConsent
import app.depressify.sharing.SharingCopy
import app.depressify.sharing.SharingState
import app.depressify.today.TodayCopy
import app.depressify.ui.theme.SmallStepTheme
import app.depressify.ui.theme.SmallStepTokens
import kotlin.test.Test

@OptIn(ExperimentalTestApi::class)
class AppShellUiTest {
    private val sharing = SharingState(clinicianEmail = "clinician@example.com", choice = SharingConsent.granted)

    @Test
    fun opensOnTodayWithThreeTabs() = runComposeUiTest {
        setContent { SmallStepTheme { AppShell(sharing, onSharingAction = {}) } }

        onNodeWithText(TodayCopy.EMPTY).assertIsDisplayed()
        onTab("Today").assertIsSelected()
        onTab("History").assertIsNotSelected()
        onTab("Settings").assertIsNotSelected()
    }

    @Test
    fun tabsSwitchBetweenTodayHistoryAndSettings() = runComposeUiTest {
        setContent { SmallStepTheme { AppShell(sharing, onSharingAction = {}) } }

        onTab("History").performClick()
        onNodeWithText(HistoryCopy.EMPTY).assertIsDisplayed()
        onTab("Settings").performClick()
        onNodeWithText(SharingCopy.SETTINGS_TITLE).assertIsDisplayed()
        onTab("Today").performClick()
        onNodeWithText(TodayCopy.EMPTY).assertIsDisplayed()
    }

    @Test
    fun everyTabMeetsTheMinimumTouchTarget() = runComposeUiTest {
        setContent { SmallStepTheme { AppShell(sharing, onSharingAction = {}) } }

        Destination.entries.forEach { onTab(it.label).assertHeightIsAtLeast(SmallStepTokens.Size.MinTouchTarget) }
    }

    private fun androidx.compose.ui.test.ComposeUiTest.onTab(label: String) =
        onNode(androidx.compose.ui.test.hasText(label) and androidx.compose.ui.test.isSelectable())
}
