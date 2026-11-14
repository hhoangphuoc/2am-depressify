package com.twoam.companion.shell

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import com.twoam.companion.history.HistoryCopy
import com.twoam.companion.core.model.SharingConsent
import com.twoam.companion.sharing.SharingCopy
import com.twoam.companion.sharing.SharingState
import com.twoam.companion.today.TodayCopy
import com.twoam.companion.ui.theme.SmallStepTheme
import com.twoam.companion.ui.theme.SmallStepTokens
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
