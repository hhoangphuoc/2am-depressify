package app.depressify.android

import android.app.Application
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
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
        backend = firebasePatientBackend(BuildConfig.CLINICIAN_EMAIL, BuildConfig.DEMO_PATIENT_ID)
        if (BuildConfig.DEBUG && BuildConfig.DEMO_PATIENT_ID.isNotBlank()) {
            getSystemService(ShortcutManager::class.java).dynamicShortcuts = DEMO_PATIENTS.map { (id, name) ->
                ShortcutInfo.Builder(this, id)
                    .setShortLabel(name)
                    .setIntent(Intent(this, MainActivity::class.java).setAction(Intent.ACTION_MAIN)
                        .putExtra(DEMO_PATIENT_EXTRA, id)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                    .build()
            }
        }
    }
}

internal const val DEMO_PATIENT_EXTRA = "demoPatientId"
internal val DEMO_PATIENTS = mapOf("demo-steady" to "Aino (demo)", "demo-declining" to "Mikko (demo)", "demo-sparse" to "Sara (demo)")
