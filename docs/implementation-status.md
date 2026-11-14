# Implementation status

Status as of 14 November 2026. Covers issues #7, #8, #9, #10, #11, #12, #13, #23 and #29, the backend part of #22 (the red flag email), the silence check (#28), the backend half of the #6 spikes ([spike-results.md](spike-results.md)), the backend part of #14 (Start and Finish Check-in, and the Live protocol parsing in `core`), the backend part of #20 (the Attention flag from a Check-in, through the Decisions API), the backend part of #21 (Outcomes and learning what helps), the pure `core` pipeline of the daily job (#26), and the review decisions that followed. Terms follow [GLOSSARY.md](../GLOSSARY.md).

## Work on top of `main` (open PRs)

Kept up to date as PRs are opened and merged. Each PR also updates its own rows further down this file. Last updated 14 November 2026.

`main` holds the integration (#49, merged), with the content of #50 and #52 to #57 merged into it by hand (`redFlagAlert`, `silenceCheck`, the `europe-west1` scheduler region, the #6 spike results and fixtures, `startCheckIn` / `finishCheckIn` and `LiveProtocol` in `core`, the session handoff and the cloud setup record); those PRs were closed. The app-side Check-in over Gemini Live (#58) is merged too.

| PR | Branch | Issue | State |
|---|---|---|---|
| #60 | `codex/check-in-review-fixes` → `main` | Review fixes for #14 and #22: per-Patient caps in `patientLimits` (Check-in starts, red flag emails), a retryable model failure answers `unavailable` and saves nothing, the Summary stamped from the Check-in's stamp | Open |
| #62 | `feat/20-checkin-flags` → `codex/check-in-review-fixes` (on #60) | #20, backend: the Decisions API in Finish Check-in, the Attention flag from a Check-in | Open. Tested (functions 344, core 40, shared 16, emulators 96 + 16). Not deployed. |
| — | `feat/21-outcomes` → `feat/20-checkin-flags` (on #62) | #21, backend: the Outcome in Finish Check-in, the Outcome score, ranking what helps (TypeScript and `core`) | This branch; PR to be opened. Tested (functions 435, core 58, shared 16, seed 103, dashboard 309, emulators 97 + 16). Not deployed. |
| #61 | (teammate) | #18, places part: `find_places` returns real nearby places | Open; not part of this branch |
| #69 | `feat/26-daily-job-rules` (from `main`) | #26, `core` only: the daily job's pure pipeline (daily record, Baseline, sign of life, Signal flag rules, write plan) | Tested (core 124, seed 105, dashboard 310); the app's background work, debug action and device check are still to do |

**Deployed on `junction26hel-7400`:**
- Rules and indexes.
- `extractIntake`, `saveIntake`, `generateDigest`, `health`, `startCheckIn` and `finishCheckIn` in `europe-north1`. The deployed `finishCheckIn` is #14's, without the Decisions call.
- `weeklyDigest` in `europe-west1`.

**Not deployed:** `redFlagAlert`, `silenceCheck`, the `finishCheckIn` of #20 and of this branch (#21, the Outcome), the rules change for `outcomeCheckInId`, Hosting and the Trigger Email extension.

The full setup is recorded in [context/firebase-and-google-cloud-setup.md](context/firebase-and-google-cloud-setup.md).

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
| | Can't write Summaries, Visits, Digests, ratings, Voice cues, the crisis marker, the assessment or Outcome fields. |
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
  - The red flag alert (#22) and the silence check (#28) skip Patients who aren't sharing.
  - Every function that writes must stamp what it writes.
- **Flag level on the Patient record:** `flagLevel` and `flagReasons` count only flags stamped `true`, so a flag raised while sharing was off doesn't leak its reason to the Clinician.

### Cloud Functions (`firebase/functions`, TypeScript, region `europe-north1`; the scheduled job in `europe-west1`)

| Function in [system design](context/system-design.md#cloud-functions) | Status | Notes |
|---|---|---|
| Extract Intake | **Built:** `extractIntake` and `saveIntake` (#13) | Clinician-only callables. Extraction writes nothing; saving writes only `intakeHighlights` (at most 120 words). The report is never stored or logged, and a spy test checks this. |
| Weekly Digest | **Built:** `weeklyDigest` (Mondays 07:00 Helsinki) and `generateDigest` (callable) (#23) | Document key is the ISO week (`2026-W46`). Uses only shared records. A week with no Check-ins gets fixed text and never calls the model. Patients who aren't sharing get no Digest. |
| Start Check-in (Live token) | **Built:** `startCheckIn` (#14, backend part), callable in `europe-north1`, deployed | Caller rule (`assertActsAsPatient` in `src/patientCaller.ts`, mirroring `actsAsPatient` in the rules): `auth.uid == patientId`, or anyone signed in when the Patient is `synthetic: true`; signed out is `unauthenticated`, anyone else or a missing Patient `permission-denied`. Request `{patientId, brief, mode?}` (Brief 1 to 12,000 characters, mode `typed` or `spoken`), response `{checkInId, token, model, endpoint, mode, connectByMillis, expiresAtMillis}`. Mints a single-use token with the recorded `bidiGenerateContentSetup` + `fieldMask` body, locked to `gemini-3.8-live`, the Brief plus fixed safety rules, the tool declarations (`src/tools.ts`, nine BLOCKING tools the phone runs in `CompanionTools`), AUDIO output and both transcriptions; 60 s to connect, 10-minute lifetime. At most 10 starts an hour per Patient record (`patientLimits`), then `resource-exhausted` without minting. Creates `checkIns/{id}` (function-only fields empty, `sharingStamp`). A real mint and a typed turn on that token were checked by hand. Client contract in the [README](../README.md#check-in-start-and-finish). |
| Finish Check-in | **Built:** `finishCheckIn` (#14, backend part; #20 Decisions in #62; #21 the Outcome on this branch), callable in `europe-north1`; #14's version deployed, the Decisions call and the Outcome not yet | Same caller rule as Start Check-in. Request `{patientId, checkInId, draft, todayLines?, lastSuggestionId?}`, response `{checkInId, summary, minimal}` (never a flag, level or assessment); a Check-in Start Check-in never created is `not-found`. The text model (storage off, structured output) and the Decisions API (#20) run at the same time on the same in-memory transcript. Writes the Summary (keyed by the Check-in, a retry overwrites, stamp kept; a retry without model output keeps what the model wrote before; the stamp is true only when the Check-in's is and the Patient still shares), the ratings, Voice cues (from the draft), crisis marker, `assessment`, `previousTried` and end time, new flags at `<kind>-<checkInId>`, and the Patient's `lastCheckInAtMillis` / `lastSeenAtMillis` and raised `flagLevel` / `flagReasons`, in one transaction. Silent Check-ins (no model or Decisions call), a request the model refuses and bad model output give a minimal Summary; a text model timeout or server error answers `unavailable` and saves nothing but the flags the judgment raised (in their own transaction), so the phone retries and a crisis is not lost. **Decisions routing** (`src/decisions.ts`, starting values in `DECISION_THRESHOLDS`): crisis ≥ 0.5 or the draft's crisis marker gives red `crisis`; decline ≥ 0.6 amber `decline`; an HTTP 400 safety refusal amber `unassessed` ("A Check-in could not be assessed automatically."); a timeout or any other failure no flag and `assessment: "unavailable"`, and the Summary is saved as usual. `triedLast` (asked only when there was a previous Suggestion) gives `previousTried` true (≥ 0.6), false (≤ 0.4) or null. The three write rules hold: no new flag while one of the kind with the same stamp is open (the phone's own crisis flag counts), the level never goes down, only flags stamped true count. On a Demo Patient only the caller who started the Check-in may finish it. The draft is never written or logged; the spy test covers the Decisions success, refusal, timeout and error paths, and the Outcome paths (recorded, retried, an answer about another Suggestion: no transcript, feeling text or Suggestion details logged). **The Outcome (#21,** `src/outcomes.ts`, pure**)**, in the same transaction: the function finds the target (the most recent accepted Suggestion made before the Check-in started, not in the draft, with no Outcome yet; a proposed or declined one never) and writes only when `lastSuggestionId` is absent or names it, and only if the transaction finds the same target. The answer: the text model's `previousTried` / `previousFelt` / `previousPreferNotToSay` first, the Decisions "tried" only when the text model is unsure, nothing (the Outcome stays open) when neither knows. It sets `tried`, `felt`, `objectiveChange` (the Suggestion's day's stored `vsBaseline.steps`, else computed from the daily records by the shared Baseline rule in `src/baseline.ts`; `null` without steps or with `consents/steps` off), `outcomeScore` and the new `outcomeCheckInId`, once per Suggestion: a retry keeps the first Outcome and a late retry never overwrites a later Check-in's. Only those fields change; the Suggestion's stamp stays. |
| Map tool | Not built here | #18, being built by a teammate (#61 has the places part). Maps agent tools (`mapstools.googleapis.com`) are now enabled and answered HTTP 200 for weather, text search and routes ([spike results](spike-results.md#5-maps-18)). |
| Red flag alert | **Built:** `redFlagAlert` (#22, backend part) | Firestore trigger on the creation of `patients/{patientId}/flags/{flagId}`, in `europe-north1`, retried on failure. For a flag that is red, uncleared and stamped `sharedWithClinician: true`, of a Patient who is sharing, isn't synthetic and has a `clinicianEmail`, it writes one Trigger Email document to `mail/red-flag-<sha256(patientId/flagId)>` with `create()`, so a retry never sends twice. At most 5 emails an hour per Patient record (`patientLimits`); a flag past the cap is recorded without an email. The subject marks a crisis apart from other reds (`[CRISIS]` / `[RED]`). The body is the display name, the flag's reason, a fixed line per kind (a quiet phone isn't read as self-harm) and a link to the Patient page from `DASHBOARD_URL` (defaults to `https://<project>.web.app`). Pure logic in `src/alerts.ts`. Logs only ids, kind and outcome; a spy test checks this. **Sending needs the Trigger Email extension, which needs a person** (below). |
| Silence check | **Built:** `silenceCheck` (#28) | Scheduled at the top of every hour, Europe/Helsinki, in `europe-west1` (`SCHEDULER_REGION`: Cloud Scheduler has no `europe-north1`). For each Patient who is sharing, isn't synthetic and was last seen (`lastSeenAtMillis`) more than 24 hours ago, it creates a red `silent` flag at `silent-<lastSeenAtMillis>`, stamped with `sharingStamp` (true), and raises the record's `flagLevel` and `flagReasons` in the same transaction, after reading the record again. Exactly 24 hours, never seen (`null`) and a time in the future are not silent. No second flag while one is open, and none again for a silence the Clinician already cleared. Reason: "The phone has been quiet: it has not connected for over 24 hours." It sends no email itself: `redFlagAlert` does. Pure logic in `src/silence.ts`. Logs only ids and counts; a spy test checks this. **Demo:** `npm run silence-test -- --patient <id> [--project <id>]` in `firebase/seed` sets a live, sharing Patient's last sign of life to 25 hours ago (refuses Demo Patients and Patients not sharing); force-run the Cloud Scheduler job to run the check at once. No callable or HTTP trigger was added. |

There is also a trivial `health` endpoint.

Deployed on the project `junction26hel-7400`, with `GEMINI_API_KEY` set as a function secret:

| Function | Type | Endpoint |
|---|---|---|
| `extractIntake` | Callable, Clinician only | `https://europe-north1-junction26hel-7400.cloudfunctions.net/extractIntake` |
| `saveIntake` | Callable, Clinician only | `https://europe-north1-junction26hel-7400.cloudfunctions.net/saveIntake` |
| `generateDigest` | Callable, Clinician only | `https://europe-north1-junction26hel-7400.cloudfunctions.net/generateDigest` |
| `health` | HTTP | `https://europe-north1-junction26hel-7400.cloudfunctions.net/health` (answered `{"ok":true}` on 14 November 2026) |
| `startCheckIn` | Callable, the Patient (or anyone on a Demo Patient) | `europe-north1` |
| `finishCheckIn` | Callable, same | `europe-north1`. The deployed version is #14's, without the Decisions call (#20). |
| `weeklyDigest` | Scheduled, Mondays 07:00 Helsinki | `europe-west1`. Private: only Google's scheduler can call it. |

The callables are reached through the Firebase SDK (`httpsCallable` in `europe-north1`), which adds the caller's sign-in token; they are not plain REST endpoints. `weeklyDigest` is deployed in `europe-west1`, and `SCHEDULED_REGION` in `src/region.ts` now says so.

### Outcomes and learning what helps (#21, backend part)

- **Ratings (first criterion), checked:** Finish Check-in already takes the three ratings from the text model's structured output; a value outside 1 to 5, a non-integer or a missing one is `null` (`parseModelSummary`); they are saved on the Check-in and in the Summary, and are `null` in both when `consents/ratings` is `granted: false`. Covered by `checkin.test.ts` and `checkin-handlers.test.ts`; no change was needed.
- **The rule, once.** `fixtures/outcomes/outcome-cases.json` pins the Outcome score, the ranking, the Brief's guidance and the target. Read by the functions' tests (`src/outcomes.ts`: the score and the target), core's JVM tests (`OutcomeFixtureTest`) and the seed's tests.
- **The score** (spec #5, weights from the plan's Task 6): `null` until answered and for "prefer not to say"; `-0.1` for "not this time" (the seed's value; the plan said −0.2, the spec "a small negative value"); otherwise `clamp(0.7 x (felt - 3) / 2 + 0.3 x clamp(objectiveChange, -1, 1), -1, 1)`. The seed used to clamp only the total, so a large step change could turn a bad feeling positive (felt 1 with a step change of 3 gave +0.2); it now clamps the step change first, as the plan does (−0.4), so the Patient's report decides.
- **For the phone's Brief** (`core`, `app.depressify.core.learning`, common Kotlin with JVM tests):
  - `SuggestionRanker(random: () -> Double)`: `rank(history: List<Suggestion>): List<KindScore>` (scored Suggestions only, by mean then count) and `guidance(history): Guidance(preferred: List<KindScore> /* top 3 */, tryNew: SuggestionKind?)`, with `tryNew` only when `random()` is below 0.2: the first kind with no score, else the least-scored outside the top three.
  - `Outcomes.openSuggestion(history, beforeMillis, checkInId = null, excluding = emptySet())`: the Suggestion the next Check-in asks about, or `null` (skip the Outcome step). Send its id as `lastSuggestionId`.
  - `Outcomes.score(tried, felt, objectiveChange)` and `Outcomes.hasOutcome(suggestion)`.
  - They take the contract's `app.depressify.core.model.Suggestion` (seven kinds), not the screens' four-kind `app.depressify.core.SuggestionKind`.
- **Dashboard:** "what seems to help" (`hosting/js/lib/what-helps.js`) orders by the stored `outcomeScore`, which Finish Check-in now writes; "prefer not to say" (`outcomeCheckInId` set, no score) is no longer counted as waiting. A functions test and the emulator test feed the written Suggestions to `whatHelps` and see the new row.
- **Not built here (app team):** the ratings step and the previous-Outcome step UI, History's mood trend, the Compose UI tests, and wiring the Brief (`SuggestionRanker`, `openSuggestion`) on the phone.

### Live protocol parsing (`core`, #14)

`app.depressify.core.live.LiveProtocol`, pure common Kotlin (no platform imports; the purity check covers it):
- `parse(frame: ByteArray | String | JsonObject): List<LiveEvent>`: one server frame (binary UTF-8 JSON) to events, in the order the phone must act on them. `LiveEvent` is `SetupComplete`, `AudioOut(pcm, sampleRate)`, `ModelText`, `InputText`, `OutputText`, `Interrupted`, `GenerationComplete`, `TurnComplete`, `ToolCall(id, name, args)`, `ToolCallCancellation`, `VoiceActivity(started)`, `Usage` and `GoAway`. Empty, unknown, malformed and `sessionResumptionUpdate` messages give no events; it never throws; bad base64 audio is skipped.
- Builders: `setupMessage`, `textMessage` (`realtimeInput.text`, the verified typed path), `clientContentMessage`, `audioMessage` (16 kHz PCM16 base64), `audioStreamEndMessage`, `toolResponseMessage`.
- `LiveProtocolFixturesTest` (JVM) parses every server message in `fixtures/spike/live/messages/` and the whole recorded session, and checks the builders against the recorded client messages; `LiveProtocolTest` (common) covers several parts in one message, an unknown message, a tool call and an interruption.
- Not built here (app team): the Ktor `LiveClient`, audio, the Check-in runner and recorder, and the screens.

### Daily job pipeline (`core`, #26)

`app.depressify.core.daily`, pure common Kotlin (no platform imports; it compiles for iOS). The whole decision of one run is `DailyJob.run(DailyJobInputs): DailyJobResult`, tested end to end with plain inputs. The app reads the inputs, calls it, and writes the result; the pipeline does no I/O and reads no clock.

| Part | What it does |
|---|---|
| `SignalBaseline` | The contract's Baseline: the 14 calendar dates strictly before the day with a value, at least 5, median centre, spread `max(sample SD, 0.05 x \|median\|, 0.001)`. `vsBaseline` keeps the measured sign; `oriented` flips lower-is-better Signals and drops Signals with no direction; `composite` is the mean of the oriented values that exist. `BaselineFixtureTest` (JVM) runs every case of `fixtures/baseline/baseline-cases.json` (14 comparisons, 5 oriented, 3 composites). |
| `DailyRecordBuilder` | Today's `DailyDoc`: every Signal key, null when not consented, missing or not a finite number (a real zero stays zero), the comparisons and the composite. |
| `SignalFlagRules`, `DailyThresholds`, `FlagReasons` | The five rules below. Thresholds in one object, the spec's starred ones marked STARTING VALUE; reasons are plain sentences with no score and no decimal number. The thresholds and reasons are pinned, with the seed's `flags.js`, by `fixtures/flags/signal-rules.json` (`SignalRulesFixtureTest` and the seed's `flags.test.js`). |
| `FlagWriteRules` | The write plan: the new flags (uncleared, stamped with `PatientDoc.sharingStamp()`, id `<kind>-<date>`, or `<kind>-<date>-unshared` for a flag stamped false), the record's new `flagLevel` / `flagReasons` (or none), and the sign of life. |
| `DailyJob` | Composes the above. |

| Flag | Rule (STARTING VALUE where starred in the spec) | Missing data |
|---|---|---|
| Red `sleep_collapse` | Sleep under 180 minutes*, else oriented sleep at or below -2.5* | Only when today's sleep is present |
| Red `inactive` | Steps and screen-on minutes in the last 24 hours both exactly 0 | Both present; each needs its Consent (Steps; usage, `lateNightScreenMinutes`) |
| Amber `poor_sleep` | Oriented sleep at or below -1.0* on each of the last 3 calendar nights | All 3 present; a night without a record breaks the run |
| Amber `low_mood` | Mood 2 or lower at each of the last 3 finished Check-ins | A null rating breaks the run |
| Amber `drift` | Composite at or below -1.0* on each of the last 3* calendar days, each made up of at least 2* Signals | All present. A day with one Signal's comparison does not count, so sleep alone is `poor_sleep`, never drift too. A constant history gives 0 and a short one (under 5 days) none, so neither raises drift |

Earlier days' comparisons are recomputed from their stored values (each against the days before it, as the seed and dashboard do), so the job needs the previous 16 daily records (`DailyThresholds.HISTORY_DAYS_NEEDED`).

Write plan, mirroring `raisedAttention` and `hasOpenFlag` in the functions:
- A kind with an uncleared flag of the same stamp is not raised again (`already_open`). A flag stamped false never blocks a shared one.
- A kind already raised today with the same stamp is not raised again that day, even when cleared (`already_raised`; the id is taken and the rules refuse a second create). For `low_mood`, a flag of the kind raised at or after the newest of the three Check-ins already covered them, so a cleared low-mood flag is not raised again on the same Check-ins.
- Only flags stamped true change the record. The level only goes up: a function's red, or one the Clinician left uncleared, is never lowered. Every existing reason is kept (the rules check `hasAll`), a new reason at or above the current level goes first, and one below it goes last. With nothing new, `attention` is null and the app leaves the level and reasons alone.
- `lastSeenAtMillis` becomes the run's time, and never moves back.
- Today's record keeps the stamp it was created with on later runs. Demo overrides replace readings and mark the record `demoOverride`; a later device run keeps a demo record's values.

**The app wires up (not built):** the periodic work about every six hours (WorkManager on Android; a background task on iOS) and the "Run daily job now" debug action; reading the Signals and Consents, the previous 16 daily records, today's record, the recent Check-ins, the flags and the Patient record; writing the daily record (set), the new flags (create), and `lastSeenAtMillis` plus the level and reasons in one transaction; and the S24+ check. Pause the job during the silence test, or the sign of life overwrites the 25-hours-ago value.

**Decided deviation:** #26 asks the job to fill `objectiveChange` and `outcomeScore` on yesterday's Suggestions. The review made the Outcome fields function-only, so Finish Check-in writes them (#21, PR #65). The job does not touch Suggestions.

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
| Gemini Interactions API, text model `gemini-4-hydrogen` with `store: false` | **Integrated** for Intake, Digest and Finish Check-in | `src/gemini.ts`: `@google/genai` 3.3.0, `TextModelClient` interface, one attempt with a 40-second timeout (a Summary took 8 to 23 seconds on the real project; the SDK default of four retries outlasted the 60-second function limit), `GEMINI_API_KEY` set through `defineSecret`. The tests use a fake client. |
| Interactions structured output (`response_format: {type: "text", mime_type: "application/json", schema}`) | **Integrated** for Finish Check-in (#14) | `TextRequest.response_format` in `src/gemini.ts`; the schema is `SUMMARY_SCHEMA` in `src/checkIn.ts` (the spike's recorded schema). The reply is read from `output_text`, then validated and capped in code (ratings 1 to 5 or null, at most 3 quotes of 200 characters that must be the Patient's own words, at most 4 themes); missing or malformed output gives the minimal Summary. One real call with fictional text (opt-in emulator test) parsed into a full Summary in about 8 s. |
| Gemini Live, plus ephemeral tokens (`POST /v1beta/auth_tokens`) | **Integrated** for the token (#14) | The phone connects directly (ADR 0002). `startCheckIn` mints the token (`src/live.ts`, `fetch` with the key in `x-goog-api-key`). Token body: `uses: 1`, `newSessionExpireTime` now + 60 s, `expireTime` now + 10 min, `bidiGenerateContentSetup` (`models/gemini-3.8-live`, AUDIO, the Brief plus fixed rules, `tools`, both transcriptions) and `fieldMask` `model,generationConfig,systemInstruction,tools,inputAudioTranscription,outputAudioTranscription`. A real mint with this body and the empty tool list, then a typed turn on that token, were checked by hand (setupComplete, audio plus output transcript, the AI disclosure). The pure Live protocol parser for the phone is in `core` (`app.depressify.core.live`); the WebSocket client and the runner belong to the app. |
| Gemini Decisions API (`gemini-decision-1`) | **Integrated** in Finish Check-in (#20), on this branch; not deployed | `src/decisionsApi.ts`: `DecisionsClient` interface (the tests use `FakeDecisions`) and `fetchDecisionsClient`, one `fetch` to `POST /v1beta/decisions` with the key in `x-goog-api-key` (`GEMINI_API_KEY`), one attempt, 15-second timeout. Body `{model: "gemini-decision-1", input: "Check-in transcript:\n…", questions: {crisis, decline, triedLast?: {type: "noul", instructions}}}`, the spike's wording; answers read from `answers.<key>.noul`. Errors carry the HTTP status and the error code word only, never the body. HTTP 400 with `safety`, `prohibited_content`, `blocklist`, `image_safety` or `content_blocked` is a safety refusal; anything else a failure. One manual call with the stored key and two fictional transcripts (14 November, outside the suite, no Firestore): routine answered crisis 0.01, decline 0.07, triedLast 0.99 in 1.1 s, routed to no flag and "tried yes"; a low one crisis 0.10, decline 0.98, triedLast 0.01 in 0.25 s, routed to amber decline and "tried no". A safety refusal has still never been observed. |
| Maps agent tools (weather, text search, routes) | **Enabled and verified** | `mapstools.googleapis.com` ("Maps Experience agent tools") is now enabled on `junction26hel-7400`. Checked on 14 November with the stored `MAPS_API_KEY`: `v1:lookupWeather`, `v1:searchText` and `v1:computeRoutes` all returned HTTP 200. The key (`depressify-maps`) allows mapstools, places, weather and routes, and never reaches the phone. #18 (the Map tool) is being built by a teammate. |
| Google Calendar API v3 | Not started | #19. Permission is granted on the phone. The spike needs a person; the steps are in [spike-results.md](spike-results.md#6-calendar-steps-for-a-person). |
| Health Connect and HealthKit | Not started | Read on the phone (ADR 0003), so there is no backend part beyond the `daily` contract. |
| Firebase Trigger Email extension (`firebase/firestore-send-email`, `mail` collection) | **Needs a person:** not installed | `redFlagAlert` writes the documents the extension sends. Installing it needs SMTP credentials (connection URI, password and a From address), so nobody has done it yet. Steps: [Red flag email](../README.md#red-flag-email) in the README: `firebase ext:install firebase/firestore-send-email --project prod`, collection `mail`, location `europe-north1`, then `firebase deploy --only extensions --project prod`. The rules keep `mail` closed to clients (rules test "The mail collection is not writable or readable by any client"). |

### Checked against the design, ADRs and research

| Rule | Source | State |
|---|---|---|
| Gemini and Maps keys never reach the phone | ADR 0002 | Holds. The only Gemini key is a function secret bound to the functions that call Gemini (Intake, Digest, Start and Finish Check-in). The app holds Firebase app config only. |
| Text model `gemini-4-hydrogen`, storage off | System design, ADR 0006 | Holds for Intake, the Digest and Finish Check-in. The Decisions request recorded in the spike has no storage option. |
| Nothing a Patient said is stored or logged outside Summaries | ADR 0006 | Holds for the report, the Digest input and the Check-in transcript (sent to the text model and the Decisions API, never written or logged); spy tests cover the log calls, including every Decisions path. Flag reasons are fixed sentences. |
| No name or id sent to Gemini | Gemini research, data handling | Holds for the Digest. An Intake report is sent as the Clinician pasted it, so paste only reports without identifiers. |
| Paid tier and AI Studio logging off | Gemini research, data handling | A setup step, now in the README. Not something the code can enforce. |
| Live tokens and Decisions need `v1beta` | Gemini research, API versions | Holds: both are called with `fetch` on `v1beta` (`src/live.ts`, `src/decisionsApi.ts`); the SDK, used only for the text model, defaults to `v1`. |
| EU region | System design, ADR 0008 | `europe-north1` for the functions and the dashboard; the scheduled `weeklyDigest` and `silenceCheck` run in `europe-west1`, because Cloud Scheduler has no `europe-north1` location. |
| GitLive `firebase-kotlin-sdk` 2.8.0 in shared code | ADR 0008 | Holds. |
| Anonymous Patient sign-in, linked to the one Clinician on first open | System design, roles | Holds, now behind `main`'s screens. |
| Attention flag: three levels, written reasons, never a number; a refusal is amber, a failure is never green | ADR 0009, spec #5 | Holds for Finish Check-in's flags (#20): fixed reason sentences, no score stored or shown, `assessment: "unavailable"` instead of a made-up green. |
| The Patient never sees a flag | Spec #5 | Holds for Finish Check-in: its response carries only the Summary; `assessment` and the flags are on documents the app does not show. |

Differences that remain between `main`'s Patient UI and the contract, for the next slices:

- `core` has two sets of types: the screen models (`app.depressify.core`: `SuggestionKind`, `Summary`, `SignalId`, `Baseline`) and the contract (`app.depressify.core.model`). They don't map one to one. The screens have four Suggestion kinds and the contract seven; the screens treat ratings and Voice observations as Signals and the contract as Consent purposes.
- The screens' `Baseline` is the 14-day median with at least 5 valid days, counted in records. The contract's Baseline, `SignalBaseline` in `app.depressify.core.daily` (#26), also has a floor on the spread and counts calendar dates, and its JVM test runs `fixtures/baseline/baseline-cases.json`. The screens should move to it (#16).
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

Results on `feat/21-outcomes` (on #62), all from local runs on 14 November 2026:

| Suite | Command | Result |
|---|---|---|
| Kotlin `core` (contract, `CoreRulesTest`, `LiveProtocolTest`, `LiveProtocolFixturesTest`, `SuggestionRankerTest`, `OutcomeFixtureTest`, and on `feat/26-daily-job-rules` the daily pipeline, `BaselineFixtureTest` and `SignalRulesFixtureTest`) | `./gradlew :core:jvmTest` | 58 pass; 124 on `feat/26-daily-job-rules`; the exported contract gains the Suggestion's `outcomeCheckInId` |
| Kotlin `shared` (session and view model wiring, with fakes) | `./gradlew :shared:testAndroidHostTest` | 16 pass |
| Android build | `./gradlew :androidApp:assembleDebug` | APK builds |
| iOS build | `xcodegen generate`, then `xcodebuild` for the arm64 simulator | Not rerun on this branch (built on #14's branch) |
| Functions | `cd firebase/functions && npm test` | 435 pass, including `outcomes.test.ts` (the shared fixture, which answer counts, the day's steps, the write), `baseline.test.ts` (the Baseline fixture through the TypeScript copy), `checkin-outcome.test.ts` (the Outcome through the handler: target, precedence, prefer not to say, declined, the draft's own Suggestion, retries, steps Consent, the dashboard read-back), `decisions.test.ts`, `decisions-api.test.ts` and the spy test across the Decisions and Outcome paths |
| Seed | `cd firebase/seed && npm test` | 103 pass, including the shared Outcome fixture; 105 on `feat/26-daily-job-rules` (`flags.test.js`) |
| Dashboard helpers | `cd firebase/hosting && node --test` | 309 pass |
| Rules, functions and end-to-end on the emulators | `firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"` | 97 pass, 1 skipped (the opt-in real-Gemini test), with Firebase CLI 15.36.0. Includes the Outcome written in the finish transaction on the Admin store (steps computed from the daily records, a retry changing nothing, the phone unable to change it under the rules, `whatHelps` reading the new score), the rules refusing a client-set `outcomeCheckInId`, Decisions flags written in the finish transaction on the Admin store, and a silent Check-in with the crisis marker finished through the deployed callable: red `crisis-<checkInId>`, level red, and `redFlagAlert` wrote one `[CRISIS]` email (outcome `sent`); the retry raised no second flag. |
| Seed on the emulator | `... "npm --prefix seed run test:emulator"` | 16 pass (with the Functions emulator; the seeded Demo Patients' red flags are skipped as synthetic) |
| Decisions API, real | One script outside the suite, key read from Secret Manager into memory, no Firestore | Routine and low fictional transcripts routed as expected (see the Decisions row above) |
| Patient app on an Android emulator (API 36) against the Firebase emulators, with the dashboard open | By hand, on #49 (see below) | Pass; not rerun on this branch |

The emulator suite needs Firebase CLI 15 or newer. With CLI 14.22.0 the Functions emulator kills every function built with `firebase-functions` 7, and the six callable tests time out.

The end-to-end run on the Android emulator:

1. First open: the app signed in anonymously and created `patients/{uid}` under the rules, linked to `clinician@example.com`, with `sharingConsent: undecided`. It showed the welcome. The dashboard's Patient list was empty.
2. "Share my progress": the record changed to `granted` with a timestamp, the app landed on Today, and "Live patient" appeared on the open dashboard without a reload.
3. "Stop sharing": the record changed to `declined` and the Patient left the open dashboard at once.
4. With the connection to Firestore cut, "Stop sharing" showed "Your sharing choice could not be saved" after the timeout, and both the screen and the record stayed on `granted`.
5. After a restart the app opened on Today with the stored choice, and the Patient was listed again.

### Live deployment (14 November 2026)

The real project `junction26hel-7400` ("Hack Junction 2026-7400", Blaze plan) is set up. It was deployed from the backend stack (`chore/real-project-config`), whose `firebase/` matches this branch's:

| Part | State |
|---|---|
| Firestore `(default)` in `europe-north1` | Security rules and indexes deployed. A signed-out read of a Patient or of `clinicians` gets HTTP 403. |
| Clinician allowlist | One allowed Clinician (the address is kept out of this repository). |
| Demo Patients | Seeded: 401 synthetic documents, linked to the allowed Clinician. |
| Functions in `europe-north1` | `extractIntake`, `saveIntake`, `generateDigest`, `health`, `startCheckIn`, `finishCheckIn` (#14's version). Callers can reach them; the callables refuse anyone not signed in ("Sign in to continue."). |
| `weeklyDigest` in `europe-west1` | Cloud Scheduler has no `europe-north1` location (`SCHEDULER_REGION` in `region.ts`). Not publicly invokable. |
| `GEMINI_API_KEY` secret | Set. One call with the stored key to `gemini-4-hydrogen` (storage off) answered in about 3 s. |
| Container cleanup policies | Set in both regions. |

Deploy notes:
- Cloud Build runs `npm ci` with Node 22's npm 10, so regenerate `firebase/functions/package-lock.json` with npm 10 (`npx npm@10 install`). The lock on this branch passes `npx npm@10 ci`.
- The first deploy didn't grant public invoker access on the callables. It was added by hand (`allUsers` → Cloud Run Invoker) on `extractintake`, `saveintake`, `generatedigest` and `health` only.

`redFlagAlert` and `silenceCheck` are not deployed yet: deploy them with `firebase deploy --only functions:redFlagAlert,functions:silenceCheck --project prod` together with the Trigger Email extension. The `finishCheckIn` of #62 and of this branch (#21) needs `firebase deploy --only functions:finishCheckIn,firestore:rules --project prod` once #60, #62 and this PR are merged; it uses the same `GEMINI_API_KEY` secret. The rules change only adds `outcomeCheckInId` to the fields a client may not set on a new Suggestion (absent is still accepted).

**Not verified (needs a person, hardware or credentials):**
- The Patient app against the real project, and on iOS beyond the build.
- A full Intake extraction or Digest through the deployed callables, signed in as the Clinician. Only the one direct call to `gemini-4-hydrogen` above has been made.
- The app on the S24+ and on an iPhone.
- A full Intake extraction or Digest through the deployed callables, signed in as the Clinician.
- A spoken Check-in, a Check-in on a real phone, and its Summary on the dashboard. `startCheckIn` and `finishCheckIn` are deployed, and a typed Check-in ran end to end from the Android emulator as `demo-declining` (14 November): the Live session with tool calls, Finish Check-in with the real model (8 to 23 seconds), and the Summary on the phone.
- The flag from a real Check-in on the dashboard (#20's last acceptance criterion: "a scripted low Check-in turns that Patient amber on the dashboard with the reason shown"). The pieces are tested separately: the real Decisions API routed a fictional low transcript to amber decline, and the emulator suite shows a finish writing the flag and the Patient's level and reasons, which the dashboard already lists. Not yet run end to end against the deployed functions: deploy this `finishCheckIn`, finish a scripted low typed Check-in on a live, sharing Patient, and look at the dashboard.
- The Outcome from a real Check-in (#21): the text model's `previousPreferNotToSay` (a field added to the #6 spike's schema) and its answers about the previous Suggestion have not been run against the real model; the opt-in real-Gemini emulator test does not check them. Nor has an Outcome been seen on the dashboard's "what seems to help" from a real Check-in: deploy, finish two typed Check-ins on a live, sharing Patient (accept a Suggestion in the first, answer about it in the second) and look at the dashboard.
- A Decisions safety refusal: never observed (the fictional crisis transcript was answered). The handling follows the documented shape only.
- The red flag email arriving in an inbox: needs the Trigger Email extension installed with SMTP credentials, then a red flag on a live, sharing Patient (#22's S24+ check).
- The silence check on the real project: deploy `silenceCheck`, run `npm run silence-test -- --patient <live id> --project <id>`, force-run the scheduler job (`gcloud scheduler jobs run firebase-schedule-silenceCheck-europe-west1 --location=europe-west1`; the job name is the Firebase default and has not been seen in a real project yet), then confirm red on the dashboard, the email, and no Crisis notice or notification on the phone (#28's last acceptance criterion).

## Decisions made in review

1. **Function-only fields.** Summaries are written only by functions. Check-in ratings, Voice cues, the crisis marker, the assessment and `previousTried`, and Suggestion Outcome fields are function-only too. The Patient can't edit what the Clinician reads.
2. **Re-consent shares future records only.** Only the off period is hidden, using the sharing stamp.
3. **Ratings and Voice cues** are included until the Patient leaves them out.
4. **Clearing a flag.** The dashboard computes the new level when a flag is cleared; the rules don't check it.
5. **Region: `europe-north1` (Finland).** The real Firestore database is there, and every function runs there too, except the scheduled `weeklyDigest` and `silenceCheck`: Cloud Scheduler has no `europe-north1` location, so they run in `europe-west1` (`SCHEDULER_REGION`). It is set once for the functions (`REGION` in `firebase/functions/src/region.ts`) and once for the dashboard (`FUNCTIONS_REGION` in `firebase/hosting/js/functions.js`); `firebase/functions/test/region.test.ts` keeps the two in step. The database location itself is chosen when the database is created, not in this repository.
6. **Values the spec didn't fix:**
   - The Baseline spread floor: `max(sample SD, 0.05 × |median|, 0.001)`.
   - A 28-day window for "what seems to help".
   - "Stale" means the latest value is more than 2 days old.
7. **Finish Check-in's flags (#20).**
   - A Decisions failure never blocks the Summary: it raises nothing and sets `assessment: "unavailable"` on the Check-in. Only the text model's retryable failure answers `unavailable` (#60).
   - When the text model fails that way, the flags the judgment raised are written anyway, in their own transaction, and nothing else. The phone's retry finds them by id and raises none again. Otherwise a crisis found only by the review would be lost if the phone never retried.
   - The assessment marker and "tried" live on the Check-in (`assessment`, `previousTried`), not the Summary: the Summary is what the Patient reads and what the response returns, and the Patient never sees a flag.
   - Flag ids are `<kind>-<checkInId>`. A cleared flag of this Check-in is not raised again by a retry.
   - A silent Check-in is not sent for review (`assessment: null`), but its crisis marker still raises red crisis.
8. **The Outcome (#21).**
   - The function finds the target itself; `lastSuggestionId` only confirms it. Trusting the phone's id alone could put an answer on a declined or already answered Suggestion.
   - The text model's answer wins; the Decisions "tried" fills in only when the text model is unsure. `previousTried` on the Check-in stays the review's own answer.
   - "Prefer not to say" is recorded (so it is not asked again) as `outcomeCheckInId` set with `tried` `null`: a new contract field, because unknown, not tried and open could not otherwise be told apart, and a retry could not tell its own Outcome from a later one.
   - `objectiveChange` is the steps on the day the Suggestion was made (the seed's choice), stored for tried and not tried; the score clamps it to ±1 before weighting.
   - An Outcome is applied once; a retry never rewrites it, even if the model hears the answer differently.

## Open items for the backend

- **Moved from the daily job:** the spec has the phone's daily job write `objectiveChange` and `outcomeScore`. They are function-only, and Finish Check-in now computes them when it records the Outcome (#21). If that day's daily record is not written yet when the Outcome is recorded, `objectiveChange` stays `null`; nothing fills it in later. The `core` daily pipeline (#26) does not touch Suggestions.
- **Seams left by #14:**
  - **#17 (tool catalog):** `LIVE_TOOL_DECLARATIONS` in `firebase/functions/src/tools.ts` now holds nine tools written by hand to match `CompanionTools` in `shared`. #17 still replaces them with `core`'s `ToolCatalog` export and adds the comparison test; the token body, field mask and the crisis rule (which names `raise_crisis` once it is declared) need no change.
  - **#20 (Decisions):** built on this branch (see Finish Check-in).
  - **#21 (Outcome):** built on this branch (see Finish Check-in and Outcomes above). For the app: the Outcome step's answer reaches the function only through the transcript (the typed buttons send "I tried the walk.", "Not this time.", "I'd rather not say."), so the Companion should keep those words in the conversation; the Brief should ask about `Outcomes.openSuggestion(...)` and the phone send its id as `lastSuggestionId`.
- **Last Check-in time:** `lastCheckInAtMillis` on the Patient record isn't stamped. After sharing resumes, the list can show the time of a Check-in made while not sharing (only the time).
- **Phone writers:**
  - Keep each record's stamp; never delete and recreate a record.
  - Retry a refused write with a fresh stamp, especially a crisis flag.
  - Create a new Suggestion rather than editing `kind` or `details`.
- **Still open from the spec:** whether to delete Summaries and Digests when sharing is withdrawn.
- **Red flag email for Demo Patients:** `redFlagAlert` skips `synthetic: true` Patients, because the seed recreates their red flags on every run. If a demo should email from a Demo Patient, that needs a demo control that raises a fresh flag, plus a decision to lift the skip for it.
- **Crisis notice from the review (#20, app side):** the spec says a crisis found only by the Decisions backstop shows the Crisis notice on the phone when the result arrives. Finish Check-in's response deliberately carries no flag, so the phone cannot learn it from there. Needs a decision: a response field that only says "show the Crisis notice", or the phone listening to its own new crisis flags.
- **Red flag alert, app side (#22):** the Crisis notice, the dialler, the crisis controller, the offline queue and Support in Settings belong to the app team. The phone only has to create the red `crisis` flag (stamped, not duplicated while one is open). The email follows from that.
- **Silence test from the phone (#31):** the demo panel's "Silence test" can write the Patient's own `lastSeenAtMillis` 25 hours back (the rules let the Patient update that field); until the panel exists, `npm run silence-test` does the same. The phone's daily job must not overwrite it before the next check runs.
- **Blocked on #6** (needs the S24+, the Watch and an iPhone): #14–#22, #24–#27 and #30–#32. The backend part of #28 is built; its device check is not.
- **Spike results (#6):** the backend half is recorded in [spike-results.md](spike-results.md), with raw fixtures in `fixtures/spike/`.
  - **Unblocked backend work:**
    - #14: built (backend part).
    - #20: built on this branch (backend part).
    - #18: the Map tool, being built by a teammate. `mapstools.googleapis.com` is now enabled and verified (HTTP 200 for weather, text search and routes).
  - **Still waiting on a person (S24+, Watch, iPhone, Google account):**
    - The on-phone Live test (#15).
    - Health Connect, HRV and usage statistics (#24).
    - The Calendar consent (#19).
    - The iPhone Live test (#30).
