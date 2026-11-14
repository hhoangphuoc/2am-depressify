package app.depressify.today

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.v2.runComposeUiTest
import app.depressify.ui.theme.SmallStepTheme
import kotlin.test.Test

@OptIn(ExperimentalTestApi::class)
class TodayUiTest {
    @Test
    fun emptyTodayShowsItsTitleAndACalmLine() = runComposeUiTest {
        setContent { SmallStepTheme { TodaySurface(TodayState.Empty) } }

        onNodeWithText(TodayCopy.TITLE).assertIsDisplayed()
        onNodeWithText(TodayCopy.EMPTY).assertIsDisplayed()
    }
}
