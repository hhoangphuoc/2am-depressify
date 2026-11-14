package app.depressify.shared.session

/** The backend start-up as the app state exposes it: anonymous sign-in, then the Patient record. */
sealed interface StartupState {
    /** No backend is configured (previews, tests): the app runs on DemoData only. */
    data object Disabled : StartupState

    data object Starting : StartupState

    /** Start-up failed. [message] is vetted copy from [StartupCopy], never a raw exception. Retry is offered. */
    data class Failed(val message: String) : StartupState

    data class Ready(val started: StartedPatient) : StartupState
}
