package app.depressify.today

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.depressify.ui.EmptyDestination

/** Today's screen state. Later slices add the Check-in action and the latest Suggestion. */
sealed interface TodayState {
    data object Empty : TodayState
}

object TodayCopy {
    const val TITLE: String = "Today"
    const val EMPTY: String = "Nothing here yet. Take your time."
}

/** Stateless Today surface: renders from plain state, so it can be tested without a backend. */
@Composable
fun TodaySurface(state: TodayState, modifier: Modifier = Modifier) {
    when (state) {
        TodayState.Empty -> EmptyDestination(TodayCopy.TITLE, TodayCopy.EMPTY, modifier)
    }
}
