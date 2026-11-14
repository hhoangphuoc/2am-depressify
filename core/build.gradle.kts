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

// core/src/commonMain stays platform-free: no java, javax, android, androidx, platform or cinterop imports.
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
    // The Live messages recorded in the #6 spike, for LiveProtocolFixturesTest.
    systemProperty("spike.live.fixtures", rootProject.file("fixtures/spike/live").path)
    inputs.dir(rootProject.file("fixtures/spike/live"))
}
