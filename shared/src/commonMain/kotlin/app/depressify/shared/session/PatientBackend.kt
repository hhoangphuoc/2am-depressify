package app.depressify.shared.session

import app.depressify.shared.data.ConsentStore
import app.depressify.shared.data.PatientStore
import org.koin.mp.KoinPlatform

/**
 * What the app state needs from the backend: the session that signs the Patient in and creates
 * their record, and the stores behind the Patient's sharing and Consent choices.
 */
class PatientBackend(
    val session: PatientSession,
    val patients: PatientStore,
    val consents: ConsentStore,
    val nowMillis: () -> Long,
) {
    companion object {
        /**
         * The backend the platform entry point registered in Koin, or null when Koin was not started
         * (previews, tests). Without it the app runs on DemoData only.
         */
        fun fromKoinOrNull(): PatientBackend? = KoinPlatform.getKoinOrNull()?.getOrNull()
    }
}
