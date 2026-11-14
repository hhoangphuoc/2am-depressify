package app.depressify.core.nudge

/**
 * The text of a Nudge notification. Lock-screen safe: a gentle, generic invitation that never names
 * the reason, a flag, a Signal or anything about the Patient's health (spec #5, "Nudges"). Tapping it
 * opens a ready-to-start Check-in; it never opens the microphone.
 */
data class NudgeNotification(val title: String, val body: String) {
    companion object {
        /** The copy from docs/design/interface-design.md, "Notifications". */
        val Invitation = NudgeNotification(
            title = "A moment for you?",
            body = "Your Check-in is here when you want it.",
        )

        /** The text for a Nudge. Every reason gets the same invitation, so no reason can leak into it. */
        @Suppress("UNUSED_PARAMETER")
        fun forNudge(nudge: NudgeOutcome.Nudge): NudgeNotification = Invitation
    }
}
