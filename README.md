# 2am-depressify

A wellbeing companion for the time between Visits: a Kotlin Multiplatform Patient app (Android and iOS), a Firebase backend, and a plain web Clinician dashboard. The design is in [docs/context/system-design.md](docs/context/system-design.md), terms are in [GLOSSARY.md](GLOSSARY.md), and the Firestore data contract is in [docs/firestore-schema.md](docs/firestore-schema.md).

## Layout

| Path | What it is |
|---|---|
| `core/` | Pure Kotlin Multiplatform common code (JVM, Android, iOS): the data contract and, later, the decision logic. No platform or `java.*` imports. |
| `shared/` | Kotlin Multiplatform client code: Compose Multiplatform UI (Small Step theme), view models, Firebase through the GitLive SDK, Koin. |
| `androidApp/` | Android application entry point. |
| `iosApp/` | Xcode project and Swift glue. |
| `firebase/` | `firebase.json`, Firestore rules, `functions/` (TypeScript, vitest) and `hosting/` (the dashboard). |
| `gradle/libs.versions.toml` | The only place library versions are pinned. |

## Setup

- JDK 21, the Android SDK (platform 37, build tools 36), Node 22 or newer, and the Firebase CLI.
- Create `local.properties` at the repository root with `sdk.dir=/path/to/Android/sdk` (gitignored).
- Use `./gradlew` for everything Gradle.

### Firebase configuration

There is no `google-services.json` and no Google Services plugin. The Android app initialises Firebase in code (`CompanionApplication`) from `BuildConfig` fields set in `androidApp/build.gradle.kts`:

- **By default** it uses the emulator-only project `demo-twoam`, which needs no credentials, and debug builds talk to the local emulators on `127.0.0.1`. On a phone or an Android emulator, forward the ports first:
  ```sh
  adb reverse tcp:9099 tcp:9099 && adb reverse tcp:8080 tcp:8080
  ```
- **For a real project**, create a gitignored `secrets.properties` at the repository root:
  ```properties
  firebase.projectId=your-project
  firebase.applicationId=1:1234567890:android:abcdef
  firebase.apiKey=AIza...
  # Leave empty to stop using the emulators in debug builds
  firebase.emulatorHost=
  ```

iOS reads `iosApp/iosApp/GoogleService-Info.plist` (gitignored) when it exists, and otherwise uses `demo-twoam` and the emulators. The dashboard uses the emulators when served from `localhost`, and the deployed project's `/__/firebase/init.json` otherwise. The demo Clinician email is `DemoConfig.CLINICIAN_EMAIL` in `shared`.

## Build

```sh
./gradlew :androidApp:assembleDebug        # Android APK
./gradlew :androidApp:installDebug         # install on a connected phone
```

iOS: open `iosApp/iosApp.xcodeproj` in Xcode and run. The build phase calls `./gradlew :shared:embedAndSignAppleFrameworkForXcode`; Xcode resolves the Firebase iOS SDK through Swift Package Manager.

## Tests, one command per seam

| Seam | Command |
|---|---|
| 1. `core` JVM tests (data contract; later Baseline, rules, learning) | `./gradlew :core:jvmTest` |
| 2. Cloud Functions (vitest, plus a type check) | `cd firebase/functions && npm install && npm test` |
| 3. Dashboard helpers (Node test runner) | `cd firebase/hosting && node --test` |
| 4. `shared` common tests (view models, session, with fakes) | `./gradlew :shared:jvmTest` |
| 5. Compose UI tests (`*UiTest`, common UI test API on the JVM) | `./gradlew :shared:jvmTest` |

`./gradlew :core:jvmTest` also fails if `core/src/commonMain` imports a platform or JVM-only API, and it regenerates `firebase/functions/test/fixtures/contract.json`, which the functions tests compare with the TypeScript and dashboard mirrors. Commit that file when it changes.

Android host tests are switched on in `shared` and skip the `*UiTest` specs: `./gradlew :shared:testAndroidHostTest`.

Security rules and the end-to-end flow run against the emulators:

```sh
cd firebase
firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix functions run test:emulator"
```

## Run the walking skeleton locally

```sh
cd firebase/functions && npm install && npm run build && cd ..
firebase emulators:start --project demo-twoam
```

This starts Auth (9099), Firestore (8080), Functions (5001), Hosting (5002) and the Emulator UI (4000). Then:

1. Create the demo Clinician in the Auth emulator:
   ```sh
   curl -s -X POST 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key' \
     -H 'Content-Type: application/json' \
     -d '{"email":"clinician@example.com","password":"demo-password-1","returnSecureToken":true}'
   ```
2. Open http://localhost:5002 and sign in as that Clinician. The Patient list is empty.
3. Run the Android debug build (after `adb reverse`, above). The app signs in anonymously, creates the Patient record and lands on Today. "Live patient" appears on the dashboard without a reload.

Use only the `demo-twoam` project with the emulators. Do not run `firebase deploy` against it.
