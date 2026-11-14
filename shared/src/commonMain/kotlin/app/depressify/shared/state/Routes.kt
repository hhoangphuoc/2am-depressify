package app.depressify.shared.state

import app.depressify.core.SignalId

/** Navigation 3 keys. Today, History and Settings are tab roots; the rest push on top. */
sealed interface Route {
    data object Today : Route
    data object History : Route
    data object Settings : Route
    data object Welcome : Route
    data object Sharing : Route
    data object CheckInIntro : Route
    data object CheckIn : Route
    data object Finishing : Route
    data class Summary(val id: String) : Route
    data object Suggestion : Route
    data object Signals : Route
    data class Signal(val id: SignalId) : Route
    data object QuietHours : Route
    data object Privacy : Route
    data object Support : Route
    data object Crisis : Route
}

val TabRoots = listOf(Route.Today, Route.History, Route.Settings)
