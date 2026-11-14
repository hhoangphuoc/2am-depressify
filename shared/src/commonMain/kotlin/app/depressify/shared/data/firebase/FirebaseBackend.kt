package app.depressify.shared.data.firebase

import app.depressify.shared.data.AuthGateway
import app.depressify.shared.data.PatientBackend
import app.depressify.shared.data.PatientSession
import app.depressify.shared.voice.live.KtorLiveClient
import app.depressify.shared.voice.live.createAudioIO
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.FirebaseAuth
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.firestore
import dev.gitlive.firebase.functions.functions

/**
 * The backend over the GitLive Firebase SDK. The platform entry point initialises Firebase first
 * (and [FirebaseEmulators] when it uses them), then calls this with the Clinician a new Patient is
 * linked to, and optionally the Demo Patient to act as.
 */
fun firebasePatientBackend(clinicianEmail: String, demoPatientId: String? = null): PatientBackend {
    val patients = FirestorePatientStore(Firebase.firestore)
    return PatientBackend(
        session = PatientSession(FirebaseAuthGateway(Firebase.auth), patients, clinicianEmail, demoPatientId = demoPatientId?.ifBlank { null }),
        patients = patients,
        consents = FirestoreConsentStore(Firebase.firestore),
        checkIns = FirebaseCheckInGateway(Firebase.firestore, Firebase.functions(region = FUNCTIONS_REGION)),
        live = KtorLiveClient(),
        audio = createAudioIO(),
    )
}

/** The region of the callable functions (REGION in firebase/functions/src/region.ts). */
const val FUNCTIONS_REGION: String = "europe-north1"

/** Anonymous sign-in through the GitLive Firebase SDK. */
class FirebaseAuthGateway(private val auth: FirebaseAuth) : AuthGateway {
    override suspend fun currentUserId(): String? = auth.currentUser?.uid

    override suspend fun signInAnonymously(): String =
        checkNotNull(auth.signInAnonymously().user?.uid) { "Anonymous sign-in returned no user" }
}

/** Local Firebase emulator ports, matching firebase/firebase.json. */
object FirebaseEmulators {
    const val AUTH_PORT: Int = 9099
    const val FIRESTORE_PORT: Int = 8080
    const val FUNCTIONS_PORT: Int = 5001

    /**
     * Points Auth and Firestore at the emulators on [host]. Call once, after Firebase is initialised
     * and before anything reads or writes. On a phone, `adb reverse` lets [host] be 127.0.0.1.
     */
    fun use(host: String) {
        Firebase.auth.useEmulator(host, AUTH_PORT)
        Firebase.firestore.useEmulator(host, FIRESTORE_PORT)
        Firebase.functions(region = FUNCTIONS_REGION).useEmulator(host, FUNCTIONS_PORT)
    }
}
