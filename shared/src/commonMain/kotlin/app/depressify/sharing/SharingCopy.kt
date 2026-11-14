package app.depressify.sharing

import app.depressify.core.model.SharingConsent

/**
 * Vetted wording for the welcome, the sharing choice and Settings → Sharing and privacy.
 * No "therapy", "treatment" or "diagnosis" (ADR 0001); no claim of absolute secrecy.
 */
object SharingCopy {
    // Welcome
    const val WELCOME_TITLE: String = "Welcome"
    const val WELCOME_LINE: String = "This app is here for the days between your Visits."
    const val WELCOME_AI: String =
        "You'll talk with the Companion, an AI that listens and suggests small steps; it is not a clinician and cannot give medical advice."
    const val CONTINUE: String = "Continue"

    // Sharing choice (first use)
    const val CHOICE_TITLE: String = "Share with your clinician?"
    fun choiceIntro(clinicianEmail: String): String =
        "You can let your clinician, $clinicianEmail, see how you're doing between Visits. It's your choice, and you can change it any time in Settings."
    const val WHAT_IS_SHARED_TITLE: String = "What they would see"
    val WHAT_IS_SHARED: List<String> = listOf(
        "The Summary after each Check-in, exactly as you read it",
        "Your mood, energy and sleep ratings",
        "How the Signals you switch on, like sleep and steps, compare with your own usual",
        "When you last checked in, and a heads-up if things look harder than usual",
    )
    const val NOT_SHARED: String = "They never hear your voice or read the full conversation."
    const val SAMPLE_TITLE: String = "A sample Summary"
    val SAMPLE_SUMMARY: List<String> = listOf(
        "Mood 3 of 5 · Energy 2 of 5 · Sleep 3 of 5",
        "Slept a little less than usual.",
        "Talked about: a busy week at work, missing friends.",
        "Suggestion: a 10-minute walk after lunch.",
    )
    const val DECLINE_NOTE: String =
        "If you don't share, Check-ins work just the same, and your clinician sees nothing from the app."
    const val SHARE: String = "Share"
    const val DONT_SHARE: String = "Don't share"
    const val SAVING: String = "Saving your choice…"

    // Settings → Sharing and privacy
    const val SETTINGS_TITLE: String = "Sharing and privacy"
    fun sharingStatus(choice: SharingConsent, clinicianEmail: String): String = when (choice) {
        SharingConsent.granted -> "You're sharing your progress with $clinicianEmail."
        SharingConsent.declined -> "You're not sharing. Your clinician sees nothing from the app, and Check-ins work just the same."
        SharingConsent.undecided -> "You haven't chosen yet. Nothing is shared."
    }
    const val STOP_SHARING: String = "Stop sharing"
    const val SHARE_AGAIN: String = "Share again"
    /**
     * Re-consent shares future records only: what is saved while not sharing is stamped so the
     * Clinician never sees it, and what was shared before becomes visible again.
     */
    fun shareAgainNote(clinicianEmail: String): String =
        "If you share again, $clinicianEmail sees what you save from then on, and what you shared before. " +
            "Check-ins, Summaries and Signals saved while you weren't sharing stay hidden from them."
    fun confirmWithdrawalTitle(clinicianEmail: String): String = "Stop sharing with $clinicianEmail?"
    const val CONFIRM_WITHDRAWAL_BODY: String =
        "They will stop seeing your Summaries, your ratings, your Signal trends and when you last checked in, and they won't get heads-ups about you. Your Check-ins carry on as before, and what you save while you're not sharing stays hidden from them, even if you share again later."
    const val CONFIRM_STOP: String = "Yes, stop sharing"
    const val KEEP_SHARING: String = "Keep sharing"

    /** After a failed sharing save: why, and the state that really holds now. */
    fun saveFailed(stillChoice: SharingConsent, clinicianEmail: String): String =
        "Your choice wasn't saved because we couldn't reach the server. " + when (stillChoice) {
            SharingConsent.granted -> "You're still sharing with $clinicianEmail."
            SharingConsent.declined -> "You're still not sharing."
            SharingConsent.undecided -> "Nothing is shared. Try again when you're connected."
        }

    // Ratings and Voice cues
    const val CHECK_IN_TITLE: String = "In your Check-ins"
    const val CHECK_IN_NOTE: String = "Changes apply to your next Check-in. These are separate from sharing."
    const val RATINGS: String = "Ratings"
    const val RATINGS_DETAIL: String = "The Companion asks for your mood, energy and sleep, each from 1 to 5."
    const val VOICE_CUES: String = "Voice cues"
    const val VOICE_CUES_DETAIL: String =
        "The Companion notes things it hears in how you sound, like a flat tone. They appear in your Summary as observations."
    const val LOADING: String = "Loading…"
    const val PURPOSES_FAILED: String = "We couldn't load these choices. Check your connection and try again."
    const val TRY_AGAIN: String = "Try again"
    fun purposeSaveFailed(included: Boolean): String =
        "Not saved because we couldn't reach the server. " + if (included) "It's still on." else "It's still off."

    // How your data is handled
    const val DATA_TITLE: String = "How your data is handled"
    val DATA_HANDLING: List<String> = listOf(
        "Your voice is streamed to Google's AI while you talk. The app does not store recordings.",
        "The transcript shows on your phone during a Check-in and is dropped once your Summary is made.",
        "Google may keep what is sent to its AI for up to 55 days to check for abuse.",
        "Places the Companion suggests come from Google Maps.",
        "Readings like steps and sleep stay on your phone. Only daily totals and your Summaries are saved online.",
    )
}
