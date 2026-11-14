package com.twoam.companion.core.model

/** Firestore collection names. See docs/firestore-schema.md. */
object Collections {
    const val PATIENTS: String = "patients"

    // Under patients/{patientId}
    const val DAILY: String = "daily"
    const val CONSENTS: String = "consents"
    const val CHECK_INS: String = "checkIns"
    const val SUMMARIES: String = "summaries"
    const val SUGGESTIONS: String = "suggestions"
    const val FLAGS: String = "flags"
    const val VISITS: String = "visits"
    const val DIGESTS: String = "digests"

    val PATIENT_SUBCOLLECTIONS: List<String> =
        listOf(DAILY, CONSENTS, CHECK_INS, SUMMARIES, SUGGESTIONS, FLAGS, VISITS, DIGESTS)

    /** Top level; written by Cloud Functions only, read by the Trigger Email extension. */
    const val MAIL: String = "mail"
}
