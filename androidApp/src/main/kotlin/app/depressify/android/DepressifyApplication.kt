package app.depressify.android

import android.app.Application
import app.depressify.shared.data.PatientBackend
import app.depressify.shared.data.firebase.FirebaseEmulators
import app.depressify.shared.data.firebase.firebasePatientBackend
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.FirebaseOptions
import dev.gitlive.firebase.apps
import dev.gitlive.firebase.initialize

/** Composition root for Android: Firebase first, then the backend with the configuration from BuildConfig. */
class DepressifyApplication : Application() {
    lateinit var backend: PatientBackend
        private set

    override fun onCreate() {
        super.onCreate()
        // No google-services.json: Firebase is configured from BuildConfig (see androidApp/build.gradle.kts).
        if (Firebase.apps(this).isEmpty()) {
            Firebase.initialize(
                this,
                FirebaseOptions(
                    applicationId = BuildConfig.FIREBASE_APPLICATION_ID,
                    apiKey = BuildConfig.FIREBASE_API_KEY,
                    projectId = BuildConfig.FIREBASE_PROJECT_ID,
                ),
            )
        }
        if (BuildConfig.FIREBASE_EMULATOR_HOST.isNotEmpty()) FirebaseEmulators.use(BuildConfig.FIREBASE_EMULATOR_HOST)
        backend = firebasePatientBackend(BuildConfig.CLINICIAN_EMAIL)
    }
}
