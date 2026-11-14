package app.depressify

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.depressify.home.PatientHome
import app.depressify.startup.StartupRoute
import app.depressify.ui.theme.SmallStepTheme

/** Root of the Patient app on every platform. Koin must be started by the platform entry point. */
@Composable
fun App() {
    SmallStepTheme {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
            StartupRoute { started -> PatientHome(started) }
        }
    }
}
