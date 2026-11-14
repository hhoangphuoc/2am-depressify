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
- **For a real project**, register an Android app in the Firebase console with the package name `app.depressify` (the `applicationId` in `androidApp/build.gradle.kts`), then create a gitignored `secrets.properties` at the repository root:
  ```properties
  firebase.projectId=your-project
  firebase.applicationId=1:1234567890:android:abcdef
  firebase.apiKey=AIza...
  # Leave empty to stop using the emulators in debug builds
  firebase.emulatorHost=
  ```

iOS reads `iosApp/iosApp/GoogleService-Info.plist` (gitignored) when it exists, and otherwise uses `demo-twoam` and the emulators. Register the iOS app with the bundle ID `app.depressify` (`BUNDLE_ID` in `iosApp/Configuration/Config.xcconfig`). The app is called Depressify on both platforms. The dashboard uses the emulators when served from `localhost`, and the deployed project's `/__/firebase/init.json` otherwise. The demo Clinician email is `DemoConfig.CLINICIAN_EMAIL` in `shared`.

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

Deploying needs a real Firebase project and a signed-in CLI (`firebase login`). Run the rules tests first, then deploy the rules with the indexes (the dashboard's latest-Digest query needs the composite index in `firestore.indexes.json`; the emulator does not check indexes):

```sh
cd firebase
firebase deploy --only firestore:rules,firestore:indexes --project <your-project-id>
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
3. Run the Android debug build (after `adb reverse`, above). The app signs in anonymously and creates the Patient record, then shows the welcome and the sharing choice. Choose **Share**: the app lands on Today and "Live patient" appears on the dashboard without a reload. **Don't share** also lands on Today, and the Patient stays off the dashboard (the security rules allow the Clinician to see a Patient only while sharing is granted). Withdrawing in Settings → Sharing and privacy removes them from the open dashboard at once. Sharing again shows what is saved from then on and what was shared before, never what was saved in between: every shared record is stamped `sharedWithClinician` when it is saved (see [the sharing stamp](docs/firestore-schema.md#the-sharing-stamp)).

Use only the `demo-twoam` project with the emulators. Do not run `firebase deploy` against it.

### Patient page

A Patient's page (`#/patient/{id}`) has four sections: **Overview** (the Attention flag level and reasons, then the Phase timeline), **Summaries**, **Signals**, and **Intake and Visits**. A menu at the top moves to each section. `firebase/hosting/js/views/patient.js` lists the slots each section has and what a block mounted into one receives.

- **Phase timeline.** Week 1 starts the day after TMS ended. Phases run from the end of TMS to the first Visit, Visit to Visit, and the last Visit to today. The weekly Mood rating (1 to 5, gaps where there is none) and each Questionnaire kind have their own lanes on one axis; "Show the timeline as a table" gives the same data as a table. Without a TMS end date the timeline uses calendar weeks and asks for the date. The arithmetic is in `js/lib/timeline.js`.
- **Visits.** Under Intake and Visits the Clinician sets the TMS end date and records or edits a Visit with an optional PHQ-2 (0 to 6) or PHQ-9 (0 to 27) score. The date cannot be in the future. Both are written straight to Firestore within the rules; a Visit never changes an Attention flag. A failed save keeps what was typed.
- **Signals.** A Phase selector (the current Phase by default, or all days) and one trend for each of the nine Signals against the Patient's own Baseline, with its unit, date range, number of days with a value and whether the data is synthetic or from the device. A missing day is a gap, never zero; fewer than 5 valid days shows "insufficient Baseline" instead of a comparison. A Signal without Consent shows nothing but that; there are also no-data and stale states (latest value more than 2 days old). Each chart has a table with the same data. The comparison stored on the daily record is used; the Baseline line is computed with `js/lib/baseline.js`, the one JavaScript copy of the rule (the seed re-exports it) and pinned by the shared fixture. The arithmetic is in `js/lib/signals.js`.
- **Summaries.** Every Summary, newest first; the selected one shows the ratings, sleep line, themes, the Suggestion, the previous Outcome, Voice cues as observations and at most three quotes. The latest also appears on the Overview. There is no transcript or audio. Helpers: `js/lib/summaries.js`.
- **What seems to help.** On the Overview: each kind of Suggestion answered about in the last 28 days, how many times, and how the Patient said it felt (counts of "felt better", "about the same" and so on). Only Suggestions with an Outcome score count; kinds are ordered by mean Outcome score, then count, but no score or percentage is shown. Helpers: `js/lib/what-helps.js`.
- **Copy.** `test/copy.test.mjs` fails if `index.html` or anything under `js/` contains "diagnosis", "treatment" or "risk score".

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
### Weekly Digest

The Patient page shows the latest weekly Digest: the dates it covers, how many Summaries it drew on, when it was generated, and a short account written from that week's Summaries and Signals. Two functions write it to `patients/{id}/digests/{isoWeek}` (for example `2026-W46`):

| Function | Trigger | Covers |
|---|---|---|
| `weeklyDigest` | Mondays 07:00 Europe/Helsinki | The previous ISO week, Monday to Sunday, for every Patient who is sharing |
| `generateDigest` | "Generate now" on the dashboard, Clinician only: `{patientId}` → `{digest}` | The current ISO week from Monday to today; pressing it again overwrites that week |

Both call the text model with storage off and need the `GEMINI_API_KEY` secret. A week with no Check-ins is written from fixed copy without calling the model, so it works in the emulator; a week with Check-ins fails there with a retry, and nothing is sent to Gemini. Patients who are not sharing get no Digest. The scheduled job does not run in the emulator (it needs Pub/Sub); the emulator tests run its handler against Firestore with a fake model instead. Week semantics are in [`docs/firestore-schema.md`](docs/firestore-schema.md#digestsisoweek-digest).

## Demo Patients

One command deletes every Demo Patient (Patients marked `synthetic`) and creates the three again, with six weeks of invented history ending today (Europe/Helsinki). With the emulators running:

```sh
cd firebase/seed && npm install
npm run seed                                  # emulator at $FIRESTORE_EMULATOR_HOST or 127.0.0.1:8080
npm run seed -- --today 2026-11-14            # a fixed day, for a rehearsal
npm run seed -- --project <your-project-id>   # a real project (Application Default Credentials)
```

The same inputs (`--today`, `--seed`) give the same data. The Clinician sees `demo-declining` (red), `demo-sparse` (amber) and `demo-steady` (green), in that order. `demo-steady` stopped sharing for three days about four weeks ago, so its Signals and Summaries show a gap there: what was saved while not sharing stays hidden from the Clinician. Live Patients are never touched. Needs Node 22 or newer.
