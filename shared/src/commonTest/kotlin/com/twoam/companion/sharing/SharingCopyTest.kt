package com.twoam.companion.sharing

import com.twoam.companion.core.model.SharingConsent
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SharingCopyTest {
    private val clinician = "clinician@example.com"

    private val everything: List<String> = buildList {
        addAll(
            listOf(
                SharingCopy.WELCOME_TITLE, SharingCopy.WELCOME_LINE, SharingCopy.WELCOME_AI, SharingCopy.CONTINUE,
                SharingCopy.CHOICE_TITLE, SharingCopy.choiceIntro(clinician), SharingCopy.WHAT_IS_SHARED_TITLE,
                SharingCopy.NOT_SHARED, SharingCopy.SAMPLE_TITLE, SharingCopy.DECLINE_NOTE, SharingCopy.SHARE,
                SharingCopy.DONT_SHARE, SharingCopy.SAVING, SharingCopy.SETTINGS_TITLE, SharingCopy.STOP_SHARING,
                SharingCopy.SHARE_AGAIN, SharingCopy.shareAgainNote(clinician), SharingCopy.confirmWithdrawalTitle(clinician),
                SharingCopy.CONFIRM_WITHDRAWAL_BODY, SharingCopy.CONFIRM_STOP, SharingCopy.KEEP_SHARING,
                SharingCopy.CHECK_IN_TITLE, SharingCopy.CHECK_IN_NOTE, SharingCopy.RATINGS, SharingCopy.RATINGS_DETAIL,
                SharingCopy.VOICE_CUES, SharingCopy.VOICE_CUES_DETAIL, SharingCopy.LOADING, SharingCopy.PURPOSES_FAILED,
                SharingCopy.TRY_AGAIN, SharingCopy.purposeSaveFailed(true), SharingCopy.purposeSaveFailed(false),
                SharingCopy.DATA_TITLE,
            ),
        )
        addAll(SharingCopy.WHAT_IS_SHARED)
        addAll(SharingCopy.SAMPLE_SUMMARY)
        addAll(SharingCopy.DATA_HANDLING)
        SharingConsent.entries.forEach {
            add(SharingCopy.sharingStatus(it, clinician))
            add(SharingCopy.saveFailed(it, clinician))
        }
    }

    @Test
    fun copyNeverSpeaksOfTherapyTreatmentOrDiagnosis() {
        val banned = Regex("therap|treatment|diagnos", RegexOption.IGNORE_CASE)
        everything.forEach { assertFalse(banned.containsMatchIn(it), "\"$it\"") }
    }

    @Test
    fun privacyMakesNoAbsoluteSecrecyClaim() {
        val absolute = Regex("100%|completely private|fully private|totally private|no one (can|will)|nobody|always private|guarantee|secure", RegexOption.IGNORE_CASE)
        everything.forEach { assertFalse(absolute.containsMatchIn(it), "\"$it\"") }
    }

    @Test
    fun privacyStatesEachRequiredFact() {
        val text = SharingCopy.DATA_HANDLING.joinToString(" ")
        assertTrue(Regex("voice is streamed", RegexOption.IGNORE_CASE).containsMatchIn(text))
        assertTrue(text.contains("does not store recordings"))
        assertTrue(text.contains("transcript") && text.contains("dropped once your Summary is made"))
        assertTrue(text.contains("up to 55 days") && text.contains("abuse"))
        assertTrue(text.contains("Google Maps"))
    }

    @Test
    fun welcomeNamesTheCompanionAsAnAiInOneSentence() {
        assertTrue(SharingCopy.WELCOME_AI.contains("Companion") && SharingCopy.WELCOME_AI.contains("an AI"))
        assertTrue(SharingCopy.WELCOME_AI.trimEnd('.').count { it == '.' } == 0)
    }

    @Test
    fun sharingAgainSharesWhatComesNextAndNeverTheTimeWithoutSharing() {
        val note = SharingCopy.shareAgainNote(clinician)
        assertTrue(note.contains(clinician))
        assertTrue(note.contains("from then on"))
        assertTrue(note.contains("what you shared before"))
        assertTrue(note.contains("saved while you weren't sharing stay hidden from them"))
        // The old promise that the Clinician would see the time without sharing must not come back.
        val revealsTheGap = Regex("including what was saved while|see .* while you weren't sharing", RegexOption.IGNORE_CASE)
        everything.forEach { assertFalse(revealsTheGap.containsMatchIn(it), "\"$it\"") }
    }

    @Test
    fun withdrawingSaysTheTimeWithoutSharingStaysHiddenEvenAfterSharingAgain() {
        assertTrue(SharingCopy.CONFIRM_WITHDRAWAL_BODY.contains("stays hidden from them, even if you share again"))
    }

    @Test
    fun aFailedSaveSaysWhyAndWhatStillHolds() {
        assertTrue(SharingCopy.saveFailed(SharingConsent.granted, clinician).contains("couldn't reach the server"))
        assertTrue(SharingCopy.saveFailed(SharingConsent.granted, clinician).contains("still sharing with $clinician"))
        assertTrue(SharingCopy.saveFailed(SharingConsent.declined, clinician).contains("still not sharing"))
    }
}
