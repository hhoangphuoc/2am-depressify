package app.depressify.di

import app.depressify.config.DemoConfig
import app.depressify.data.AuthGateway
import app.depressify.data.ConsentStore
import app.depressify.data.PatientStore
import app.depressify.data.firebase.FirebaseAuthGateway
import app.depressify.data.firebase.FirestoreConsentStore
import app.depressify.data.firebase.FirestorePatientStore
import app.depressify.session.PatientSession
import app.depressify.session.StartedPatient
import app.depressify.sharing.SharingViewModel
import app.depressify.startup.StartupViewModel
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.firestore
import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/**
 * Common bindings. The composition root (androidApp, iosApp) initialises Firebase, then starts Koin
 * with this module, [configModule] with the platform's configuration, and one platform module per
 * target as platform ports appear.
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
    viewModel { StartupViewModel(get()) }
    viewModel { (started: StartedPatient) ->
        SharingViewModel(started, patients = get(), consents = get(), nowMillis = { Clock.System.now().toEpochMilliseconds() })
    }
}

/** The configuration the platform entry point read (the Clinician's email). */
fun configModule(config: DemoConfig): Module = module { single { config } }
