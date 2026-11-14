package com.twoam.companion.startup

import com.twoam.companion.session.StartedPatient

/** What the Patient sees while the app starts. */
sealed interface StartupState {
    data object Starting : StartupState

    /** Startup failed. [message] is vetted copy from [StartupCopy], never a raw exception. */
    data class Failed(val message: String) : StartupState

    data class Ready(val started: StartedPatient) : StartupState
}

sealed interface StartupAction {
    data object Retry : StartupAction
}
