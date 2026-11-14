package app.depressify.core.nudge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class NudgeNotificationTest {

    @Test
    fun everyReasonGivesTheSameGenericInvitation() {
        val texts = NudgeReason.entries.map { NudgeNotification.forNudge(NudgeOutcome.Nudge(it)) }.toSet()
        assertEquals(setOf(NudgeNotification.Invitation), texts)
        // The copy from the interface design.
        assertEquals("A moment for you?", NudgeNotification.Invitation.title)
        assertEquals("Your Check-in is here when you want it.", NudgeNotification.Invitation.body)
    }

    @Test
    fun theTextNeverMentionsAHealthReasonOrAFlag() {
        val reasonWords = listOf(
            // The reasons themselves and the names of the rules.
            "rough", "night", "sleep", "tired", "home", "screen", "phone", "weather", "sun", "calendar",
            "free", "busy", "walk", "evening", "17", "missed", "haven't", "yet", "today",
            // Health, Signals and flags.
            "health", "mood", "signal", "baseline", "usual", "worse", "low", "flag", "amber", "red",
            "alert", "risk", "crisis", "depress", "concern", "worried", "clinician",
        )
        for (reason in NudgeReason.entries) {
            val n = NudgeNotification.forNudge(NudgeOutcome.Nudge(reason))
            val text = (n.title + " " + n.body).lowercase()
            for (word in reasonWords) assertFalse(word in text, "'$word' leaked into the Nudge for $reason: $text")
            for (name in NudgeReason.entries) assertFalse(name.name.lowercase() in text.replace(" ", ""))
        }
    }
}
