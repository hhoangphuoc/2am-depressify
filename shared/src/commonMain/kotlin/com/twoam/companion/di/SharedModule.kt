package com.twoam.companion.di

import com.twoam.companion.config.DemoConfig
import com.twoam.companion.data.AuthGateway
import com.twoam.companion.data.ConsentStore
import com.twoam.companion.data.PatientStore
import com.twoam.companion.data.firebase.FirebaseAuthGateway
import com.twoam.companion.data.firebase.FirestoreConsentStore
import com.twoam.companion.data.firebase.FirestorePatientStore
import com.twoam.companion.session.PatientSession
import com.twoam.companion.session.StartedPatient
import com.twoam.companion.sharing.SharingViewModel
import com.twoam.companion.startup.StartupViewModel
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
