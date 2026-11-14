// `core`: pure Kotlin Multiplatform common code. No platform, Android or java.* imports in
// commonMain; the `checkCommonPurity` task below enforces that and runs with `:core:jvmTest`.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
}

kotlin {
    jvmToolchain(21)

    jvm()

    android {
        namespace = "app.depressify.core"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()
    }

    // iOS: arm64 device and arm64 simulator only (no Intel simulator).
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain.dependencies {
            api(libs.kotlinx.serialization.json)
            api(libs.kotlinx.datetime)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
        }
    }
}

val checkCommonPurity by tasks.registering {
    group = "verification"
    description = "Fails if core/src/commonMain imports platform or JVM-only APIs."
    val sources = fileTree("src/commonMain") { include("**/*.kt") }
    val moduleDir = projectDir
    inputs.files(sources)
    doLast {
        val forbidden = Regex("""^\s*import\s+(java|javax|android|androidx|platform|kotlinx\.cinterop)\.""")
        val offenders = sources.files.flatMap { file ->
            file.readLines().mapIndexedNotNull { i, line ->
                if (forbidden.containsMatchIn(line)) "${file.relativeTo(moduleDir)}:${i + 1}: ${line.trim()}" else null
            }
        }
        if (offenders.isNotEmpty()) {
            throw GradleException("core commonMain must stay platform-free:\n" + offenders.joinToString("\n"))
        }
    }
}

tasks.named("jvmTest") { dependsOn(checkCommonPurity) }
tasks.named("check") { dependsOn(checkCommonPurity) }

// The JVM tests export the contract for the TypeScript mirror (see ContractExportTest).
tasks.named<Test>("jvmTest") {
    systemProperty("contract.export", rootProject.file("firebase/functions/test/fixtures/contract.json").path)
}
