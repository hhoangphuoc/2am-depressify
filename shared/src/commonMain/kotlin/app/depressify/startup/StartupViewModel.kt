package app.depressify.startup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.depressify.session.PatientSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Signs the Patient in and creates their record on first open; a failure offers a retry. */
class StartupViewModel(private val session: PatientSession) : ViewModel() {
    private val _state = MutableStateFlow<StartupState>(StartupState.Starting)
    val state: StateFlow<StartupState> = _state.asStateFlow()

    init {
        start()
    }

    fun onAction(action: StartupAction) {
        when (action) {
            StartupAction.Retry -> if (_state.value is StartupState.Failed) start()
        }
    }

    private fun start() {
        _state.value = StartupState.Starting
        viewModelScope.launch {
            _state.value = try {
                StartupState.Ready(session.start())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                StartupState.Failed(StartupCopy.failedMessage(e))
            }
        }
    }
}
