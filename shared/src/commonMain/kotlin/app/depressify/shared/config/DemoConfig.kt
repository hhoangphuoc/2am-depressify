package app.depressify.shared.config

/**
 * Demo-wide configuration, supplied by the platform entry point (Android: `BuildConfig` from the
 * gitignored `secrets.properties`; iOS: `Secrets.plist`). V1 has one Clinician and links every new
 * Patient to them on first open (the Invite is deferred). The security rules accept the link only
 * if the email is in the `clinicians` allowlist (`npm run allow-clinician` in firebase/seed).
 */
class DemoConfig(clinicianEmail: String) {
    /** The Clinician a new Patient record is linked to: trimmed and lower case, as the sign-in token carries it. */
    val clinicianEmail: String = clinicianEmail.trim().lowercase()

    companion object {
        /** The placeholder Clinician, for the local emulators only. Never a real address. */
        const val EMULATOR_CLINICIAN_EMAIL: String = "clinician@example.com"

        /** Display name of the Patient created on the demo phone. The Clinician can rename them. */
        const val LIVE_PATIENT_DISPLAY_NAME: String = "Live patient"
    }
}
