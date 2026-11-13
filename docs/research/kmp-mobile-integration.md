# KMP + Android mobile integration: how the app connects to the backend and to Gemini Live

Researched 2026-11-13. Sources are the official Android knowledge base (read with the `android docs` CLI, which mirrors developer.android.com, firebase.google.com and the JetBrains KMP docs), plus kotlinlang.org, ktor.io and the kotlinx.rpc docs. Links to kotlinlang.org KMP pages are the public addresses of the JetBrains pages I read through the CLI; I did not open each public URL separately.

I ran out of time for some topics. Everything about iOS audio and background APIs, Google Play policy text, the raw Gemini Live WebSocket endpoint and Android `AudioRecord` reference details is listed under [Not verified](#not-verified) and marked "unverified" where it appears.

## 1. Versions and status

| Item | Current state | Source |
|---|---|---|
| Kotlin | 2.4.21 (released 2026-10-08) is the latest stable. | [Kotlin releases](https://kotlinlang.org/docs/releases.html) |
| Core KMP | Android, iOS, desktop JVM, server JVM, Kotlin/JS: Stable. Kotlin/Wasm web: Beta. | [Stability of supported platforms](https://kotlinlang.org/docs/multiplatform/supported-platforms.html) |
| Compose Multiplatform UI | Android, iOS, desktop: Stable. Web (Wasm): **Beta**. No stable date announced. | [Stability of supported platforms](https://kotlinlang.org/docs/multiplatform/supported-platforms.html), [FAQ](https://kotlinlang.org/docs/multiplatform/faq.html) |
| Compose Multiplatform version | 1.12.2 is the newest row in the compatibility table (built on Jetpack Compose 1.12.1). Needs Kotlin 2.1.0 or newer; no manual version alignment with Kotlin. | [Compatibility and versions](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html) |
| Compose Multiplatform minimums | Android 5.0 (API 21), iOS 14, browsers with WasmGC. | same page |
| AGP 9 | With AGP 9.0+, the KMP Gradle plugin no longer works together with `com.android.application` or `com.android.library`. The Android docs sample pins `androidGradlePlugin = "9.4.0"`. Legacy APIs can be re-enabled with `android.enableLegacyVariantApi=true` until AGP 10 (expected second half of 2026). | [AGP 9 migration](https://kotlinlang.org/docs/multiplatform/multiplatform-project-agp-9-migration.html), [Android-KMP plugin](https://developer.android.com/kotlin/multiplatform/plugin) |
| AGP 9 toolchain | Gradle 9.1+, JDK 17+, SDK Build Tools 36, KSP 2.3.1+, Compose Multiplatform 1.9.3+. Android Studio Otter 3 (2025.2.3) or newer. The matrix says IntelliJ IDEA does not support AGP 9 as of 2026.1. | JetBrains agent skill "kotlin-tooling-agp9-migration" version matrix ([repo](https://github.com/Kotlin/kotlin-agent-skills/tree/main/skills/kotlin-tooling-agp9-migration)) |
| Android-KMP library plugin | `com.android.kotlin.multiplatform.library`. Single variant (no build types or flavors), no `BuildConfig`, tests off by default, configured in `kotlin { android { } }`. Minimum AGP 8.10.0 and KGP 2.0.0. | [Android-KMP plugin](https://developer.android.com/kotlin/multiplatform/plugin) |

### Project template

Use the Kotlin Multiplatform wizard in IntelliJ IDEA or Android Studio (Kotlin Multiplatform IDE plugin). Select Android, iOS, Web and Server, and keep "Share UI" on. ([Quickstart](https://kotlinlang.org/docs/multiplatform/quickstart.html))

The module names changed from the older `composeApp` layout. The wizard now generates:

| Module | Role |
|---|---|
| `shared` | Code shared between client platforms, compiled for each target |
| `androidApp` | Android application entry point |
| `iosApp` | Xcode project; uses `shared` as a framework |
| `webApp` | Web app, both Kotlin/JS and Kotlin/Wasm run configurations |
| `desktopApp` | Desktop JVM app (comes with Compose Hot Reload; JetBrains suggests adding it just to iterate on UI faster) |
| `server` | Server endpoint |
| `core` | Code shared between server and clients (models, validation) |

When Server is selected, the IDE groups the app entry points under an `app` folder. ([Quickstart](https://kotlinlang.org/docs/multiplatform/quickstart.html), [Recommended project structure](https://kotlinlang.org/docs/multiplatform/multiplatform-project-recommended-structure.html))

Separating the Android entry point from shared code is mandatory with AGP 9. A single `composeApp` module holding both the app and shared code is the old structure. ([Recommended project structure](https://kotlinlang.org/docs/multiplatform/multiplatform-project-recommended-structure.html))

The quickstart also mentions "Kotlin Toolchain", a JetBrains CLI build tool for brand-new KMP projects. I did not evaluate it.

## 2. Recommended architecture

### What to share

- JetBrains: each app entry point lives in its own module; shared code splits into business logic and UI. If every app uses the shared UI, one `shared` module is enough. If any app has native UI, split into `sharedLogic` and `sharedUI` so native apps do not pull in Compose Multiplatform. ([Recommended project structure](https://kotlinlang.org/docs/multiplatform/multiplatform-project-recommended-structure.html))
- Google: KMP is "officially supported by Google for sharing business logic between Android and iOS"; UI sharing is through JetBrains' Compose Multiplatform. ([Android KMP overview](https://developer.android.com/kotlin/multiplatform))
- The AndroidX ViewModel is positioned as the contract between shared logic and UI. It can live in `commonMain`. ([ViewModel for KMP](https://developer.android.com/kotlin/multiplatform/viewmodel))

For this product: put models and validation in `core`; put networking, repositories, ViewModels and Compose UI in `shared`; keep audio, camera, Health Connect, location, notifications and background work in platform source sets behind interfaces.

### expect/actual

- `expect`/`actual` functions and properties suit simple cases.
- For anything larger, JetBrains recommends a common **interface** with platform implementations, supplied by an `expect` factory function, by the entry points, or by a DI framework.
- `expect`/`actual` **classes are Beta**, and the compiler warns about it. Using them where interfaces would do is "not recommended".

Sources: [Expected and actual declarations](https://kotlinlang.org/docs/multiplatform/multiplatform-expect-actual.html), [Use platform-specific APIs](https://kotlinlang.org/docs/multiplatform/multiplatform-connect-to-apis.html).

### AndroidX KMP libraries and target support

From the table on the [Android KMP overview](https://developer.android.com/kotlin/multiplatform) (latest releases as listed there, October 2026). "Google" means the artifact is built by Android, "JetBrains" means JetBrains publishes the non-Android artifacts.

| Library | Latest stable | Android | iOS | JVM | Web |
|---|---|---|---|---|---|
| lifecycle / viewModel | 2.11.0 | Google | Google | Google | Google |
| viewModel-compose | 2.11.0 | Google | JetBrains | JetBrains | JetBrains |
| navigation (Nav 2) | 2.10.2 | Google | JetBrains | JetBrains | JetBrains |
| navigation3 | 1.2.0 | Google | JetBrains | JetBrains | JetBrains |
| datastore | 1.3.0 | Google | Google | Google | Google |
| room | 2.8.5 | Google | Google | Google | **not supported** |
| sqlite | 2.7.1 | Google | Google | Google | Google |
| paging | 3.5.3 | Google | Google | Google | Google |
| savedstate | 1.5.0 | Google | Google | Google | Google |

Gotchas:

- **Room has no web target** in that table. A shared local database would not compile for the clinician web app.
- The Room KMP setup page now shows `androidx.room3` at `3.1.0-alpha03` with KSP and `BundledSQLiteDriver`, while the overview table lists Room 2.8.5 as the latest release. Decide which line to use before starting. ([Room KMP](https://developer.android.com/kotlin/multiplatform/room))
- Only **Preferences** DataStore is supported in KMP. Artifacts: `androidx.datastore:datastore-core` and `datastore-preferences-core` 1.3.0. Instance creation is per platform. ([DataStore KMP](https://developer.android.com/kotlin/multiplatform/datastore))
- ViewModel: `androidx.lifecycle:lifecycle-viewmodel`, declared as `api` in `commonMain`. ([ViewModel KMP](https://developer.android.com/kotlin/multiplatform/viewmodel))
- Jetpack's own support tiers put **JavaScript and WASM in Tier 3**: untested on CI, no source or binary compatibility tracking. Android, JVM and iOS are Tier 1. ([Android KMP overview](https://developer.android.com/kotlin/multiplatform))

## 3. One codebase for the patient app and the clinician web dashboard?

It is technically possible: the wizard generates a `webApp` module that reuses `shared` UI and logic and runs as Kotlin/Wasm or Kotlin/JS.

What JetBrains says about the trade-offs:

- Compose Multiplatform for web on Wasm is Beta: "almost done", changes still possible, no stable date. ([FAQ](https://kotlinlang.org/docs/multiplatform/faq.html))
- It needs browsers with WasmGC support. ([Compatibility and versions](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html))
- JetBrains moved its Compose effort from JS Canvas to Wasm because of resource constraints. Kotlin/JS itself is Stable. ([FAQ](https://kotlinlang.org/docs/multiplatform/faq.html))
- Compose HTML is a separate DOM library for Kotlin/JS and "not intended for sharing UIs across platforms". ([FAQ](https://kotlinlang.org/docs/multiplatform/faq.html))

Options:

| Option | Shares | Risk |
|---|---|---|
| Compose Multiplatform web (`webApp`, Wasm) | UI, ViewModels, networking, models | Beta; Jetpack libraries are Tier 3 on web; no Room |
| Kotlin/JS or Wasm web app using `core` only, with its own UI | Models, validation, API client | Second UI codebase; needs the `sharedLogic`/`sharedUI` split |
| Plain web frontend (any framework) against the Ktor API | Nothing in Kotlin, only the HTTP contract | Duplicate models |

I found no JetBrains statement on canvas rendering versus DOM for dashboards (accessibility, SEO, tables). That comparison is unverified.

## 4. Backend in Kotlin

- The wizard's `server` module plus `core` is the JetBrains-recommended way to share models and validation between server and clients. ([Recommended project structure](https://kotlinlang.org/docs/multiplatform/multiplatform-project-recommended-structure.html))
- Server-side JVM is a Stable KMP platform. ([Stability of supported platforms](https://kotlinlang.org/docs/multiplatform/supported-platforms.html))
- The current Ktor docs are for version **3.6.1**. ([Ktor client engines](https://ktor.io/docs/client-engines.html)) The JetBrains matrix recommends kotlinx.serialization 1.8.0+ and coroutines 1.10.0+ as minimums; I did not confirm their latest versions.

### Ktor client engines and WebSockets

Per the platform and "HTTP/2 and WebSockets" tables on the [Ktor client engines page](https://ktor.io/docs/client-engines.html):

| Engine | Platform | WebSockets | Note |
|---|---|---|---|
| OkHttp | Android, JVM | Yes | Also supports HTTP/2 |
| Darwin | iOS | Yes | Uses `NSURLSession`; supports HTTP/2 |
| CIO | JVM, Android, Native, JavaScript, WasmJs | Yes | No HTTP/2 |
| Js | JavaScript | Yes | Also supports HTTP/2 |
| Android (`HttpURLConnection`) | JVM, Android | **No** | Do not pick this engine for the voice path |

So a raw WebSocket to Gemini Live or to our own backend can be written once in `commonMain`. For the `wasmJs` target the platform table lists only CIO. The client WebSockets plugin setup (dependency name, ping settings per engine) was not checked.

### kotlinx.rpc

The latest release is **0.10.4**. The repository carries the **Kotlin Experimental** badge, and gRPC support for KMP is in preview. It relies on a compiler plugin whose artifacts are tied to the Kotlin version (for example `2.4.20-0.10.4`). ([kotlinx.rpc versions](https://kotlin.github.io/kotlinx-rpc/versions.html), [README](https://github.com/Kotlin/kotlinx-rpc)) Plain Ktor routes with kotlinx.serialization models in `core` are the lower-risk path.

## 5. Gemini Live and real-time audio

### Two ways to reach Gemini Live

| Path | What it is | Auth | Status |
|---|---|---|---|
| Firebase AI Logic SDK | Android: `com.google.firebase:firebase-ai` through the Firebase BoM (docs show `firebase-bom:35.1.0`). Key classes: `Firebase.ai(backend = GenerativeBackend.googleAI()).liveModel(...)`, `LiveSession`, `session.startAudioConversation()`. Swift: `FirebaseAI.firebaseAI(backend: .googleAI()).liveModel(...)`. Called directly from the app, no backend needed. | Firebase project config plus **App Check**, which is enforced automatically for AI Logic set up through the console since early July 2026. Debug provider for local builds, Play Integrity for release. | **Developer preview**, no SLA, breaking changes possible |
| Raw WebSocket | The Firebase page points to the Gemini Developer API Live reference at [ai.google.dev/api/live](https://ai.google.dev/api/live). Could be driven from shared code with Ktor WebSockets. | Unverified (API key, or an ephemeral token minted by the backend) | Unverified |

Sources: [Gemini Live API on Android](https://developer.android.com/ai/gemini/live), [Firebase AI Logic Live API](https://firebase.google.com/docs/ai-logic/live-api), [Limits and specs](https://firebase.google.com/docs/ai-logic/live-api/limits-and-specs).

Facts that shape the design:

- **Models** on the Gemini Developer API: `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-preview-12-2025`, `gemini-2.5-flash-native-audio-preview-09-2025`. All are preview models, and the Firebase page says they are available on the Gemini Developer API free tier. ([Firebase Live API](https://firebase.google.com/docs/ai-logic/live-api))
- On Agent Platform (formerly Vertex AI): `gemini-live-2.5-flash-native-audio` and a 09-2025 preview. No Live 3.x models there, and the 2.5 Live models are not available in the `global` location. Limits: 1,000 concurrent sessions per project and 4M tokens per minute. EU region availability was not checked.
- **Audio format**: input is raw 16-bit PCM, 16 kHz, little-endian, sent with MIME `audio/pcm;rate=16000`. Output is raw 16-bit PCM, 24 kHz, little-endian.
- **Video**: discrete image frames at 1 frame per second, 768x768 recommended.
- **Session limits**: 128k-token context. About 15 minutes for audio-only input, about 2 minutes for audio plus video. A connection lasts about 10 minutes, with a "going away" notice about 60 seconds before it ends. Context compression and session resumption exist to work around these.
- **Tools**: function calling, Grounding with Google Search, Grounding with Google Maps. No structured (JSON) output and no Count Tokens.
- On Android, function calls are handled by a handler passed to `startAudioConversation(::handler)`, which receives a `FunctionCallPart` and returns a `FunctionResponsePart`. Tools run **on the device** on this path.
- The Android page says of the SDK conversation: "it doesn't handle interruptions".
- Requires API level 23+ and the `RECORD_AUDIO` permission.
- I found no KMP (common) artifact for Firebase AI Logic. The docs show separate Kotlin/Java and Swift SDKs. In a KMP app, each SDK would sit behind a common interface.

Calling a paid AI API from a mobile client with a static key is the pattern Android's security guidance warns against: the key can be extracted and used to run up cost. It recommends short-lived dynamic tokens (about one hour). ([Insecure API usage](https://developer.android.com/privacy-and-security/risks/insecure-api-usage)) App Check, or tokens issued by our backend, is the mitigation.

### Android audio

- With the Firebase SDK, `startAudioConversation()` handles capture and playback. A custom `AudioRecord`/`AudioTrack` pipeline is only needed on the raw WebSocket path.
- Only apps in the foreground, or running a foreground service, can capture audio; otherwise the app receives silence (Android 9+). `VOICE_COMMUNICATION` is a "privacy-sensitive" source with higher capture priority. Two ordinary apps can never capture at the same time. ([Sharing audio input](https://developer.android.com/media/platform/sharing-audio-input))
- Foreground service type `microphone`: declare `android:foregroundServiceType="microphone"` and the `FOREGROUND_SERVICE_MICROPHONE` permission, pass `FOREGROUND_SERVICE_TYPE_MICROPHONE` to `startForeground()`, and hold `RECORD_AUDIO`. Service types are mandatory when targeting Android 14+. ([Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types), [FGS changes](https://developer.android.com/develop/background-work/services/fgs/changes))
- **A microphone foreground service cannot be started while the app is in the background, or from `BOOT_COMPLETED`** (while-in-use restriction, few exemptions). The agent cannot start listening by itself.
- **Android 17** restricts background audio playback and audio focus requests to apps with a visible activity or a non-`SHORT_SERVICE` foreground service. Apps targeting API 37 also need the service to have while-in-use capability. Outside those states playback fails silently and focus returns `AUDIOFOCUS_REQUEST_FAILED`. ([Background audio hardening](https://developer.android.com/about/versions/17/changes/bg-audio))
- Audio focus guidance: [Manage audio focus](https://developer.android.com/media/optimize/audio-focus). Fetched but not read in detail.
- Unverified from primary sources: exact `AudioRecord` parameters, `AcousticEchoCanceler` behaviour, and `AudioTrack` low-latency settings.

### iOS audio

Unverified. The expected approach is `AVAudioEngine` with voice processing and an `AVAudioSession` in play-and-record mode, written in `iosMain` through Kotlin/Native interop or in Swift and injected. I did not reach Apple's documentation.

### Exposing audio to shared code

Following the JetBrains guidance in section 2, define a common interface and implement it per platform. A sketch (my own, not from a doc):

```kotlin
// commonMain
interface VoiceSession {
    val events: Flow<VoiceEvent>   // transcripts, tool calls, state
    suspend fun start()
    suspend fun stop()
}
expect fun createVoiceSession(): VoiceSession
```

If the Firebase SDK is used, the interface wraps `LiveSession` on each platform. If the raw WebSocket is used, the interface shrinks to a PCM source and a PCM sink, and the session logic moves to `commonMain` on Ktor.

### Camera frames

CameraX `ImageAnalysis` delivers frames to an analyzer in `YUV_420_888` (default) or `RGBA_8888`. `STRATEGY_KEEP_ONLY_LATEST` drops stale frames, which fits the Live API's 1 FPS input. Frames must be encoded to JPEG or PNG before sending. ([CameraX image analysis](https://developer.android.com/media/camera/camerax/analyze)) A `camera` foreground service has the same while-in-use restriction as the microphone. Video also cuts the session to about 2 minutes.

## 6. Proactive behaviour

| Mechanism | What it can do | Limits | Source |
|---|---|---|---|
| WorkManager periodic work | Refresh context (weather, calendar, health) and post a local notification | Minimum interval 15 minutes. Deferred by Doze and standby buckets. | [Define work requests](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work) |
| WorkManager expedited work | Short, important tasks that start at once | Subject to a per-app quota when in the background | same page |
| App Standby Buckets | n/a | Active, working set, frequent, rare, restricted. In the restricted bucket jobs run once a day in a 10-minute batch. Vendors set their own bucket rules. | [App Standby Buckets](https://developer.android.com/topic/performance/appstandby) |
| Doze | n/a | Suspends network; defers jobs, syncs and standard alarms to maintenance windows. `setAndAllowWhileIdle()` and `setExactAndAllowWhileIdle()` fire at most once per 9 minutes per app. | [Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby) |
| Exact alarms | Check-in at a precise time | `SCHEDULE_EXACT_ALARM` is denied by default for newly installed apps targeting Android 13+ on Android 14, and the user must grant it in settings. `USE_EXACT_ALARM` is only for calendar and alarm clock apps under Play policy. Docs say most apps should use inexact alarms. | [Exact alarm changes](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms), [Alarms](https://developer.android.com/develop/background-work/services/alarms) |
| FCM push | Backend decides when to check in and pushes a notification | High-priority messages wake the device in Doze. Only a few seconds are available in `onMessageReceived`; hand longer work to WorkManager. High priority is meant for user-visible messages and gets deprioritized otherwise. | [FCM Android message priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority) |
| Notification permission | n/a | `POST_NOTIFICATIONS` is a runtime permission on Android 13+. | [Notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission) |

FCM has a newer `AndroidConfigV2` (`message.android_v2`): `RemoteNotification` for user-visible, time-sensitive messages (delivered without intended delay, bypassing Doze) and `BackgroundSync` for non-urgent data. The Doze page calls v1 deprecated and recommends migrating. ([FCM priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority), [Doze](https://developer.android.com/training/monitoring-device-state/doze-standby))

What a "proactive check-in" can realistically be:

1. The backend, which holds the patient context, decides it is time and sends an FCM `RemoteNotification`.
2. The patient taps the notification.
3. The app opens and starts the voice session in the foreground.

The agent cannot open the microphone or start speaking on its own from the background (see section 5). Device-side WorkManager jobs are a secondary path for syncing on-device data such as Health Connect to the backend.

Android 16 change: jobs started from a foreground service now follow normal job quotas. ([FGS changes](https://developer.android.com/develop/background-work/services/fgs/changes))

iOS background limits (BGTaskScheduler, APNs, local notifications) are unverified. FCM delivers to iOS through APNs; the same push-then-tap pattern should apply.

## 7. Permissions, location, health, token storage

| Area | Facts | Source |
|---|---|---|
| Microphone | `RECORD_AUDIO` runtime permission, while-in-use only | [FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types) |
| Location | Fused Location Provider in Google Play services: `getLastLocation()` is fast and cheap but may be stale; `getCurrentLocation()` is fresher. Request foreground location only. | [Retrieve current location](https://developer.android.com/develop/sensors-and-location/location/retrieve-current) |
| Background location | `ACCESS_BACKGROUND_LOCATION` is restricted by Google Play to apps whose core functionality needs it. Following best practices does not guarantee approval. | [Access location in the background](https://developer.android.com/develop/sensors-and-location/location/background) |
| Health Connect | `androidx.health.connect:connect-client` (docs show `1.2.0-alpha06`; 1.1.0+ needs `compileSdk 36`). Part of the platform from Android 14; a separate app on Android 13 and lower. Each data type has its own permission, for example `android.permission.health.READ_HEART_RATE`, and must also be declared in the Play Console. The app must show a privacy-policy rationale activity (`ACTION_SHOW_PERMISSIONS_RATIONALE`). Background reads sit behind `FEATURE_READ_HEALTH_DATA_IN_BACKGROUND`. Android only; iOS needs HealthKit. | [Health Connect get started](https://developer.android.com/health-and-fitness/health-connect/get-started) |
| Token storage | Android Keystore keeps key material out of the app process and can bind it to TEE or StrongBox hardware. Use short-lived tokens instead of static keys in the app. | [Android Keystore](https://developer.android.com/privacy-and-security/keystore), [Insecure API usage](https://developer.android.com/privacy-and-security/risks/insecure-api-usage) |

Unverified: the Google Play health apps policy and declaration form text, the status of `EncryptedSharedPreferences`, and iOS Keychain. A KMP `TokenStore` interface with a Keystore-backed Android implementation and a Keychain-backed iOS implementation is the expected shape. DataStore is not encrypted by itself.

## 8. Testing and CI at a glance

- Common tests go in `commonTest` using `kotlin.test`. They run on every target: JUnit on JVM and Android, the native runner on iOS simulators. ([Test your multiplatform app](https://kotlinlang.org/docs/multiplatform/multiplatform-run-tests.html))
- With the Android-KMP plugin, Android local tests live in `androidHostTest`. Unit and device tests are **disabled by default** and must be enabled in the `android { }` block. ([Android-KMP plugin](https://developer.android.com/kotlin/multiplatform/plugin))
- Compose Multiplatform has a common UI test API. ([Testing Compose Multiplatform UI](https://kotlinlang.org/docs/multiplatform/compose-test.html)) Fetched but not read in detail.
- CI: Android, server and web build on Linux. iOS needs macOS with Xcode. ([Quickstart](https://kotlinlang.org/docs/multiplatform/quickstart.html)) Specific Gradle task names and CI recipes were not verified.
- Health Connect has a testing library, and WorkManager has integration test support ([Health Connect unit tests](https://developer.android.com/health-and-fitness/health-connect/test/unit-tests), [WorkManager integration testing](https://developer.android.com/develop/background-work/background-tasks/testing/persistent/integration-testing)). Titles only; not read.

## Open questions

1. **Clinician dashboard**: Compose Multiplatform web (Beta, maximum reuse) or a separate web frontend against the Ktor API? For a demo, Beta risk may be acceptable.
2. **Gemini Live path**: Firebase AI Logic SDK per platform (fast, preview, tools run on the device, App Check) or a raw WebSocket from shared code or proxied through the backend (more work, but tools and the audit trail live on the server)? This decides where function calling for Places, Calendar and Weather runs.
3. **iOS for the hackathon**: build Android first and keep iOS compiling, or deliver both? iOS doubles the audio, health and push work.
4. **Local database**: none (backend is the source of truth), Room 2.8.x, or Room 3 alpha? Room excludes the web target either way.
5. **Session length**: voice sessions end at about 10 minutes per connection and 15 minutes of audio context. Do we add session resumption and context compression, or design check-ins to be short?
6. **Video**: camera input cuts the session to about 2 minutes and adds camera permission and policy work. In or out?
7. **Proactivity**: is "push notification, user taps, agent talks" acceptable, given the agent cannot start audio from the background?
8. **Health data**: which Health Connect data types? Each is a separate permission and Play Console declaration, and iOS needs a separate HealthKit path.
9. **Gemini provider**: Gemini Developer API (free tier, preview models) or Agent Platform (quotas stated, regional, no Live 3.x)? EU data residency for patient data is a product-owner decision.
10. **RPC**: plain Ktor REST and WebSocket, or kotlinx.rpc at 0.10.x?

## Not verified

- The raw Gemini Live WebSocket URL, its message names, and the ephemeral token flow. Only the reference link from the Firebase page is recorded.
- Gemini Live pricing, exact free-tier quotas, and availability in Finland/EU for either provider.
- Whether Firebase AI Logic's Live API works on the web or has any KMP artifact.
- Android `AudioRecord`/`AudioTrack` parameters, `AcousticEchoCanceler`, and audio focus details.
- Everything about iOS: `AVAudioEngine` voice processing, `AVAudioSession`, background modes, BGTaskScheduler, APNs, Keychain, HealthKit, App Store review rules.
- Google Play policy text for health apps, the health declaration form, the data safety form, and the microphone foreground service declaration.
- `EncryptedSharedPreferences` and Jetpack Security status.
- Current latest versions of kotlinx.serialization, coroutines and Gradle. Only minimums from the JetBrains AGP 9 matrix are recorded, and that matrix's IntelliJ IDEA note may be out of date.
- Ktor client WebSockets plugin setup details, and the exact browser versions that support WasmGC.
- kotlinx.rpc target list.
- The Kotlin Toolchain build tool and the web wizard at kmp.jetbrains.com.
- Compose Multiplatform web limits for dashboards (accessibility, text selection, bundle size).
- Public kotlinlang.org URLs for the JetBrains pages were derived from the knowledge-base paths and not opened individually.

