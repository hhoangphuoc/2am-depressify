package app.depressify.data

/** Signs the Patient in. V1 uses anonymous sign-in; the Patient id is the auth uid. */
interface AuthGateway {
    /** The signed-in user's id, or null when nobody is signed in. */
    suspend fun currentUserId(): String?

    /** Signs in anonymously and returns the new user id. Throws on failure. */
    suspend fun signInAnonymously(): String
}
