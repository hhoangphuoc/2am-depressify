import FirebaseCore
import Shared
import SwiftUI

@main
struct iOSApp: App {
    init() {
        // A real project ships GoogleService-Info.plist (gitignored). Without it, the app uses the
        // emulator-only demo project and the local emulators, like the Android debug build.
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            MainViewControllerKt.startCompanion(emulatorHost: nil)
        } else {
            let options = FirebaseOptions(googleAppID: "1:000000000000:ios:0000000000000000", gcmSenderID: "000000000000")
            options.apiKey = "demo-api-key"
            options.projectID = "demo-twoam"
            FirebaseApp.configure(options: options)
            MainViewControllerKt.startCompanion(emulatorHost: "127.0.0.1")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
