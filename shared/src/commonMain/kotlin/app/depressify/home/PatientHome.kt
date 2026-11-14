package app.depressify.home

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.depressify.session.StartedPatient
import app.depressify.sharing.FirstUseSurface
import app.depressify.sharing.SharingAction
import app.depressify.sharing.SharingState
import app.depressify.sharing.SharingViewModel
import app.depressify.shell.AppShell
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

/** The signed-in Patient's app: first use until sharing is decided, then the three-tab shell. */
@Composable
fun PatientHome(started: StartedPatient) {
    val viewModel = koinViewModel<SharingViewModel>(key = started.patientId) { parametersOf(started) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    PatientHomeSurface(state = state, onAction = viewModel::onAction)
}

/**
 * Stateless gate. The welcome and the sharing choice show while sharing is undecided, so they appear
 * once, before Today; either choice, once saved, opens Today.
 */
@Composable
fun PatientHomeSurface(state: SharingState, onAction: (SharingAction) -> Unit, modifier: Modifier = Modifier) {
    if (state.inFirstUse) FirstUseSurface(state, onAction, modifier) else AppShell(state, onAction, modifier)
}
