package app.depressify.shared

import app.depressify.shared.config.DemoConfig
import app.depressify.shared.data.firebase.FirebaseEmulators
import app.depressify.shared.di.configModule
import app.depressify.shared.di.sharedModule
import org.koin.core.context.startKoin

/**
 * Composition root for iOS, called once from Swift after `FirebaseApp.configure()` and before the
 * first [MainViewController]. Pass an emulator host (for example "127.0.0.1" on the simulator) to use
 * the local emulators, and the Clinician a new Patient is linked to (read by Swift from `Secrets.plist`).
 */
fun startCompanion(emulatorHost: String?, clinicianEmail: String) {
    if (emulatorHost != null) FirebaseEmulators.use(emulatorHost)
    startKoin { modules(sharedModule, configModule(DemoConfig(clinicianEmail))) }
}
