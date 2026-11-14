package app.depressify.shared

import androidx.compose.ui.window.ComposeUIViewController
import app.depressify.shared.data.PatientBackend
import app.depressify.shared.data.firebase.FirebaseEmulators
import app.depressify.shared.data.firebase.firebasePatientBackend
import platform.UIKit.UIViewController

private var backend: PatientBackend? = null

/**
 * Called once from Swift after `FirebaseApp.configure()`. Pass an emulator host (for example
 * "127.0.0.1" on the simulator) to use the local emulators, and the Clinician a new Patient is
 * linked to (read by Swift from `Secrets.plist`). [demoPatientId] makes the app act as a seeded
 * Demo Patient.
 */
fun startBackend(emulatorHost: String?, clinicianEmail: String, demoPatientId: String?) {
    if (emulatorHost != null) FirebaseEmulators.use(emulatorHost)
    backend = firebasePatientBackend(clinicianEmail, demoPatientId)
}

/** Entry point for the SwiftUI host. The callback lets SwiftUI match the status bar to the night theme. */
fun MainViewController(onNightChange: (Boolean) -> Unit): UIViewController =
    ComposeUIViewController { DepressifyApp(backend, onNightChange) }
