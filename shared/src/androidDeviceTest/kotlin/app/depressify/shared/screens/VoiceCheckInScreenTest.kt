package app.depressify.shared.screens

import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import app.depressify.shared.state.PatientState
import app.depressify.shared.state.PatientViewModel
import app.depressify.shared.ui.theme.DepressifyTheme
import app.depressify.shared.voice.LiveSnapshot
import app.depressify.shared.voice.live.MusicPlayback
import app.depressify.shared.voice.live.ToolCard
import app.depressify.shared.voice.live.createClipPlayer
import kotlin.test.Test

@OptIn(ExperimentalTestApi::class)
class VoiceCheckInScreenTest {
    @Test
    fun theWeatherTheCompanionLookedUpShowsWithItsGoogleSource() = runComposeUiTest {
        val weather = ToolCard.Weather("Cloudy, 3 °C, feels like -3 °C", "Weather for Kallio - Google", "https://www.google.com/search?q=Weather")
        // The Orb animates forever, so the test drives the clock instead of waiting for idle.
        mainClock.autoAdvance = false
        setContent {
            val vm = remember { PatientViewModel() }
            val scope = rememberCoroutineScope()
            val playback = remember { MusicPlayback(createClipPlayer(), scope, { false }, {}, {}) }
            DepressifyTheme(night = false) {
                VoiceCheckInScreen(vm, PatientState(), LiveSnapshot(cards = listOf(weather)), playback) {}
            }
        }
        mainClock.advanceTimeByFrame()
        onNodeWithText("Cloudy, 3 °C, feels like -3 °C").assertIsDisplayed()
        onNodeWithText("Weather for Kallio - Google").assertIsDisplayed()
    }
}
