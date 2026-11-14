# Implementation status

Status as of 14 November 2026. Covers issues #7, #8, #9, #10, #11, #12, #13, #23 and #29, the backend part of #22 (the red flag email), the backend half of the #6 spikes, the backend part of #14 (Start and Finish Check-in, and the Live protocol parsing in `core`), the review decisions that followed, and the backend half of the #6 spikes ([spike-results.md](spike-results.md)). Terms follow [GLOSSARY.md](../GLOSSARY.md).

## How this branch was put together

The backend was built on a stack of branches (PRs #34 to #45, tip `chore/real-project-config`) that started before the Compose Multiplatform Patient UI landed on `main`. This branch starts from `main` and keeps its Patient UI. From the stack it takes the service and API integration only:

| Taken from the stack | Where it is now |
|---|---|
| Firestore rules, indexes, Cloud Functions, the seed and the dashboard | `firebase/`, unchanged apart from the notes under [Gemini and Google API integrations](#gemini-and-google-api-integrations) |
| The data contract and its tests | `core/src/*/kotlin/app/depressify/core/model` |
| The Baseline fixture | `fixtures/baseline` |
| Firebase access for the app (sign-in, the Patient record, Consents) | `shared/.../shared/data`, wired into `PatientViewModel` |
| Firebase configuration for Android and iOS | `androidApp` (`DepressifyApplication`, `secrets.properties`), `iosApp` (`iOSApp.swift`, `project.yml`) |

Left behind: the stack's own Patient screens, theme, app shell, startup screen and Koin modules. `main`'s screens replace them.

### What the Patient app does with the backend

- On start it signs in anonymously and creates the Patient record linked to the configured Clinician. A Patient who has not chosen yet is taken to the welcome and the sharing choice.
- "Share my progress", "Continue without sharing", "Stop sharing" and "Share future progress" save the sharing Consent before the screen changes. A failed save changes nothing and shows a notice.
- "Explore the demo" records no sharing choice.
- When Firebase cannot be reached at start (no emulator, no network), the app stays on local demo data, as on `main`.
- Everything else on the Patient screens is still demo data: Check-ins, Summaries, Signals, Signal Consents, quiet hours and booking are not saved.

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
  - The red flag alert (#22, built) skips Patients who aren't sharing; the silence check (#28) must too.
  - Every function that writes must stamp what it writes.
- **Flag level on the Patient record:** `flagLevel` and `flagReasons` count only flags stamped `true`, so a flag raised while sharing was off doesn't leak its reason to the Clinician.

### Cloud Functions (`firebase/functions`, TypeScript, region `europe-north1`)

| Function in [system design](context/system-design.md#cloud-functions) | Status | Notes |
|---|---|---|
| Extract Intake | **Built:** `extractIntake` and `saveIntake` (#13) | Clinician-only callables. Extraction writes nothing; saving writes only `intakeHighlights` (at most 120 words). The report is never stored or logged, and a spy test checks this. |
| Weekly Digest | **Built:** `weeklyDigest` (Mondays 07:00 Helsinki) and `generateDigest` (callable) (#23) | Document key is the ISO week (`2026-W46`). Uses only shared records. A week with no Check-ins gets fixed text and never calls the model. Patients who aren't sharing get no Digest. |
| Start Check-in (Live token) | **Built:** `startCheckIn` (#14, backend part), callable in `europe-north1`, not deployed | Caller rule (`assertActsAsPatient` in `src/patientCaller.ts`, mirroring `actsAsPatient` in the rules): `auth.uid == patientId`, or anyone signed in when the Patient is `synthetic: true`; signed out is `unauthenticated`, anyone else or a missing Patient `permission-denied`. Request `{patientId, brief, mode?}` (Brief 1 to 12,000 characters, mode `typed` or `spoken`), response `{checkInId, token, model, endpoint, mode, connectByMillis, expiresAtMillis}`. Mints a single-use token with the recorded `bidiGenerateContentSetup` + `fieldMask` body, locked to `gemini-3.8-live`, the Brief plus fixed safety rules, the tool declarations (`src/tools.ts`, empty until #17), AUDIO output and both transcriptions; 60 s to connect, 10-minute lifetime. Creates `checkIns/{id}` (function-only fields empty, `sharingStamp`). A real mint and a typed turn on that token were checked by hand. Client contract in the [README](../README.md#check-in-start-and-finish). |
| Finish Check-in | **Built:** `finishCheckIn` (#14, backend part), callable in `europe-north1`, not deployed; Decisions (#20) and the Outcome (#21) not yet | Same caller rule as Start Check-in. Request `{patientId, checkInId, draft, todayLines?, lastSuggestionId?}`, response `{checkInId, summary, minimal}`; a Check-in Start Check-in never created is `not-found`. Text model with storage off and structured output; writes the Summary (keyed by the Check-in, a retry overwrites, stamp kept), the ratings, Voice cues (from the draft), crisis marker and end time, and the Patient's `lastCheckInAtMillis` / `lastSeenAtMillis`, in one transaction. Silent Check-ins and bad model output give a minimal Summary. The draft is never written or logged; a spy test checks this. `TODO(#20)` and `TODO(#21)` mark where the Decisions call and the Outcome write go. |
| Map tool | Not built | #18. Direct Places and Weather fixtures recorded; Maps agent tools needs `mapstools.googleapis.com` enabled ([spike results](spike-results.md#5-maps-18)). |
| Red flag alert | **Built:** `redFlagAlert` (#22, backend part) | Firestore trigger on the creation of `patients/{patientId}/flags/{flagId}`, in `europe-north1`, retried on failure. For a flag that is red, uncleared and stamped `sharedWithClinician: true`, of a Patient who is sharing, isn't synthetic and has a `clinicianEmail`, it writes one Trigger Email document to `mail/red-flag-<sha256(patientId/flagId)>` with `create()`, so a retry never sends twice. The subject marks a crisis apart from other reds (`[CRISIS]` / `[RED]`). The body is the display name, the flag's reason, a fixed line per kind (a quiet phone isn't read as self-harm) and a link to the Patient page from `DASHBOARD_URL` (defaults to `https://<project>.web.app`). Pure logic in `src/alerts.ts`. Logs only ids, kind and outcome; a spy test checks this. **Sending needs the Trigger Email extension, which needs a person** (below). |
| Silence check | Not built | #28. Only needs to create the red `silent` flag (stamped with `sharingStamp`); `redFlagAlert` sends the email. |

There is also a trivial `health` endpoint.

### Live protocol parsing (`core`, #14)

`app.depressify.core.live.LiveProtocol`, pure common Kotlin (no platform imports; the purity check covers it):
- `parse(frame: ByteArray | String | JsonObject): List<LiveEvent>`: one server frame (binary UTF-8 JSON) to events, in the order the phone must act on them. `LiveEvent` is `SetupComplete`, `AudioOut(pcm, sampleRate)`, `ModelText`, `InputText`, `OutputText`, `Interrupted`, `GenerationComplete`, `TurnComplete`, `ToolCall(id, name, args)`, `ToolCallCancellation`, `VoiceActivity(started)`, `Usage` and `GoAway`. Empty, unknown, malformed and `sessionResumptionUpdate` messages give no events; it never throws; bad base64 audio is skipped.
- Builders: `setupMessage`, `textMessage` (`realtimeInput.text`, the verified typed path), `clientContentMessage`, `audioMessage` (16 kHz PCM16 base64), `audioStreamEndMessage`, `toolResponseMessage`.
- `LiveProtocolFixturesTest` (JVM) parses every server message in `fixtures/spike/live/messages/` and the whole recorded session, and checks the builders against the recorded client messages; `LiveProtocolTest` (common) covers several parts in one message, an unknown message, a tool call and an interruption.
- Not built here (app team): the Ktor `LiveClient`, audio, the Check-in runner and recorder, and the screens.

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

- **Clinician's email:** never in code (the repository is public). Android reads `demo.clinicianEmail` from `secrets.properties` into `BuildConfig.CLINICIAN_EMAIL`; iOS reads `ClinicianEmail` from `iosApp/Depressify/Secrets.plist`. Both pass it to `firebasePatientBackend` in `shared`. Only the emulator falls back to `clinician@example.com`.
- **App id:** `app.depressify.patient` on Android and iOS, as on `main`; the app is called Depressify. Register the Firebase apps under that id.
- **Setup steps:** "Set up a real Firebase project" in the [README](../README.md#set-up-a-real-firebase-project).

## Gemini and Google API integrations

| Service ([research](research/)) | Status | Where |
|---|---|---|
| Gemini Interactions API, text model `gemini-4-hydrogen` with `store: false` | **Integrated** for Intake, Digest and Finish Check-in | `src/gemini.ts`: `@google/genai` 3.3.0, `TextModelClient` interface, 15-second timeout, `GEMINI_API_KEY` set through `defineSecret`. The tests use a fake client. |
| Interactions structured output (`response_format: {type: "text", mime_type: "application/json", schema}`) | **Integrated** for Finish Check-in (#14) | `TextRequest.response_format` in `src/gemini.ts`; the schema is `SUMMARY_SCHEMA` in `src/checkIn.ts` (the spike's recorded schema). The reply is read from `output_text`, then validated and capped in code (ratings 1 to 5 or null, at most 3 quotes of 200 characters that must be the Patient's own words, at most 4 themes); missing or malformed output gives the minimal Summary. One real call with fictional text (opt-in emulator test) parsed into a full Summary in about 8 s. |
| Gemini Live, plus ephemeral tokens (`POST /v1beta/auth_tokens`) | **Integrated** for the token (#14) | The phone connects directly (ADR 0002). `startCheckIn` mints the token (`src/live.ts`, `fetch` with the key in `x-goog-api-key`). Token body: `uses: 1`, `newSessionExpireTime` now + 60 s, `expireTime` now + 10 min, `bidiGenerateContentSetup` (`models/gemini-3.8-live`, AUDIO, the Brief plus fixed rules, `tools`, both transcriptions) and `fieldMask` `model,generationConfig,systemInstruction,tools,inputAudioTranscription,outputAudioTranscription`. A real mint with this body and the empty tool list, then a typed turn on that token, were checked by hand (setupComplete, audio plus output transcript, the AI disclosure). The pure Live protocol parser for the phone is in `core` (`app.depressify.core.live`); the WebSocket client and the runner belong to the app. |
| Gemini Decisions API (`gemini-decision-1`) | **Spiked** (#6) | Finish Check-in's three yes/no questions (#20). Request, answers and error shapes recorded. |
| Maps agent tools (weather, text search, routes) | **Spiked** (#6), blocked | #18. The key is the function secret `MAPS_API_KEY` and never reaches the phone. `mapstools.googleapis.com` and `routes.googleapis.com` aren't enabled (HTTP 403); direct Places (New) and Weather calls work. |
| Google Calendar API v3 | Not started | #19. Permission is granted on the phone. The spike needs a person; the steps are in [spike-results.md](spike-results.md#6-calendar-steps-for-a-person). |
| Health Connect and HealthKit | Not started | Read on the phone (ADR 0003), so there is no backend part beyond the `daily` contract. |
| Firebase Trigger Email extension (`firebase/firestore-send-email`, `mail` collection) | **Needs a person:** not installed | `redFlagAlert` writes the documents the extension sends. Installing it needs SMTP credentials (connection URI, password and a From address), so nobody has done it yet. Steps: [Red flag email](../README.md#red-flag-email) in the README: `firebase ext:install firebase/firestore-send-email --project prod`, collection `mail`, location `europe-north1`, then `firebase deploy --only extensions --project prod`. The rules keep `mail` closed to clients (rules test "The mail collection is not writable or readable by any client"). |

### Checked against the design, ADRs and research

| Rule | Source | State |
|---|---|---|
| Gemini and Maps keys never reach the phone | ADR 0002 | Holds. The only Gemini key is a function secret bound to the three functions that call the model. The app holds Firebase app config only. |
| Text model `gemini-4-hydrogen`, storage off | System design, ADR 0006 | Holds for Intake and the Digest. |
| Nothing a Patient said is stored or logged outside Summaries | ADR 0006 | Holds for the report and the Digest input; spy tests cover the log calls. |
| No name or id sent to Gemini | Gemini research, data handling | Holds for the Digest. An Intake report is sent as the Clinician pasted it, so paste only reports without identifiers. |
| Paid tier and AI Studio logging off | Gemini research, data handling | A setup step, now in the README. Not something the code can enforce. |
| Live tokens and Decisions need `v1beta` | Gemini research, API versions | Noted in `src/gemini.ts`; the SDK defaults to `v1`. |
| EU region | System design, ADR 0008 | `europe-north1` for the functions and the dashboard. |
| GitLive `firebase-kotlin-sdk` 2.8.0 in shared code | ADR 0008 | Holds. |
| Anonymous Patient sign-in, linked to the one Clinician on first open | System design, roles | Holds, now behind `main`'s screens. |

Differences that remain between `main`'s Patient UI and the contract, for the next slices:

- `core` has two sets of types: the screen models (`app.depressify.core`: `SuggestionKind`, `Summary`, `SignalId`, `Baseline`) and the contract (`app.depressify.core.model`). They don't map one to one. The screens have four Suggestion kinds and the contract seven; the screens treat ratings and Voice observations as Signals and the contract as Consent purposes.
- The screens' `Baseline` is the 14-day median with at least 5 valid days. The contract's Baseline also has a floor on the spread, pinned by `fixtures/baseline/baseline-cases.json`. The Kotlin side must check that fixture when Signals are wired (#16).
- The sharing screens show a fictional Clinician name. The record holds the Clinician's email.

## Frontend

- **Patient app:** `main`'s Compose Multiplatform screens, with sign-in and the sharing Consent wired as described above.
- **Clinician dashboard** (`firebase/hosting`, plain JS with the Firebase JS SDK), from the stack:
  - Sign-in, a live Patient list sorted by Attention flag, search and a level filter.
  - The red-flag banner with an optional sound, flag detail, and the "Clear after follow-up" dialog.
  - The Patient page in four sections: Overview, Summaries, Signals, and Intake and Visits.
- `design/clinician` on `main` is a separate design prototype. It is not connected to Firebase.

Useful when the dashboard design is merged:
- `firebase/hosting/js/lib/*` holds pure helpers (sorting, Phases, Baseline, series, what helps, clearing) with tests that don't depend on the UI.
- Dashboard queries go through `patientCollectionQuery` in `js/lib/sharing.js`, which adds the sharing-stamp filter the rules require.

## Verification

Results on `feat/14-typed-checkin-on-49` (on #50, with #52's spike fixtures merged in), all from local runs on 14 November 2026:

| Suite | Command | Result |
|---|---|---|
| Kotlin `core` (contract, `CoreRulesTest`, `LiveProtocolTest`, `LiveProtocolFixturesTest`) | `./gradlew :core:jvmTest` | 39 pass; the exported contract is unchanged |
| Kotlin `shared` (session and view model wiring, with fakes) | `./gradlew :shared:testAndroidHostTest` | 10 pass |
| Android build | `./gradlew :androidApp:assembleDebug` | APK builds |
| iOS build | `xcodegen generate`, then `xcodebuild` for the arm64 simulator | Builds and links with the Firebase iOS SDK |
| Functions | `cd firebase/functions && npm test` | 249 pass, including the Check-in pure, handler and no-logging spy tests |
| Seed | `cd firebase/seed && npm test` | 78 pass |
| Dashboard helpers | `cd firebase/hosting && node --test` | 308 pass |
| Rules, functions and end-to-end on the emulators | `firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"` | 87 pass, 1 skipped (the opt-in real-Gemini Check-in test) with Firebase CLI 15.36.0, including the `redFlagAlert` trigger |
| Seed on the emulator | `... "npm --prefix seed run test:emulator"` | 14 pass |

The emulator suite needs Firebase CLI 15 or newer. With CLI 14.22.0 the Functions emulator kills every function built with `firebase-functions` 7, and the six callable tests time out.

`redFlagAlert` is not deployed yet: deploy it with `firebase deploy --only functions:redFlagAlert --project prod` together with the Trigger Email extension.

**Not verified (needs a person, hardware or credentials):**
- The Patient app against the emulators or a real project on a phone or simulator. The wiring is tested with fakes only.
- Deploying to a real Firebase project, including whether Cloud Scheduler accepts `europe-north1` for `weeklyDigest`.
- The app on the S24+ and on an iPhone.
- A full Intake extraction or Digest through the deployed callables, signed in as the Clinician.
- **`startCheckIn` and `finishCheckIn` are not deployed.** Through the Functions emulator only the paths that never reach Gemini ran (refusals, a silent finish). The real-model path ran only through the handlers, by hand, against the Firestore emulator.
- A real Check-in end to end: the phone's Live client, a typed or spoken session on a minted token, Finish Check-in with the real model, and the Summary on the phone and the dashboard within about ten seconds (app team and a person).
- The red flag email arriving in an inbox: needs the Trigger Email extension installed with SMTP credentials, then a red flag on a live, sharing Patient (#22's S24+ check).

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

- **Moved from the daily job:** the spec has the phone's daily job write `objectiveChange` and `outcomeScore`. These are now function-only, so Finish Check-in must compute them (#21, below).
- **Seams left by #14:**
  - **#17 (tool catalog):** `LIVE_TOOL_DECLARATIONS` in `firebase/functions/src/tools.ts` is empty, so every token locks no tools. #17 fills it from `core`'s `ToolCatalog` export and adds the comparison test; the token body, field mask and the crisis rule (which names `raise_crisis` once it is declared) need no change.
  - **#20 (Decisions):** `TODO(#20)` in `finishCheckInHandler` (`src/checkInFunctions.ts`) marks where the three yes/no questions go, on the same in-memory transcript; the flags and the Patient's level belong in the same `writeFinish` transaction.
  - **#21 (Outcome):** `TODO(#21)` in the same handler. `lastSuggestionId` is validated and the Suggestion read (its details go into the prompt); `ModelSummary.previousTried` and `previousFelt` are parsed but nothing writes the Outcome, `objectiveChange` or `outcomeScore` yet.
- **Last Check-in time:** `lastCheckInAtMillis` on the Patient record isn't stamped. After sharing resumes, the list can show the time of a Check-in made while not sharing (only the time).
- **Phone writers:**
  - Keep each record's stamp; never delete and recreate a record.
  - Retry a refused write with a fresh stamp, especially a crisis flag.
  - Create a new Suggestion rather than editing `kind` or `details`.
- **Still open from the spec:** whether to delete Summaries and Digests when sharing is withdrawn.
- **Red flag email for Demo Patients:** `redFlagAlert` skips `synthetic: true` Patients, because the seed recreates their red flags on every run. If a demo should email from a Demo Patient, that needs a demo control that raises a fresh flag, plus a decision to lift the skip for it.
- **Red flag alert, app side (#22):** the Crisis notice, the dialler, the crisis controller, the offline queue and Support in Settings belong to the app team. The phone only has to create the red `crisis` flag (stamped, not duplicated while one is open). The email follows from that.
- **Spike results (#6):** the backend half is recorded in [spike-results.md](spike-results.md), with raw fixtures in `fixtures/spike/`.
  - **Unblocked backend work:**
    - #14: built (backend part).
    - #20: the Decisions call, once #14 is in.
    - #18: the Map tool function, using direct Places and Weather now, or Maps agent tools once `mapstools.googleapis.com` is enabled; it still also waits on #17.
  - **Still waiting on a person (S24+, Watch, iPhone, Google account):**
    - The on-phone Live test (#15).
    - Health Connect, HRV and usage statistics (#24).
    - The Calendar consent (#19).
    - The iPhone Live test (#30).
