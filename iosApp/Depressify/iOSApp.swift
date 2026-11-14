import FirebaseCore
import GoogleMaps
import Shared
import SwiftUI

/// The placeholder Clinician, for the local emulators only.
private let emulatorClinicianEmail = "clinician@example.com"

/// The Clinician a new Patient is linked to: `ClinicianEmail` in the gitignored
/// iosApp/Depressify/Secrets.plist. Never in code: the repository is public.
private func secret(_ key: String) -> String? {
    guard let url = Bundle.main.url(forResource: "Secrets", withExtension: "plist"),
          let value = NSDictionary(contentsOf: url)?[key] as? String,
          !value.isEmpty else { return nil }
    return value
}

private func configuredClinicianEmail() -> String? { secret("ClinicianEmail") }

@main
struct iOSApp: App {
    init() {
        // The map of places on Today, only with a Maps SDK for iOS key (MapsApiKey in Secrets.plist).
        if let mapsKey = secret("MapsApiKey") {
            GMSServices.provideAPIKey(mapsKey)
            NativeMaps.shared.factory = { GooglePlacesMap(frame: .zero) }
        }
        // A real project ships GoogleService-Info.plist (gitignored). Without it, the app uses the
        // emulator-only demo project and the local emulators, like the Android debug build.
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            guard let clinicianEmail = configuredClinicianEmail() else {
                fatalError("Set ClinicianEmail in iosApp/Depressify/Secrets.plist to the Clinician's email (see README).")
            }
            FirebaseApp.configure()
            MainViewControllerKt.startBackend(emulatorHost: nil, clinicianEmail: clinicianEmail, demoPatientId: secret("DemoPatientId"))
        } else {
            let options = FirebaseOptions(googleAppID: "1:000000000000:ios:0000000000000000", gcmSenderID: "000000000000")
            // Not a real key, but it has a real key's shape: the SDK refuses anything else.
            options.apiKey = "AIzaSy" + String(repeating: "0", count: 33)
            options.projectID = "demo-twoam"
            FirebaseApp.configure(options: options)
            MainViewControllerKt.startBackend(
                emulatorHost: "127.0.0.1",
                clinicianEmail: configuredClinicianEmail() ?? emulatorClinicianEmail,
                demoPatientId: secret("DemoPatientId")
            )
        }
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
