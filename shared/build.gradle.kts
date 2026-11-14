// `shared`: Kotlin Multiplatform client code. Compose Multiplatform UI, view models, Firebase access
// through the GitLive SDK, and Koin modules. Depends on `core`.
//
// Test seams in this module:
//   - shared common tests (view models, session, controllers with fakes): `./gradlew :shared:jvmTest`
//   - Compose UI tests (`*UiTest`, common UI test API on the JVM/desktop host): also `:shared:jvmTest`
//   - Android host tests are switched on explicitly and exclude `*UiTest`: `:shared:testAndroidHostTest`
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.androidKotlinMultiplatformLibrary)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    jvmToolchain(21)

    android {
        namespace = "com.twoam.companion.shared"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()

        // Host tests are off by default in the Android-KMP plugin; switch them on explicitly.
        withHostTest {}
    }

    // JVM (desktop) target: the fast loop for common tests and Compose UI tests.
    jvm()

    // iOS: arm64 device and arm64 simulator only (no Intel simulator).
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
            implementation(libs.compose.material3)

            // AndroidX multiplatform ViewModel is part of the shared module's API.
            api(libs.androidx.lifecycle.viewmodel)
            implementation(libs.jetbrains.lifecycle.viewmodel.compose)

            implementation(libs.kotlinx.coroutines.core)

            api(libs.koin.core)
            implementation(libs.koin.compose)
            implementation(libs.koin.compose.viewmodel)

            api(libs.gitlive.firebase.app)
            implementation(libs.gitlive.firebase.auth)
            implementation(libs.gitlive.firebase.firestore)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.compose.ui.test)
        }
        jvmTest.dependencies {
            // Desktop Compose runtime for the host the tests run on.
            implementation(compose.desktop.currentOs)
            implementation(libs.kotlinx.coroutines.swing)
            implementation(libs.gitlive.firebase.common.internal)
        }
    }
}

// Compose UI specs run on the JVM/desktop host only; keep them out of Android host tests.
tasks.withType<Test>().configureEach {
    if (name.contains("AndroidHostTest", ignoreCase = true)) {
        filter {
            excludeTestsMatching("*UiTest")
            isFailOnNoMatchingTests = false
        }
    }
}
