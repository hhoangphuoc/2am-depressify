# Implementation status

Status as of 14 November 2026. Covers issues #7, #8, #9, #10, #11, #12, #13, #23 and #29, plus the review decisions that followed. Terms follow [GLOSSARY.md](../GLOSSARY.md). The spec is issue #5 and the data contract is in [firestore-schema.md](firestore-schema.md).

## Scope from here on

Teammates are building the frontend (the Clinician dashboard and the Patient app screens). This repository's work now covers the **backend only**: Firestore rules, Cloud Functions, the seed, the data contract, and the Gemini and Google API integrations in [research/](research/) and [context/system-design.md](context/system-design.md).

The UI built during this pass is listed under [Frontend built in this pass](#frontend-built-in-this-pass) so the frontend team can decide what to keep when the two are merged.

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

- **Clinician's email:** never in code (the repository is public). Android reads `demo.clinicianEmail` from `secrets.properties` into `BuildConfig.CLINICIAN_EMAIL`; iOS reads `ClinicianEmail` from `iosApp/iosApp/Secrets.plist`. Both pass it into `shared` as `DemoConfig` through Koin. Only the emulator falls back to `clinician@example.com`.
- **App id:** `app.depressify` on Android and iOS; the app is called Depressify. The Kotlin packages are still `com.twoam.companion`.
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

## Frontend built in this pass

The frontend was in scope for the first pass, so these exist. Teammates may replace them; the backend doesn't depend on them.

- **Clinician dashboard** (`firebase/hosting`, plain JS with the Firebase JS SDK):
  - Sign-in, a live Patient list sorted by Attention flag, search and a level filter.
  - The red-flag banner with an optional sound, flag detail, and the "Clear after follow-up" dialog.
  - The Patient page in four sections: Overview, Summaries, Signals, and Intake and Visits.
- **Patient app** (Compose Multiplatform):
  - Anonymous sign-in on first open, the welcome and sharing-choice screens, and the three-tab shell.
  - "Sharing and privacy" in Settings.
  - Today and History are empty placeholders.

Useful for the merge:
- `firebase/hosting/js/lib/*` holds pure helpers (sorting, Phases, Baseline, series, what helps, clearing) with tests that don't depend on the UI.
- Dashboard queries go through `patientCollectionQuery` in `js/lib/sharing.js`, which adds the sharing-stamp filter the rules require.

## Verification

Results on `chore/real-project-config` (on top of `fix/review-decisions`), all from local runs:

| Suite | Command | Result |
|---|---|---|
| Kotlin `core` and `shared`, Android build | `./gradlew :core:jvmTest :shared:jvmTest :androidApp:assembleDebug` | 19 + 62 pass, APK builds |
| Functions | `cd firebase/functions && npm test` | 123 pass |
| Seed | `cd firebase/seed && npm test` | 78 pass |
| Dashboard helpers | `cd firebase/hosting && node --test` | 308 pass |
| Rules, functions and end-to-end on the emulators | `firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"` | 78 pass |
| Seed on the emulator | `... "npm --prefix seed run test:emulator"` | 14 pass |

**Not verified (needs a person, hardware or credentials):**
- Deploying to a real Firebase project.
- A real Gemini call.
- The app on the S24+.
- An iOS build in Xcode.
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
