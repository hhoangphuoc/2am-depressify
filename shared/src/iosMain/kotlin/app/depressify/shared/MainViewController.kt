package app.depressify.shared

import androidx.compose.ui.window.ComposeUIViewController
import platform.UIKit.UIViewController

/** Entry point for the SwiftUI host. The callback lets SwiftUI match the status bar to the night theme. */
fun MainViewController(onNightChange: (Boolean) -> Unit): UIViewController =
    ComposeUIViewController { DepressifyApp(onNightChange = onNightChange) }
