package app.depressify.shared.data.firebase

import app.depressify.shared.data.AuthGateway
import dev.gitlive.firebase.auth.FirebaseAuth

/** Anonymous sign-in through the GitLive Firebase SDK. */
class FirebaseAuthGateway(private val auth: FirebaseAuth) : AuthGateway {
    override suspend fun currentUserId(): String? = auth.currentUser?.uid

    override suspend fun signInAnonymously(): String =
        checkNotNull(auth.signInAnonymously().user?.uid) { "Anonymous sign-in returned no user" }
}
