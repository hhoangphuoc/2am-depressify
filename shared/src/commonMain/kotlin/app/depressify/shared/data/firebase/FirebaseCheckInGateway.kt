package app.depressify.shared.data.firebase

import app.depressify.core.model.Collections
import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Flag
import app.depressify.core.model.Suggestion
import app.depressify.core.model.Summary
import app.depressify.shared.data.CheckInGateway
import app.depressify.shared.data.LiveStart
import dev.gitlive.firebase.firestore.Direction
import dev.gitlive.firebase.firestore.FirebaseFirestore
import dev.gitlive.firebase.functions.FirebaseFunctions
import kotlinx.serialization.Serializable

/** Start Check-in through the callable, and the Patient's records through Firestore (GitLive SDK). */
class FirebaseCheckInGateway(private val db: FirebaseFirestore, private val functions: FirebaseFunctions) : CheckInGateway {
    @Serializable
    private data class StartRequest(val patientId: String)

    @Serializable
    private data class StartResponse(val token: String, val model: String, val expiresAtMillis: Long = 0)

    private fun patient(patientId: String) = db.collection(Collections.PATIENTS).document(patientId)

    override suspend fun startCheckIn(patientId: String): LiveStart {
        val response = functions.httpsCallable("startCheckIn")
            .invoke(StartRequest.serializer(), StartRequest(patientId))
            .data(StartResponse.serializer())
        return LiveStart(response.token, response.model)
    }

    override suspend fun recentDays(patientId: String, count: Int): List<DailyDoc> =
        patient(patientId).collection(Collections.DAILY).orderBy("date", Direction.DESCENDING).limit(count).get()
            .documents.map { it.data(DailyDoc.serializer()) }

    override suspend fun recentSummaries(patientId: String, count: Int): List<Summary> =
        patient(patientId).collection(Collections.SUMMARIES).orderBy("createdAtMillis", Direction.DESCENDING).limit(count).get()
            .documents.map { it.data(Summary.serializer()) }

    override suspend fun lastSuggestion(patientId: String): Suggestion? =
        patient(patientId).collection(Collections.SUGGESTIONS).orderBy("suggestedAtMillis", Direction.DESCENDING).limit(1).get()
            .documents.firstOrNull()?.data(Suggestion.serializer())

    override suspend fun saveSuggestion(patientId: String, suggestion: Suggestion) {
        patient(patientId).collection(Collections.SUGGESTIONS).document(suggestion.id)
            .set(Suggestion.serializer(), suggestion) { encodeDefaults = true }
    }

    override suspend fun raiseFlag(patientId: String, flagId: String, flag: Flag) {
        patient(patientId).collection(Collections.FLAGS).document(flagId).set(Flag.serializer(), flag) { encodeDefaults = true }
    }
}
