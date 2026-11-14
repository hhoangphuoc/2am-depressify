package com.twoam.companion.startup

import androidx.compose.material3.Text
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import com.twoam.companion.ui.theme.SmallStepTheme
import com.twoam.companion.ui.theme.SmallStepTokens
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalTestApi::class)
class StartupUiTest {
    @Test
    fun aFailedStartupShowsTheMessageAndARetry() = runComposeUiTest {
        val actions = mutableListOf<StartupAction>()
        setContent {
            SmallStepTheme {
                StartupSurface(StartupState.Failed(StartupCopy.FAILED), onAction = { actions += it }) { Text("ready") }
            }
        }

        onNodeWithText(StartupCopy.FAILED).assertIsDisplayed()
        onNodeWithText(StartupCopy.RETRY)
            .assertIsDisplayed()
            .assertHeightIsAtLeast(SmallStepTokens.Size.MinTouchTarget)
            .performClick()

        assertEquals(listOf<StartupAction>(StartupAction.Retry), actions)
    }

    @Test
    fun readyShowsTheAppContent() = runComposeUiTest {
        setContent {
            SmallStepTheme { StartupSurface(StartupState.Ready("p1"), onAction = {}) { id -> Text("ready $id") } }
        }

        onNodeWithText("ready p1").assertIsDisplayed()
    }
}
