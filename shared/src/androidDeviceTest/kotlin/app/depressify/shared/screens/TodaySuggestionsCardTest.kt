package app.depressify.shared.screens

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import app.depressify.core.model.PatientLocation
import app.depressify.core.model.SuggestionKind
import app.depressify.shared.data.TodayPlace
import app.depressify.shared.data.TodaySuggestion
import app.depressify.shared.data.TodaySuggestions
import app.depressify.shared.state.PatientState
import app.depressify.shared.ui.theme.DepressifyTheme
import kotlin.test.Test

@OptIn(ExperimentalTestApi::class)
class TodaySuggestionsCardTest {
    private val today = TodaySuggestions(
        PatientLocation("Vallila, Helsinki", 60.0, 25.0),
        listOf(
            TodaySuggestion(
                SuggestionKind.walk, "A short stroll past the gardens.",
                places = listOf(
                    TodayPlace("a", "Vallila Community Garden", "Elisabeth Kochin tie 1, 00550 Helsinki", 60.01, 25.0, "https://maps.google.com/?cid=1"),
                    TodayPlace("b", "Kumpula Allotment Garden", "Kalervonkatu 1a, 00610 Helsinki", 60.0, 25.01, "https://maps.google.com/?cid=2"),
                ),
            ),
        ),
    )

    // The test app has no Maps key, so the card shows the places without a map.
    @Test
    fun withoutAMapEachPlaceShowsHowFarItIsInsteadOfItsAddress() = runComposeUiTest {
        setContent { DepressifyTheme(night = false) { TodaySuggestionsCard(PatientState(today = today), onRetry = {}) } }
        onNodeWithText("Vallila Community Garden").assertIsDisplayed()
        onNodeWithText("1.1 km away").assertIsDisplayed()
        onNodeWithText("556 m away").assertIsDisplayed()
        onAllNodesWithText("Elisabeth Kochin tie 1, 00550 Helsinki").assertCountEquals(0)
    }
}
