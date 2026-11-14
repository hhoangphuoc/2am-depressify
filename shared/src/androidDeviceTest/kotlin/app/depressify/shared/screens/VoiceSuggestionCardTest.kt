package app.depressify.shared.screens

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import app.depressify.core.SuggestionKind
import app.depressify.shared.ui.theme.DepressifyTheme
import app.depressify.shared.voice.SessionSuggestion
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalTestApi::class)
class VoiceSuggestionCardTest {
    /** The whole text is on screen: nothing around it cuts it off. */
    private fun SemanticsNodeInteraction.assertNotClipped() {
        val node = fetchSemanticsNode()
        assertEquals(node.size.height.toFloat(), node.boundsInRoot.height, 1f, "clipped: " + node.config)
        assertEquals(node.size.width.toFloat(), node.boundsInRoot.width, 1f, "clipped: " + node.config)
    }

    @Test
    fun withLargerTextTheCardStillShowsThePlaceAndItsButtons() = runComposeUiTest {
        val walk = SessionSuggestion(
            "s1", SuggestionKind.Walk, title = "A little time outside", detail = "Take a walk by the sea at Tokoinranta.",
            actionUrl = "https://maps.google.com/?cid=1", actionLabel = "Tokoinranta · 13 min walk",
        )
        // The sketch on the card animates forever, so the test drives the clock instead of waiting for idle.
        mainClock.autoAdvance = false
        setContent {
            val density = LocalDensity.current
            // A narrow phone with large text, like the screenshot where the buttons lost their words.
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 1.5f)) {
                DepressifyTheme(night = true) { Box(Modifier.width(360.dp)) {
                    SuggestionsBottomModal(
                        open = true, suggestions = listOf(walk), activeIndex = 0, onActiveIndexChange = {}, booked = false,
                        showMapsAttribution = true, onDismiss = {}, onSelect = {}, onSmaller = {}, onVote = { _, _ -> },
                        onBook = {}, onMapsSources = {},
                    )
                } }
            }
        }
        mainClock.advanceTimeBy(1000)
        onNodeWithText("Tokoinranta · 13 min walk").assertNotClipped()
        onNodeWithText("That works").assertNotClipped()
        onNodeWithText("Smaller").assertNotClipped()
    }
}
