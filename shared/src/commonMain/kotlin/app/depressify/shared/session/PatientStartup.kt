package app.depressify.shared.session

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Runs [PatientSession.start] (sign in, create the Patient record on first open) in [scope] and
 * exposes it as a [StartupState]. A failure offers a retry. UI-free: the app state owns it.
 */
class PatientStartup(private val session: PatientSession, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow<StartupState>(StartupState.Starting)
    val state: StateFlow<StartupState> = _state.asStateFlow()

    /** Starts the session. Call once; then [retry] after a failure. */
    fun start() {
        _state.value = StartupState.Starting
        scope.launch {
            _state.value = try {
                StartupState.Ready(session.start())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                StartupState.Failed(StartupCopy.failedMessage(e))
            }
        }
    }

    /** Starts again after a failure; does nothing otherwise. */
    fun retry() {
        if (_state.value is StartupState.Failed) start()
    }
}
