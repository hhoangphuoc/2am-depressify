package app.depressify.shared.data

import app.depressify.core.model.Consent
import app.depressify.core.model.ConsentPurpose
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Flag
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import app.depressify.core.model.Suggestion
import app.depressify.core.model.Summary

class FakeAuthGateway(var signedInUid: String? = null, private val newUid: String = "patient-1") : AuthGateway {
    var failSignIn: Boolean = false
    var signInCalls: Int = 0
        private set

    override suspend fun currentUserId(): String? = signedInUid

    override suspend fun signInAnonymously(): String {
        signInCalls++
        if (failSignIn) throw IllegalStateException("network down")
        signedInUid = newUid
        return newUid
    }
}

/**
 * The Patient record and its Consents in memory. A sharing write updates the record and
 * `consents/sharing` together, like the Firestore transaction.
 */
class FakePatientStore(val consents: FakeConsentStore = FakeConsentStore()) : PatientStore {
    val records: MutableMap<String, PatientDoc> = mutableMapOf()
    var failSharingWrites: Boolean = false

    /** When set, a sharing write commits on the server even though the call throws (a lost reply). */
    var commitThenFail: Boolean = false
    var creates: Int = 0
        private set

    override suspend fun get(patientId: String): PatientDoc? = records[patientId]

    override suspend fun create(patientId: String, patient: PatientDoc) {
        creates++
        records[patientId] = patient
    }

    override suspend fun markSeen(patientId: String, atMillis: Long) {
        records[patientId] = records.getValue(patientId).copy(lastSeenAtMillis = atMillis)
    }

    override suspend fun setSharingConsent(patientId: String, choice: SharingConsent, atMillis: Long) {
        if (failSharingWrites && !commitThenFail) throw IllegalStateException("UNAVAILABLE")
        records[patientId] = records.getValue(patientId).copy(sharingConsent = choice, sharingChangedAtMillis = atMillis)
        consents.stored.getOrPut(patientId) { mutableMapOf() }[ConsentPurpose.sharing.name] =
            Consent(ConsentPurpose.sharing.name, choice == SharingConsent.granted, atMillis)
        if (commitThenFail) throw IllegalStateException("DEADLINE_EXCEEDED")
    }
}

class FakeConsentStore : ConsentStore {
    /** patientId → subject → Consent. */
    val stored: MutableMap<String, MutableMap<String, Consent>> = mutableMapOf()

    override suspend fun get(patientId: String, subject: String): Consent? = stored[patientId]?.get(subject)

    override suspend fun set(patientId: String, consent: Consent) {
        stored.getOrPut(patientId) { mutableMapOf() }[consent.subject] = consent
    }
}

/** The Patient's Check-in records in memory, and a fixed Live token. */
class FakeCheckInGateway : CheckInGateway {
    var days: List<DailyDoc> = emptyList()
    var summaries: List<Summary> = emptyList()
    val suggestions: MutableList<Suggestion> = mutableListOf()
    val flags: MutableList<Flag> = mutableListOf()
    var failWrites: Boolean = false
    var failStart: Boolean = false
    var failFinish: Boolean = false
    /** What Find places returns; null makes the lookup fail. */
    var places: List<NearbyPlace>? = emptyList()
    /** What the weather lookup returns; null makes it fail. */
    var weather: Weather? = null
    var brief: String? = null
    val finished: MutableList<Pair<String, CheckInDraft>> = mutableListOf()

    /** What Suggest today answers; null makes the call fail. */
    var today: TodaySuggestions? = null

    override suspend fun startCheckIn(patientId: String, brief: String, typed: Boolean): LiveStart {
        if (failStart) throw IllegalStateException("UNAVAILABLE")
        this.brief = brief
        return LiveStart("check-in-1", "token-1", "models/gemini-3.8-live", "wss://live.example")
    }

    override suspend fun finishCheckIn(patientId: String, checkInId: String, draft: CheckInDraft): Summary {
        if (failFinish) throw IllegalStateException("UNAVAILABLE")
        finished += checkInId to draft
        return Summary(checkInId, 1000, mood = 3, energy = null, sleepQuality = null, sleepLine = "Slept less than usual", themes = listOf("A tired week"), voiceCues = emptyList(), suggestion = "One calm song tonight", previousOutcome = null, quotes = emptyList(), sharedWithClinician = true)
    }

    override suspend fun recentDays(patientId: String, count: Int): List<DailyDoc> = days.take(count)
    override suspend fun findPlaces(patientId: String, query: String, near: PatientLocation): List<NearbyPlace> = places ?: throw IllegalStateException("UNAVAILABLE")
    override suspend fun weather(patientId: String, near: PatientLocation): Weather = weather ?: throw IllegalStateException("UNAVAILABLE")
    override suspend fun recentSummaries(patientId: String, count: Int): List<Summary> = summaries.take(count)
    override suspend fun lastSuggestion(patientId: String): Suggestion? = suggestions.lastOrNull()

    override suspend fun saveSuggestion(patientId: String, suggestion: Suggestion) {
        if (failWrites) throw IllegalStateException("UNAVAILABLE")
        suggestions += suggestion
    }

    override suspend fun raiseFlag(patientId: String, flagId: String, flag: Flag) {
        if (failWrites) throw IllegalStateException("UNAVAILABLE")
        flags += flag
    }

    override suspend fun suggestToday(patientId: String): TodaySuggestions = today ?: throw IllegalStateException("UNAVAILABLE")
}
