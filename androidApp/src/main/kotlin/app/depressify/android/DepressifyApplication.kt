package app.depressify.android

import android.app.Application
import app.depressify.shared.config.DemoConfig
import app.depressify.shared.data.firebase.FirebaseEmulators
import app.depressify.shared.di.configModule
import app.depressify.shared.di.sharedModule
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.FirebaseOptions
import dev.gitlive.firebase.apps
import dev.gitlive.firebase.initialize
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

/** Composition root for Android: Firebase first, then Koin with the configuration from BuildConfig. */
class DepressifyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        initFirebase()
        startKoin {
            androidContext(this@DepressifyApplication)
            modules(sharedModule, configModule(DemoConfig(BuildConfig.CLINICIAN_EMAIL)))
        }
    }

    private fun initFirebase() {
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
        if (BuildConfig.FIREBASE_EMULATOR_HOST.isNotEmpty()) {
            FirebaseEmulators.use(BuildConfig.FIREBASE_EMULATOR_HOST)
        }
    }
}
