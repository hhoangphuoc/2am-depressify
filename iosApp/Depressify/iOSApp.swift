import FirebaseCore
import Shared
import SwiftUI

/// The placeholder Clinician, for the local emulators only.
private let emulatorClinicianEmail = "clinician@example.com"

/// The Clinician a new Patient is linked to: `ClinicianEmail` in the gitignored
/// iosApp/Depressify/Secrets.plist, or else in Info.plist. Never in code: the repository is public.
private func configuredClinicianEmail() -> String? {
    if let url = Bundle.main.url(forResource: "Secrets", withExtension: "plist"),
       let secrets = NSDictionary(contentsOf: url),
       let email = secrets["ClinicianEmail"] as? String,
       !email.isEmpty {
        return email
    }
    if let email = Bundle.main.object(forInfoDictionaryKey: "ClinicianEmail") as? String, !email.isEmpty {
        return email
    }
    return nil
}

/// Firebase first, then the shared code's Koin graph, before the first Compose view is made.
private func startFirebaseAndCompanion() {
    // A real project ships GoogleService-Info.plist (gitignored). Without it, the app uses the
    // emulator-only demo project and the local emulators, like the Android debug build.
    if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
        guard let clinicianEmail = configuredClinicianEmail() else {
            fatalError("Set ClinicianEmail in iosApp/Depressify/Secrets.plist to the Clinician's email (see README).")
        }
        FirebaseApp.configure()
        StartCompanionKt.startCompanion(emulatorHost: nil, clinicianEmail: clinicianEmail)
    } else {
        let options = FirebaseOptions(googleAppID: "1:000000000000:ios:0000000000000000", gcmSenderID: "000000000000")
        options.apiKey = "demo-api-key"
        options.projectID = "demo-twoam"
        FirebaseApp.configure(options: options)
        StartCompanionKt.startCompanion(
            emulatorHost: "127.0.0.1",
            clinicianEmail: configuredClinicianEmail() ?? emulatorClinicianEmail
        )
    }
}

@main
struct iOSApp: App {
    init() {
        startFirebaseAndCompanion()
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
