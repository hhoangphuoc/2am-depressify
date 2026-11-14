# Implementation status

Status as of 14 November 2026. Covers issues #7, #8, #9, #10, #11, #12, #13, #23 and #29, plus the review decisions that followed. Terms follow [GLOSSARY.md](../GLOSSARY.md). The spec is issue #5 and the data contract is in [firestore-schema.md](firestore-schema.md).

## Scope from here on

Teammates are building the frontend (the Clinician dashboard and the Patient app screens). This repository's work now covers the **backend only**: Firestore rules, Cloud Functions, the seed, the data contract, the client data layer in `shared`, and the Gemini and Google API integrations in [research/](research/) and [context/system-design.md](context/system-design.md).

The Patient app UI now comes from `main` (PRs #33, #46 and #47) and was merged with the backend on `integrate/ui-main`; see [Patient app](#patient-app-frontend-from-main).

## Branches

Every issue has its own branch, and each branch contains everything stacked under it. `fix/review-decisions` is the tip and holds all the work.

```
main
└─ feat/7-walking-skeleton
   └─ feat/8-security-rules
      └─ feat/9-demo-patients
         └─ feat/13-intake            (merges #9)
            └─ feat/29-sharing-consent (merges #13)
               └─ feat/11-patient-overview
                  ├─ feat/10-attention-queue
                  ├─ feat/23-weekly-digest
                  └─ feat/12-signals-summaries (merges #10 and #23)
                     └─ fix/review-decisions   ← tip
```

## Backend

### Data contract

- Defined once in Kotlin (`core/.../model/Models.kt`) and mirrored by hand in `firebase/functions/src/types.ts` and `firebase/hosting/js/lib/contract.js`.
- A core JVM test exports the contract to `firebase/functions/test/fixtures/contract.json`, and the functions tests fail if any copy drifts from it.
- Rules for every value: timestamps are `*AtMillis` epoch milliseconds, dates are `yyyy-MM-dd`, enumerations are lower-case words, and missing values are written as explicit nulls, never zero.
- Records the Clinician can read carry a `sharedWithClinician` stamp (see Sharing below).
- The frontend merges against this contract. Change all three copies together and regenerate `contract.json` with `./gradlew :core:jvmTest`.

### Firestore security rules (`firebase/firestore.rules`)

| Who | Can do |
|---|---|
| Patient | Reads their own record and every collection under it. |
| | Writes `daily`, `consents`, `checkIns` (timing only) and `suggestions` (status and booked only). |
| | Raises flags but never lowers them. |
| | Can't write Summaries, Visits, Digests, ratings, Voice cues, the crisis marker or Outcome fields. |
| Clinician (email matches `clinicianEmail` and sharing is `granted`) | Reads only records stamped `sharedWithClinician == true`. |
| | Writes Visits, the TMS end date and the display name. |
| | Clears a flag by setting `clearedAtMillis` only, and can reset the Patient's level and reasons. |
| Anyone signed in, on a Patient marked synthetic | The Patient's access (demo shortcut). |
| Patient, creating their record | Links only to a Clinician whose email has a document in `clinicians` (the allowlist). |
| Everyone | No client reads or writes `mail` or `clinicians`. Signed-out users read nothing. |

The Clinician's email is configuration, never code: the rules check the `clinicians/{email}` allowlist, which only the Admin SDK writes (`npm run allow-clinician`, and the seed for the Clinician it seeds for). The app reads the email from `secrets.properties` (Android) or `Secrets.plist` (iOS).

Not enforced for the demo: `email_verified`. Production must require it (see the comment in the rules).

### Sharing (issue #29 and the review decisions)

- **The gate.** Without sharing Consent the Clinician can read nothing for that Patient. Withdrawing sharing takes effect at once.
- **Future sharing only.** Each record is stamped when it is first written with whether sharing was on at that moment, and the stamp never changes.
  - The Clinician never sees records saved while sharing was off.
  - Records from earlier sharing periods become visible again when the Patient shares again.
- **Helpers for functions:** `isSharingActive(patient)` and `sharingStamp(patient)` in `src/sharing.ts`.
  - The red flag alert (#22) and the silence check (#28) must skip Patients who aren't sharing.
  - Every function that writes must stamp what it writes.
- **Flag level on the Patient record:** `flagLevel` and `flagReasons` count only flags stamped `true`, so a flag raised while sharing was off doesn't leak its reason to the Clinician.

### Cloud Functions (`firebase/functions`, TypeScript, region `europe-north1`)

| Function in [system design](context/system-design.md#cloud-functions) | Status | Notes |
|---|---|---|
| Extract Intake | **Built:** `extractIntake` and `saveIntake` (#13) | Clinician-only callables. Extraction writes nothing; saving writes only `intakeHighlights` (at most 120 words). The report is never stored or logged, and a spy test checks this. |
| Weekly Digest | **Built:** `weeklyDigest` (Mondays 07:00 Helsinki) and `generateDigest` (callable) (#23) | Document key is the ISO week (`2026-W46`). Uses only shared records. A week with no Check-ins gets fixed text and never calls the model. Patients who aren't sharing get no Digest. |
| Start Check-in (Live token) | Not built | #14, blocked by #6 (spike results) |
| Finish Check-in | Not built | #14 and #20. It will be the only writer of Summaries, ratings, Voice cues, the crisis marker and Outcome fields. |
| Map tool | Not built | #18 |
| Red flag alert | Not built | #22 |
| Silence check | Not built | #28 |

There is also a trivial `health` endpoint.

### Seed (`firebase/seed`)

`npm run seed` deletes and recreates three Demo Patients with 42 days of synthetic history ending today:

| Patient | Profile |
|---|---|
| `demo-steady` | Green. Its history includes a 3-day pause in sharing, to show the hidden off period. |
| `demo-declining` | Amber flags, then red. |
| `demo-sparse` | Few Check-ins and missing days stored as null. |

- **Deterministic:** pass `--today` and `--seed` to get the same data every time.
- **Target:** the emulator by default; pass `--project <id>` for a real project.
- **Clinician:** `--clinician <email>` or `CLINICIAN_EMAIL`. Only the emulator falls back to the placeholder `clinician@example.com`; a real project must be given the email and refuses the placeholder. The seed also adds that Clinician to the `clinicians` allowlist.
- **`npm run allow-clinician -- --email <email> [--project <id>]`** adds a Clinician to the allowlist, with the same targeting rules.
- **Shared Baseline fixture:** `fixtures/baseline/baseline-cases.json`, with a 14-day median, at least 5 valid days, and a floor on the spread. The seed and the dashboard check it now, and #16 must check it from Kotlin.

### Configuration for a real project

- **Clinician's email:** never in code (the repository is public). Android reads `demo.clinicianEmail` from `secrets.properties` into `BuildConfig.CLINICIAN_EMAIL`; iOS reads `ClinicianEmail` from `iosApp/Depressify/Secrets.plist`. Both pass it into `shared` as `DemoConfig` through Koin. Only the emulator falls back to `clinician@example.com`.
- **App id:** `app.depressify.patient` on Android (`applicationId`) and iOS (`PRODUCT_BUNDLE_IDENTIFIER` in `iosApp/project.yml`), the frontend team's id; the app is called Depressify. The Android app `app.depressify.patient` is registered in `junction26hel-7400`, and `firebase.applicationId` in `secrets.properties` is its App ID. The earlier registration for `app.depressify` is no longer used. The iOS app still has to be registered with `app.depressify.patient` before an iOS build can use the real project.
- **Setup steps:** "Set up a real Firebase project" in the [README](../README.md#set-up-a-real-firebase-project).

## Gemini and Google API integrations

| Service ([research](research/)) | Status | Where |
|---|---|---|
| Gemini Interactions API, text model `gemini-4-hydrogen` with `store: false` | **Integrated** for Intake and Digest | `src/gemini.ts`: `@google/genai` 3.3.0, `TextModelClient` interface, 15-second timeout, `GEMINI_API_KEY` set through `defineSecret`. The tests use a fake client; a real call has not been made yet because there is no API key. |
| Gemini Live, plus ephemeral tokens (`POST /v1beta/auth_tokens`) | Not started | The phone connects directly (ADR 0002). The backend part is the token-minting callable (#14), which waits on #6's recorded request shapes. |
| Gemini Decisions API (`gemini-decision-1`) | Not started | Finish Check-in's three yes/no questions (#20) |
| Maps agent tools (weather, text search, routes) | Not started | #18 |
| Google Calendar API v3 | Not started | #19. Permission is granted on the phone. |
| Health Connect and HealthKit | Not started | Read on the phone (ADR 0003), so there is no backend part beyond the `daily` contract. |
| Trigger Email extension (`mail` collection) | Not started | #22. The rules already reserve `mail` for functions. |

## Patient app (frontend from main)

The Patient app UI is the frontend team's (PRs #33, #46, #47): `shared` in package `app.depressify.shared` (`DepressifyApp`, `screens`, `state/PatientViewModel`, `ui`, `voice`), `androidApp` (`app.depressify.android.MainActivity`), and the SwiftUI host in `iosApp/Depressify` built with XcodeGen from `iosApp/project.yml`. Our first-pass Compose screens, theme, shell and their UI tests, and our `iosApp/iosApp.xcodeproj`, were removed in the merge.

### The client data layer

UI-free, in `shared` under `app.depressify.shared`:

| Package | What it holds |
|---|---|
| `data`, `data.firebase` | `AuthGateway`, `PatientStore`, `ConsentStore` and their GitLive Firebase implementations; `FirebaseEmulators` |
| `session` | `PatientSession` (anonymous sign-in, then the Patient record linked to the configured Clinician), `PatientStartup` (runs it as `StartupState` with a retry), `PatientBackend` (what the app state needs), `StartupCopy` |
| `sharing` | `SharingController` (sharing Consent and the ratings and Voice cues Consents, saved and never assumed), `SharingCopy` (vetted wording, including the share-again and withdrawal notes the screens could adopt) |
| `config`, `di` | `DemoConfig` (the Clinician's email) and the Koin modules |

The platform entry points start Firebase, then Koin: `DepressifyApplication` on Android (from `BuildConfig`, fed by `secrets.properties`) and `startCompanion(...)` from `iosApp/Depressify/iOSApp.swift` (from `GoogleService-Info.plist` and `Secrets.plist`, or the `demo-twoam` emulators). `DepressifyApp` builds `PatientViewModel(PatientBackend.fromKoinOrNull())`; without Koin (previews, tests) the app runs on `DemoData` only.

### Wired to the backend

- **App start.** `PatientViewModel` runs `PatientSession` on start: anonymous sign-in, then the Patient record linked to `DemoConfig.clinicianEmail` if it is missing. It exposes `startupState` (`Disabled`, `Starting`, `Failed(message)`, `Ready`) and `retryStartup()`.
- **First use.** A Patient whose `sharingConsent` is `undecided` is sent to the Welcome on start (only from the untouched Today, in the Everyday scenario). **Share my progress** and **Continue without sharing** on the Sharing screen save `granted` or `declined` (the record and `consents/sharing` in one transaction). **Explore the demo** on the Welcome records nothing, so the Welcome shows again next time.
- **Sharing & privacy.** **Share future progress** and **Stop sharing** (after the app's own confirmation sheet) save the choice. The switch and the notice change only once the server accepts it; a failed save keeps the stored choice and the notice says why (`SharingCopy.saveFailed`).
- **Ratings and Voice observations Signals.** Allow and Stop and delete save `consents/ratings` and `consents/voice_cues`, and the stored values are shown once loaded. A failed save puts back the stored value with `SharingCopy.purposeSaveFailed` as the notice.
- `PatientViewModelBackendTest` covers these with fakes.

**For the UI team: start-up has no place in the UI yet.** `vm.startupState` is in the ViewModel only. Nothing is shown while it is `Starting`, and a `Failed` start leaves the app on demo data with nothing saved. A screen or banner should show `StartupCopy.STARTING` while starting and, on `Failed(message)`, the message with a `StartupCopy.RETRY` button that calls `vm.retryStartup()`.

### Still on `DemoData`

| Screen | What still comes from `DemoData` or local state | What will replace it |
|---|---|---|
| Today | Patient name, today's date, the week bar and History, the nearby places map | `displayName` from the Patient record (already loaded in `StartedPatient`); `checkIns` and `summaries` under the Patient (written by Finish Check-in, #14/#20); the map tool (#18) |
| History, Summary | `DemoData.history` (Summaries, ratings trend) | A listener on `patients/{id}/summaries` (and `checkIns` for ratings), written only by Finish Check-in (#14/#20) |
| Check-in intro, Check-in (voice and typed), Ratings, Finishing | `ScriptedLiveSession` and a local Summary built in `makeSummary` | Gemini Live with the token from the Start Check-in callable (#14, blocked on #6); Finish Check-in writes the Summary, ratings, Voice cues and Suggestion (#14/#20) |
| Suggestion, booking sheet | The fixed walk Suggestion and a demo calendar | `patients/{id}/suggestions` (the Patient may write `status` and `booked`); Google Calendar (#19) |
| Signals, Signal (device Signals) | Consents for Sleep, Steps, heart rate, HRV, Time at home, Movement radius, Calendar, Late-night screen; all readings | `consents/{signalKey}` through `ConsentStore` (map `SignalId` to the contract's `Signal.key`) and `daily` records from Health Connect and HealthKit (#19), with Baseline comparisons |
| Quiet hours | Local state | `quietHoursStart` and `quietHoursEnd` on the Patient record (the rules allow the Patient to update them); Nudges on the phone (#20) |
| Sharing (first use), Sharing & privacy | The Clinician's name `DemoData.ClinicianName` ("Fictional demo Clinician") and the sample Summary | `StartedPatient.patient.clinicianEmail` until the Invite brings a name. The choice itself is wired. |
| Crisis, Support | Simulated dialler and Clinician notice | The Crisis notice (#12) raising a `crisis` flag; the red flag email (#22) |
| Demo sheet | Prototype scenarios and theme | Stays a demo control |

### Two `core` packages

`core` holds the data contract in `app.depressify.core.model` (mirrored in TypeScript, guarded by `contract.json`) and the frontend's rules in `app.depressify.core` (`CheckIn`, `Schedule`, `Signals`, tested by `CoreRulesTest`). They are kept apart for now. Follow-ups where they overlap:

- **Baseline.** `app.depressify.core.Baseline` (median of the previous 14 days, at least 5 valid days) is a second copy of the rule pinned by `fixtures/baseline/baseline-cases.json`, without the spread floor or the comparison. #16 should make the Kotlin Baseline read that fixture and keep one implementation.
- **Signals.** `SignalId` (11 entries, including Ratings and Voice observations) and the contract's `Signal` (9 keys) need one mapping, used for `consents/{signalKey}` and `daily`.
- **Check-ins.** `Summary`, `Ratings`, `Outcome` and `SuggestionKind` exist in both, with different shapes and enum spellings; the screens should read the contract's types once Summaries come from Firestore.
- **Quiet hours.** `QuietHours`/`LocalMinutes` and the record's `quietHoursStart`/`quietHoursEnd`.

### Clinician dashboard

The dashboard in `firebase/hosting` (plain JS with the Firebase JS SDK) was built in the first pass and is unchanged by the merge: sign-in, a live Patient list sorted by Attention flag with search and a level filter, the red-flag banner with an optional sound, flag detail and "Clear after follow-up", and the Patient page in four sections. `firebase/hosting/js/lib/*` holds pure, tested helpers; dashboard queries go through `patientCollectionQuery` in `js/lib/sharing.js`, which adds the sharing-stamp filter the rules require. The `design/clinician` prototype is the frontend team's design for it.

## Verification

Results on `integrate/ui-main` (the backend merged with the frontend from `main`), all from local runs:

| Suite | Command | Result |
|---|---|---|
| Kotlin `core` (contract and `CoreRulesTest`) | `./gradlew :core:jvmTest` | 24 pass |
| Kotlin `shared` common tests on the Android host | `./gradlew :shared:testAndroidHostTest` | 51 pass |
| Android build | `./gradlew :androidApp:assembleDebug` | APK builds; `BuildConfig` has `app.depressify.patient` and the App ID from `secrets.properties` |
| iOS Kotlin and Swift | `./gradlew :shared:compileKotlinIosSimulatorArm64`; `swiftc -parse iosApp/Depressify/*.swift` | Compile and parse (Xcode not installed) |
| Functions | `cd firebase/functions && npm test` | 124 pass |
| Seed | `cd firebase/seed && npm test` | 78 pass |
| Dashboard helpers | `cd firebase/hosting && node --test` | 308 pass |
| Rules, functions and end-to-end on the emulators | `firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"` | 78 pass |
| Seed on the emulator | `... "npm --prefix seed run test:emulator"` | 14 pass |

### Live deployment (14 November 2026)

The real project `junction26hel-7400` ("Hack Junction 2026-7400", Blaze plan) is set up:

| Part | State |
|---|---|
| Firestore `(default)` in `europe-north1` | Security rules and indexes deployed. A signed-out read of a Patient or of `clinicians` gets HTTP 403. |
| Clinician allowlist | One allowed Clinician (the address is kept out of this repository). |
| Demo Patients | Seeded: 401 synthetic documents, linked to the allowed Clinician. |
| Functions in `europe-north1` | `extractIntake`, `saveIntake`, `generateDigest`, `health`. Callers can reach them; the callables refuse anyone not signed in ("Sign in to continue."). |
| `weeklyDigest` in `europe-west1` | Cloud Scheduler has no `europe-north1` location (`SCHEDULER_REGION` in `region.ts`). Not publicly invokable. |
| `GEMINI_API_KEY` secret | Set. One call with the stored key to `gemini-4-hydrogen` (storage off) answered in about 3 s. |
| Container cleanup policies | Set in both regions. |

Deploy notes:
- Cloud Build runs `npm ci` with Node 22's npm 10, so regenerate `firebase/functions/package-lock.json` with npm 10 (`npx npm@10 install`).
- The first deploy didn't grant public invoker access on the callables. It was added by hand (`allUsers` → Cloud Run Invoker) on `extractintake`, `saveintake`, `generatedigest` and `health` only.

**Not verified (needs a person, hardware or credentials):**
- A full Intake extraction or Digest through the deployed callables, signed in as the Clinician.
- The app on the S24+.
- An iOS build in Xcode (XcodeGen, the Firebase SPM packages and linking the static `Shared` framework).
- The phone-width layout on a real device.

## Decisions made in review

1. **Function-only fields.** Summaries are written only by functions. Check-in ratings, Voice cues, the crisis marker and Suggestion Outcome fields are function-only too. The Patient can't edit what the Clinician reads.
2. **Re-consent shares future records only.** Only the off period is hidden, using the sharing stamp.
3. **Ratings and Voice cues** are included until the Patient leaves them out.
4. **Clearing a flag.** The dashboard computes the new level when a flag is cleared; the rules don't check it.
5. **Region: `europe-north1` (Finland).** The real Firestore database is there, and every function runs there too. It is set once for the functions (`REGION` in `firebase/functions/src/region.ts`) and once for the dashboard (`FUNCTIONS_REGION` in `firebase/hosting/js/functions.js`); `firebase/functions/test/region.test.ts` keeps the two in step. The database location itself is chosen when the database is created, not in this repository.
6. **Values the spec didn't fix:**
   - The Baseline spread floor: `max(sample SD, 0.05 × |median|, 0.001)`.
   - A 28-day window for "what seems to help".
   - "Stale" means the latest value is more than 2 days old.

## Open items for the backend

- **Moved from the daily job:** the spec has the phone's daily job write `objectiveChange` and `outcomeScore`. These are now function-only, so Finish Check-in (#14) must compute them.
- **Last Check-in time:** `lastCheckInAtMillis` on the Patient record isn't stamped. After sharing resumes, the list can show the time of a Check-in made while not sharing (only the time).
- **Phone writers:**
  - Keep each record's stamp; never delete and recreate a record.
  - Retry a refused write with a fresh stamp, especially a crisis flag.
  - Create a new Suggestion rather than editing `kind` or `details`.
- **Still open from the spec:** whether to delete Summaries and Digests when sharing is withdrawn.
- **Blocked on #6** (needs the S24+, the Watch and an iPhone): #14–#22, #24–#28 and #30–#32.
