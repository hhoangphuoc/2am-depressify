package com.twoam.companion.config

/**
 * Demo-wide configuration. V1 has one Clinician and links every new Patient to them on first open
 * (the Invite is deferred).
 */
object DemoConfig {
    /** The one demo Clinician. A new Patient record is linked to this email on first open. */
    const val CLINICIAN_EMAIL: String = "clinician@example.com"

    /** Display name of the Patient created on the demo phone. The Clinician can rename them. */
    const val LIVE_PATIENT_DISPLAY_NAME: String = "Live patient"
}
