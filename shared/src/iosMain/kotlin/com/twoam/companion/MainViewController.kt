package com.twoam.companion

import androidx.compose.ui.window.ComposeUIViewController
import com.twoam.companion.config.DemoConfig
import com.twoam.companion.data.firebase.FirebaseEmulators
import com.twoam.companion.di.configModule
import com.twoam.companion.di.sharedModule
import org.koin.core.context.startKoin
import platform.UIKit.UIViewController

/**
 * Composition root for iOS, called once from Swift after `FirebaseApp.configure()`.
 * Pass an emulator host (for example "127.0.0.1" on the simulator) to use the local emulators, and
 * the Clinician a new Patient is linked to (read by Swift from `Secrets.plist`).
 */
fun startCompanion(emulatorHost: String?, clinicianEmail: String) {
    if (emulatorHost != null) FirebaseEmulators.use(emulatorHost)
    startKoin { modules(sharedModule, configModule(DemoConfig(clinicianEmail))) }
}

/** The Patient app's root view controller. */
fun MainViewController(): UIViewController = ComposeUIViewController { App() }
