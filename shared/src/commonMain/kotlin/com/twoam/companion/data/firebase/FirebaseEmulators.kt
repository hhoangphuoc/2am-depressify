package com.twoam.companion.data.firebase

import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.firestore

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
