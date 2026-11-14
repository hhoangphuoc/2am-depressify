import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// `shared`: the Patient app's Kotlin Multiplatform client code, compiled for Android and iOS. Depends on `core`.
//   - Compose Multiplatform UI and app state (`app.depressify.shared`, its `screens`, `state`, `ui`, `voice`).
//   - The client data layer, UI-free: `app.depressify.shared.data` (Firebase through the GitLive SDK),
//     `.session`, `.sharing`, `.config` and `.di` (Koin). The app state reaches the backend only through it.
//
// Tests: the common tests (data layer, session, app state, with fakes) run on the Android host:
// `./gradlew :shared:testAndroidHostTest`.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.compose.compiler)
}

kotlin {
    android {
        namespace = "app.depressify.shared"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
        androidResources { enable = true }

        // Host tests are off by default in the Android-KMP plugin; switch them on explicitly.
        withHostTest {}
    }

    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "Shared"
            isStatic = true
        }
    }

    sourceSets {
        commonMain.dependencies {
            api(project(":core"))
            implementation(libs.compose.runtime)
            implementation(libs.compose.foundation)
            implementation(libs.compose.ui)
            implementation(libs.compose.components.resources)
            implementation(libs.compose.ui.tooling.preview)
            implementation(libs.jetbrains.lifecycle.viewmodel.compose)
            implementation(libs.jetbrains.lifecycle.runtime.compose)
            implementation(libs.jetbrains.navigation3.ui)
            implementation(libs.kotlinx.coroutines.core)

            api(libs.koin.core)

            api(libs.gitlive.firebase.app)
            implementation(libs.gitlive.firebase.auth)
            implementation(libs.gitlive.firebase.firestore)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.kotlinx.coroutines.test)
        }
        androidMain.dependencies {
            implementation(libs.androidx.activity.compose)
        }
        getByName("androidHostTest").dependencies {
            implementation(libs.gitlive.firebase.common.internal)
        }
    }
}

compose.resources {
    packageOfResClass = "app.depressify.shared.resources"
}
