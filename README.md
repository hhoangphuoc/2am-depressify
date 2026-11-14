# 2am-depressify

A wellbeing companion for the time between Visits: a Kotlin Multiplatform Patient app (Android and iOS), a Firebase backend, and a plain web Clinician dashboard. The design is in [docs/context/system-design.md](docs/context/system-design.md), terms are in [GLOSSARY.md](GLOSSARY.md), and the Firestore data contract is in [docs/firestore-schema.md](docs/firestore-schema.md).

## Layout

| Path | What it is |
|---|---|
| `core/` | Pure Kotlin Multiplatform common code (JVM, Android, iOS): the data contract and, later, the decision logic. No platform or `java.*` imports. |
| `shared/` | Kotlin Multiplatform client code: Compose Multiplatform UI (Small Step theme), view models, Firebase through the GitLive SDK, Koin. |
| `androidApp/` | Android application entry point. |
| `iosApp/` | Xcode project and Swift glue. |
| `firebase/` | `firebase.json`, Firestore rules, `functions/` (TypeScript, vitest), `hosting/` (the dashboard) and `seed/` (the Demo Patients). |
| `fixtures/` | Fixtures shared by Kotlin and Node tests, such as the Baseline cases. |
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
| 3. Seed generator and Baseline fixture (Node test runner, plus a type check) | `cd firebase/seed && npm install && npm test` |
| 4. `shared` common tests (view models, session, with fakes) | `./gradlew :shared:jvmTest` |
| 5. Compose UI tests (`*UiTest`, common UI test API on the JVM) | `./gradlew :shared:jvmTest` |

`./gradlew :core:jvmTest` also fails if `core/src/commonMain` imports a platform or JVM-only API, and it regenerates `firebase/functions/test/fixtures/contract.json`, which the functions tests compare with the TypeScript and dashboard mirrors. Commit that file when it changes.

Android host tests are switched on in `shared` and skip the `*UiTest` specs: `./gradlew :shared:testAndroidHostTest`.

Security rules and the end-to-end flow run against the emulators:

```sh
cd firebase
firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix functions run test:emulator"
firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix seed run test:emulator"
```

The rules are described, with a who-can-do-what table, in [`docs/firestore-schema.md`](docs/firestore-schema.md#security-rules).

## Deploy the security rules

Deploying needs a real Firebase project and a signed-in CLI (`firebase login`). Run the rules tests first, then:

```sh
cd firebase
firebase deploy --only firestore:rules --project <your-project-id>
```

Before a production deploy, require `email_verified` in `authEmail()` in `firestore.rules` (see the comment there) and change the demo Clinician in `linkableClinicians()` together with `DemoConfig.CLINICIAN_EMAIL` (a functions test keeps the two in step).

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
3. Run the Android debug build (after `adb reverse`, above). The app signs in anonymously and creates the Patient record, then shows the welcome and the sharing choice. Choose **Share**: the app lands on Today and "Live patient" appears on the dashboard without a reload. **Don't share** also lands on Today, and the Patient stays off the dashboard (the security rules allow the Clinician to see a Patient only while sharing is granted). Withdrawing in Settings → Sharing and privacy removes them from the open dashboard at once.

Use only the `demo-twoam` project with the emulators. Do not run `firebase deploy` against it.

### Intake

On the dashboard, open a Patient from the list (`#/patient/{id}`) to reach the Intake section. The Clinician pastes the clinical report, reviews and edits the extracted highlights (at most 120 words) and saves them. Two callables do the work, both for the Patient's Clinician only:

| Callable | Request | Response |
|---|---|---|
| `extractIntake` | `{patientId, reportText}` | `{highlights, wordCount, trimmed}`; writes nothing |
| `saveIntake` | `{patientId, highlights}` | `{intakeHighlights, wordCount}`; writes `patients/{patientId}.intakeHighlights` only |

`extractIntake` calls the text model with storage off and needs the `GEMINI_API_KEY` function secret (`firebase functions:secrets:set GEMINI_API_KEY` on a real project). The emulator has no secret, so extraction there fails with a retry and nothing is sent to Gemini. To try a real extraction locally, put `GEMINI_API_KEY=...` in `firebase/functions/.secret.local` (gitignored); the pasted text then goes to Gemini with storage off, so paste only fictional reports. The report is never stored or logged.

The emulator tests also call the Intake callables through the Functions emulator when it is running:

```sh
cd firebase/functions && npm run build && cd ..
firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"
```

The fictional Intake for the live demo Patient is in [docs/demo/intake-live-patient.md](docs/demo/intake-live-patient.md).

### Attention work queue

The Patient list shows a red banner for every uncleared red flag of the Clinician's Patients, with one reason and a "Review Patient" link. It stays until the flag is cleared; search by name and the level filter never hide it. A red flag that arrives while the dashboard is open is announced, and plays a short chime (WebAudio, no file) only after the Clinician turns on "Sound for red flags" in the header; the choice is kept in this browser.

On the Patient page, the Attention section lists open flags (level word, reason, source, raised time) and the cleared history. "Clear after follow-up" clears one flag in a transaction: it sets the flag's `clearedAtMillis` and resets the Patient's `flagLevel` and `flagReasons` to the flags still open, or green. If anything new was raised since the dialog opened, it asks for a new review instead. The logic is in `firebase/hosting/js/lib/{banner,list-filter,sound-pref,flag-detail,clear}.js`; `firebase/seed/test/emulator/attention.test.js` runs the clearing helper as the Clinician under the rules.

## Demo Patients

One command deletes every Demo Patient (Patients marked `synthetic`) and creates the three again, with six weeks of invented history ending today (Europe/Helsinki). With the emulators running:

```sh
cd firebase/seed && npm install
npm run seed                                  # emulator at $FIRESTORE_EMULATOR_HOST or 127.0.0.1:8080
npm run seed -- --today 2026-11-14            # a fixed day, for a rehearsal
npm run seed -- --project <your-project-id>   # a real project (Application Default Credentials)
```

The same inputs (`--today`, `--seed`) give the same data. The Clinician sees `demo-declining` (red), `demo-sparse` (amber) and `demo-steady` (green), in that order. Live Patients are never touched. Needs Node 22 or newer.
