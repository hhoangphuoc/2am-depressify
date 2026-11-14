import java.util.Properties

// Android application entry point. Shared code lives in `shared` and `core`.
//
// Firebase configuration: no google-services.json and no Google Services plugin. Firebase is
// initialised in code (CompanionApplication) from BuildConfig fields read here:
//   - Defaults: the emulator-only demo project `demo-twoam`, which needs no credentials. Debug
//     builds talk to the local emulators on 127.0.0.1 (use `adb reverse`, see README).
//   - A real project: put its values in the gitignored `secrets.properties` at the repository root
//     (keys below). Set `firebase.emulatorHost=` (empty) to stop using the emulators.
//
// The Clinician a new Patient is linked to comes from `demo.clinicianEmail` in the same file, never
// from code (the repository is public). Only the emulator project falls back to the placeholder;
// a real project without it fails the build rather than linking Patients to a placeholder.
plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeCompiler)
}

val secrets = Properties().apply {
    val file = rootProject.file("secrets.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun secret(key: String, default: String): String = secrets.getProperty(key) ?: default

val firebaseProjectId = secret("firebase.projectId", "demo-twoam")
val clinicianEmail: String = secrets.getProperty("demo.clinicianEmail")?.trim()?.takeIf { it.isNotEmpty() }
    ?: if (firebaseProjectId.startsWith("demo-")) {
        "clinician@example.com" // the emulator placeholder
    } else {
        throw GradleException(
            "secrets.properties sets firebase.projectId=$firebaseProjectId but not demo.clinicianEmail. " +
                "Add demo.clinicianEmail=<the Clinician's email>, and allow it with " +
                "`npm run allow-clinician -- --email <email> --project $firebaseProjectId` in firebase/seed.",
        )
    }
fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "app.depressify"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        // The installed app's id, which is also the package name registered in Firebase. It is set
        // here, apart from `namespace` above.
        applicationId = "app.depressify"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(firebaseProjectId))
        buildConfigField(
            "String",
            "FIREBASE_APPLICATION_ID",
            quoted(secret("firebase.applicationId", "1:000000000000:android:0000000000000000")),
        )
        buildConfigField("String", "FIREBASE_API_KEY", quoted(secret("firebase.apiKey", "demo-api-key")))
        buildConfigField("String", "CLINICIAN_EMAIL", quoted(clinicianEmail))
    }

    buildTypes {
        debug {
            buildConfigField("String", "FIREBASE_EMULATOR_HOST", quoted(secret("firebase.emulatorHost", "127.0.0.1")))
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "FIREBASE_EMULATOR_HOST", quoted(""))
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(project(":shared"))
    implementation(libs.androidx.activity.compose)
    implementation(libs.koin.android)
}
