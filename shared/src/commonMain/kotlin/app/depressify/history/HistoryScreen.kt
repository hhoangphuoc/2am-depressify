package app.depressify.history

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.depressify.ui.EmptyDestination

/** History's screen state. Later slices add Summaries newest first and the mood trend. */
sealed interface HistoryState {
    data object Empty : HistoryState
}

object HistoryCopy {
    const val TITLE: String = "History"
    const val EMPTY: String = "Your Summaries will appear here after your first Check-in."
}

@Composable
fun HistorySurface(state: HistoryState, modifier: Modifier = Modifier) {
    when (state) {
        HistoryState.Empty -> EmptyDestination(HistoryCopy.TITLE, HistoryCopy.EMPTY, modifier)
    }
}
