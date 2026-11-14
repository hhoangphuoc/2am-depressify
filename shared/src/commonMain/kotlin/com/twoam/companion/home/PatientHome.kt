package com.twoam.companion.home

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.twoam.companion.session.StartedPatient
import com.twoam.companion.sharing.FirstUseSurface
import com.twoam.companion.sharing.SharingAction
import com.twoam.companion.sharing.SharingState
import com.twoam.companion.sharing.SharingViewModel
import com.twoam.companion.shell.AppShell
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
