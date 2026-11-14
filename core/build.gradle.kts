import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Pure Kotlin rules and the Firestore data contract (core/model) shared by the app. No platform code.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvm {
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
    }
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

// The JVM tests export the contract for the TypeScript mirror (see ContractExportTest).
tasks.named<Test>("jvmTest") {
    systemProperty("contract.export", rootProject.file("firebase/functions/test/fixtures/contract.json").path)
    // The Live messages recorded in the #6 spike, for LiveProtocolFixturesTest.
    systemProperty("spike.live.fixtures", rootProject.file("fixtures/spike/live").path)
    inputs.dir(rootProject.file("fixtures/spike/live"))
    // The shared Baseline fixture, for BaselineFixtureTest (the seed and dashboard read it too).
    systemProperty("baseline.fixture", rootProject.file("fixtures/baseline/baseline-cases.json").path)
    inputs.file(rootProject.file("fixtures/baseline/baseline-cases.json"))
    // The Signal rules' thresholds and reasons, for SignalRulesFixtureTest (the seed reads it too).
    systemProperty("signal.rules.fixture", rootProject.file("fixtures/flags/signal-rules.json").path)
    inputs.file(rootProject.file("fixtures/flags/signal-rules.json"))
    // The shared Outcome fixture (#21), for OutcomeFixtureTest.
    systemProperty("outcome.fixtures", rootProject.file("fixtures/outcomes").path)
    inputs.dir(rootProject.file("fixtures/outcomes"))
}
