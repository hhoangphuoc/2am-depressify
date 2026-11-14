package app.depressify.shared.data.firebase

import app.depressify.shared.data.AuthGateway
import app.depressify.shared.data.PatientBackend
import app.depressify.shared.data.PatientSession
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.FirebaseAuth
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.firestore

/**
 * The backend over the GitLive Firebase SDK. The platform entry point initialises Firebase first
 * (and [FirebaseEmulators] when it uses them), then calls this with the Clinician a new Patient is
 * linked to.
 */
fun firebasePatientBackend(clinicianEmail: String): PatientBackend {
    val patients = FirestorePatientStore(Firebase.firestore)
    return PatientBackend(
        session = PatientSession(FirebaseAuthGateway(Firebase.auth), patients, clinicianEmail),
        patients = patients,
        consents = FirestoreConsentStore(Firebase.firestore),
    )
}

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

    /**
     * Points Auth and Firestore at the emulators on [host]. Call once, after Firebase is initialised
     * and before anything reads or writes. On a phone, `adb reverse` lets [host] be 127.0.0.1.
     */
    fun use(host: String) {
        Firebase.auth.useEmulator(host, AUTH_PORT)
        Firebase.firestore.useEmulator(host, FIRESTORE_PORT)
    }
}
