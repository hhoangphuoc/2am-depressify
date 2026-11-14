package com.twoam.companion.di

import com.twoam.companion.config.DemoConfig
import com.twoam.companion.data.AuthGateway
import com.twoam.companion.data.PatientStore
import com.twoam.companion.data.firebase.FirebaseAuthGateway
import com.twoam.companion.data.firebase.FirestorePatientStore
import com.twoam.companion.session.PatientSession
import com.twoam.companion.startup.StartupViewModel
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.firestore
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/**
 * Common bindings. The composition root (androidApp, iosApp) initialises Firebase, then starts Koin
 * with this module plus one platform module per target as platform ports appear.
 */
val sharedModule = module {
    single<AuthGateway> { FirebaseAuthGateway(Firebase.auth) }
    single<PatientStore> { FirestorePatientStore(Firebase.firestore) }
    single {
        PatientSession(
            auth = get(),
            patients = get(),
            clinicianEmail = DemoConfig.CLINICIAN_EMAIL,
            displayName = DemoConfig.LIVE_PATIENT_DISPLAY_NAME,
        )
    }
    viewModel { StartupViewModel(get()) }
}
