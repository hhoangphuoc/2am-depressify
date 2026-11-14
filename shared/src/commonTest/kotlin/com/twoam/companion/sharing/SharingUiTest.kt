package com.twoam.companion.sharing

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.v2.runComposeUiTest
import com.twoam.companion.core.model.ConsentPurpose
import com.twoam.companion.core.model.PatientDoc
import com.twoam.companion.core.model.SharingConsent
import com.twoam.companion.fakes.FakeConsentStore
import com.twoam.companion.fakes.FakePatientStore
import com.twoam.companion.home.PatientHomeSurface
import com.twoam.companion.session.StartedPatient
import com.twoam.companion.settings.SettingsSurface
import com.twoam.companion.today.TodayCopy
import com.twoam.companion.ui.theme.SmallStepTheme
import com.twoam.companion.ui.theme.SmallStepTokens
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalTestApi::class)
class SharingUiTest {
    private val clinician = "clinician@example.com"
    private val undecided = SharingState(clinicianEmail = clinician, choice = SharingConsent.undecided)
    private val choosing = undecided.copy(firstUseStep = FirstUseStep.Choice)
    private val loadedPurposes = PurposesState.Loaded(
        ratings = PurposeRow(ConsentPurpose.ratings, included = true),
        voiceCues = PurposeRow(ConsentPurpose.voice_cues, included = false),
    )
    private val sharing = SharingState(clinicianEmail = clinician, choice = SharingConsent.granted, purposes = loadedPurposes)
    private val notSharing = sharing.copy(choice = SharingConsent.declined)

    private fun ComposeUiTest.button(text: String) = onNode(hasText(text) and hasClickAction())

    // ---- First use ------------------------------------------------------------------------------

    @Test
    fun welcomeNamesTheAiCompanionAndContinues() = runComposeUiTest {
        val actions = mutableListOf<SharingAction>()
        setContent { SmallStepTheme { PatientHomeSurface(undecided, onAction = { actions += it }) } }

        onNodeWithText(SharingCopy.WELCOME_TITLE).assertIsDisplayed()
        onNodeWithText(SharingCopy.WELCOME_AI).assertIsDisplayed()
        button(SharingCopy.CONTINUE).assertHeightIsAtLeast(SmallStepTokens.Size.MinTouchTarget).performClick()

        assertEquals(listOf<SharingAction>(SharingAction.Continue), actions)
        onNodeWithText(TodayCopy.EMPTY).assertDoesNotExist()
    }

    @Test
    fun undecidedChoiceNamesTheClinicianAndShowsWhatIsSharedWithASample() = runComposeUiTest {
        setContent { SmallStepTheme { PatientHomeSurface(choosing, onAction = {}) } }

        onNodeWithText(SharingCopy.choiceIntro(clinician)).assertIsDisplayed()
        (SharingCopy.WHAT_IS_SHARED + SharingCopy.NOT_SHARED + SharingCopy.SAMPLE_TITLE + SharingCopy.SAMPLE_SUMMARY + SharingCopy.DECLINE_NOTE)
            .forEach { onNodeWithText(it).performScrollTo().assertIsDisplayed() }
        onNodeWithText(SharingCopy.SAVING).assertDoesNotExist()
    }

    @Test
    fun shareAndDontShareHaveEqualWeightAndEqualEase() = runComposeUiTest {
        val actions = mutableListOf<SharingAction>()
        setContent { SmallStepTheme { SharingChoiceSurface(choosing, onAction = { actions += it }) } }

        val share = button(SharingCopy.SHARE).performScrollTo().assertIsEnabled()
        val dontShare = button(SharingCopy.DONT_SHARE).performScrollTo().assertIsEnabled()
        val a = share.getBoundsInRoot()
        val b = dontShare.getBoundsInRoot()
        assertEquals(a.right - a.left, b.right - b.left)
        assertEquals(a.bottom - a.top, b.bottom - b.top)
        share.assertHeightIsAtLeast(SmallStepTokens.Size.MinTouchTarget)

        share.performClick()
        dontShare.performClick()
        assertEquals(
            listOf<SharingAction>(SharingAction.Choose(SharingConsent.granted), SharingAction.Choose(SharingConsent.declined)),
            actions,
        )
    }

    @Test
    fun whileSavingBothChoicesAreDisabledAndSavingIsShown() = runComposeUiTest {
        setContent { SmallStepTheme { PatientHomeSurface(choosing.copy(saving = SharingConsent.declined), onAction = {}) } }

        onNodeWithText(SharingCopy.SAVING).performScrollTo().assertIsDisplayed()
        button(SharingCopy.SHARE).assertIsNotEnabled()
        button(SharingCopy.DONT_SHARE).assertIsNotEnabled()
    }

    @Test
    fun aFailedSaveStaysOnTheChoiceWithTheReasonAndBothChoicesAgain() = runComposeUiTest {
        val error = SharingCopy.saveFailed(SharingConsent.undecided, clinician)
        setContent { SmallStepTheme { PatientHomeSurface(choosing.copy(error = error), onAction = {}) } }

        onNodeWithText(error).performScrollTo().assertIsDisplayed()
        button(SharingCopy.SHARE).assertIsEnabled()
        button(SharingCopy.DONT_SHARE).assertIsEnabled()
        onNodeWithText(TodayCopy.EMPTY).assertDoesNotExist()
    }

    @Test
    fun declinedOpensToday() = runComposeUiTest {
        setContent { SmallStepTheme { PatientHomeSurface(notSharing, onAction = {}) } }
        onNodeWithText(TodayCopy.EMPTY).assertIsDisplayed()
        onNodeWithText(SharingCopy.WELCOME_TITLE).assertDoesNotExist()
    }

    @Test
    fun grantedOpensTodayToo() = runComposeUiTest {
        setContent { SmallStepTheme { PatientHomeSurface(sharing, onAction = {}) } }
        onNodeWithText(TodayCopy.EMPTY).assertIsDisplayed()
    }

    @Test
    fun withTheRealViewModelEitherChoiceReachesTodayAndIsStored() {
        for ((button, choice) in listOf(SharingCopy.SHARE to SharingConsent.granted, SharingCopy.DONT_SHARE to SharingConsent.declined)) {
            runComposeUiTest {
                val consents = FakeConsentStore()
                val patients = FakePatientStore(consents)
                val record = PatientDoc(displayName = "Live patient", clinicianEmail = clinician)
                patients.records["p1"] = record
                val vm = SharingViewModel(StartedPatient("p1", record), patients, consents, nowMillis = { 1L })
                setContent {
                    val state by vm.state.collectAsState()
                    SmallStepTheme { PatientHomeSurface(state, vm::onAction) }
                }

                button(SharingCopy.CONTINUE).performClick()
                button(button).performScrollTo().performClick()
                waitUntil(timeoutMillis = 5_000) { onAllNodesWithText(TodayCopy.EMPTY).fetchSemanticsNodes().isNotEmpty() }

                onNodeWithText(TodayCopy.EMPTY).assertIsDisplayed()
                assertEquals(choice, patients.records.getValue("p1").sharingConsent)
            }
        }
    }

    // ---- Settings → Sharing and privacy -------------------------------------------------------

    @Test
    fun grantedShowsTheCurrentChoiceAndAStopSharingAction() = runComposeUiTest {
        val actions = mutableListOf<SharingAction>()
        setContent { SmallStepTheme { SettingsSurface(sharing, onSharingAction = { actions += it }) } }

        onNodeWithText(SharingCopy.SETTINGS_TITLE).assertIsDisplayed()
        onNodeWithText(SharingCopy.sharingStatus(SharingConsent.granted, clinician)).assertIsDisplayed()
        button(SharingCopy.SHARE_AGAIN).assertDoesNotExist()
        button(SharingCopy.STOP_SHARING).performScrollTo().assertHeightIsAtLeast(SmallStepTokens.Size.MinTouchTarget).performClick()

        assertEquals(listOf<SharingAction>(SharingAction.RequestWithdrawal), actions)
    }

    @Test
    fun withdrawalConfirmationNamesWhatTheClinicianStopsSeeing() = runComposeUiTest {
        val actions = mutableListOf<SharingAction>()
        setContent {
            SmallStepTheme { SettingsSurface(sharing.copy(confirmingWithdrawal = true), onSharingAction = { actions += it }) }
        }

        onNodeWithText(SharingCopy.confirmWithdrawalTitle(clinician)).performScrollTo().assertIsDisplayed()
        onNodeWithText(SharingCopy.CONFIRM_WITHDRAWAL_BODY).assertIsDisplayed()
        button(SharingCopy.STOP_SHARING).assertDoesNotExist()
        button(SharingCopy.KEEP_SHARING).performClick()
        button(SharingCopy.CONFIRM_STOP).performClick()

        assertEquals(listOf(SharingAction.CancelWithdrawal, SharingAction.ConfirmWithdrawal), actions)
    }

    @Test
    fun declinedShowsTheCurrentChoiceAndShareAgain() = runComposeUiTest {
        val actions = mutableListOf<SharingAction>()
        setContent { SmallStepTheme { SettingsSurface(notSharing, onSharingAction = { actions += it }) } }

        onNodeWithText(SharingCopy.sharingStatus(SharingConsent.declined, clinician)).assertIsDisplayed()
        onNodeWithText(SharingCopy.shareAgainNote(clinician)).assertIsDisplayed()
        button(SharingCopy.STOP_SHARING).assertDoesNotExist()
        button(SharingCopy.SHARE_AGAIN).performScrollTo().performClick()

        assertEquals(listOf<SharingAction>(SharingAction.Choose(SharingConsent.granted)), actions)
    }

    @Test
    fun savingAWithdrawalDisablesTheChoice() = runComposeUiTest {
        setContent { SmallStepTheme { SettingsSurface(sharing.copy(saving = SharingConsent.declined), onSharingAction = {}) } }

        onNodeWithText(SharingCopy.SAVING).assertIsDisplayed()
        button(SharingCopy.STOP_SHARING).assertIsNotEnabled()
    }

    @Test
    fun aFailedWithdrawalShowsTheRealStateAndWhyNextToTheChoice() = runComposeUiTest {
        val error = SharingCopy.saveFailed(SharingConsent.granted, clinician)
        setContent { SmallStepTheme { SettingsSurface(sharing.copy(error = error), onSharingAction = {}) } }

        onNodeWithText(SharingCopy.sharingStatus(SharingConsent.granted, clinician)).assertIsDisplayed()
        onNodeWithText(error).assertIsDisplayed()
        button(SharingCopy.STOP_SHARING).assertIsEnabled()
    }

    @Test
    fun ratingsAndVoiceCuesRowsShowTheirStateAndToggle() = runComposeUiTest {
        val actions = mutableListOf<SharingAction>()
        setContent { SmallStepTheme { SettingsSurface(sharing, onSharingAction = { actions += it }) } }

        val ratings = onNode(hasText(SharingCopy.RATINGS) and isToggleable()).performScrollTo()
        val voiceCues = onNode(hasText(SharingCopy.VOICE_CUES) and isToggleable()).performScrollTo()
        ratings.assertIsOn().assertHeightIsAtLeast(SmallStepTokens.Size.MinTouchTarget)
        voiceCues.assertIsOff()
        ratings.performClick()
        voiceCues.performClick()

        assertEquals(
            listOf<SharingAction>(
                SharingAction.SetIncluded(ConsentPurpose.ratings, false),
                SharingAction.SetIncluded(ConsentPurpose.voice_cues, true),
            ),
            actions,
        )
    }

    @Test
    fun aRowThatFailedToSaveSaysWhyUnderThatRow() = runComposeUiTest {
        val error = SharingCopy.purposeSaveFailed(true)
        val purposes = loadedPurposes.copy(ratings = PurposeRow(ConsentPurpose.ratings, included = true, error = error))
        setContent { SmallStepTheme { SettingsSurface(sharing.copy(purposes = purposes), onSharingAction = {}) } }

        onNodeWithText(error).performScrollTo().assertIsDisplayed()
        onNode(hasText(SharingCopy.RATINGS) and isToggleable()).assertIsOn().assertIsEnabled()
    }

    @Test
    fun aRowBeingSavedIsDisabled() = runComposeUiTest {
        val purposes = loadedPurposes.copy(voiceCues = PurposeRow(ConsentPurpose.voice_cues, included = true, saving = true))
        setContent { SmallStepTheme { SettingsSurface(sharing.copy(purposes = purposes), onSharingAction = {}) } }

        onNode(hasText(SharingCopy.VOICE_CUES) and isToggleable()).performScrollTo().assertIsOn().assertIsNotEnabled()
    }

    @Test
    fun rowsThatFailedToLoadOfferARetry() = runComposeUiTest {
        val actions = mutableListOf<SharingAction>()
        setContent {
            SmallStepTheme {
                SettingsSurface(sharing.copy(purposes = PurposesState.Failed(SharingCopy.PURPOSES_FAILED)), onSharingAction = { actions += it })
            }
        }

        onNodeWithText(SharingCopy.PURPOSES_FAILED).performScrollTo().assertIsDisplayed()
        button(SharingCopy.TRY_AGAIN).performScrollTo().performClick()
        assertEquals(listOf<SharingAction>(SharingAction.RetryPurposes), actions)
    }

    @Test
    fun privacyExplainsHowDataIsHandled() = runComposeUiTest {
        setContent { SmallStepTheme { SettingsSurface(sharing, onSharingAction = {}) } }

        onNodeWithText(SharingCopy.DATA_TITLE).performScrollTo().assertIsDisplayed()
        SharingCopy.DATA_HANDLING.forEach { onNodeWithText(it).performScrollTo().assertIsDisplayed() }
    }
}
