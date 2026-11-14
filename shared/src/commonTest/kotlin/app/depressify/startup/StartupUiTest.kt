package app.depressify.startup

import androidx.compose.material3.Text
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import app.depressify.core.model.PatientDoc
import app.depressify.session.StartedPatient
import app.depressify.ui.theme.SmallStepTheme
import app.depressify.ui.theme.SmallStepTokens
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
            val started = StartedPatient("p1", PatientDoc(displayName = "Live patient", clinicianEmail = "c@example.com"))
            SmallStepTheme { StartupSurface(StartupState.Ready(started), onAction = {}) { Text("ready ${it.patientId}") } }
        }

        onNodeWithText("ready p1").assertIsDisplayed()
    }
}
