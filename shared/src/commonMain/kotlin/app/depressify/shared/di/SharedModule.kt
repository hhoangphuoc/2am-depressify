package app.depressify.shared.di

import app.depressify.shared.config.DemoConfig
import app.depressify.shared.data.AuthGateway
import app.depressify.shared.data.ConsentStore
import app.depressify.shared.data.PatientStore
import app.depressify.shared.data.firebase.FirebaseAuthGateway
import app.depressify.shared.data.firebase.FirestoreConsentStore
import app.depressify.shared.data.firebase.FirestorePatientStore
import app.depressify.shared.session.PatientBackend
import app.depressify.shared.session.PatientSession
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.firestore
import org.koin.core.module.Module
import org.koin.dsl.module
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/**
 * Common bindings. The composition root (androidApp, iosApp) initialises Firebase, then starts Koin
 * with this module and [configModule] with the platform's configuration. The app state gets the
 * backend through [PatientBackend.fromKoinOrNull].
 */
@OptIn(ExperimentalTime::class)
val sharedModule = module {
    single<AuthGateway> { FirebaseAuthGateway(Firebase.auth) }
    single<PatientStore> { FirestorePatientStore(Firebase.firestore) }
    single<ConsentStore> { FirestoreConsentStore(Firebase.firestore) }
    single {
        PatientSession(
            auth = get(),
            patients = get(),
            clinicianEmail = get<DemoConfig>().clinicianEmail,
            displayName = DemoConfig.LIVE_PATIENT_DISPLAY_NAME,
        )
    }
    single {
        PatientBackend(session = get(), patients = get(), consents = get(), nowMillis = { Clock.System.now().toEpochMilliseconds() })
    }
}

/** The configuration the platform entry point read (the Clinician's email). */
fun configModule(config: DemoConfig): Module = module { single { config } }
