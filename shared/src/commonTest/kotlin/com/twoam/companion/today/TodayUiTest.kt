package com.twoam.companion.today

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.v2.runComposeUiTest
import com.twoam.companion.ui.theme.SmallStepTheme
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
