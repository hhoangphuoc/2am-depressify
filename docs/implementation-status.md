# Implementation status

Status as of 14 November 2026. Covers issues #7, #8, #9, #10, #11, #12, #13, #23 and #29, the backend part of #22 (the red flag email), the silence check (#28), the backend half of the #6 spikes, the backend part of #14 (Start and Finish Check-in, and the Live protocol parsing in `core`), the pure `core` pipeline of the daily job (#26), the Nudge rules and quiet hours in `core` (#27), the review decisions that followed, and the backend half of the #6 spikes ([spike-results.md](spike-results.md)). Terms follow [GLOSSARY.md](../GLOSSARY.md).

## Work on top of this branch (open PRs)

Kept up to date as PRs are opened and merged. Each PR also updates its own rows further down this file. Last updated 14 November 2026.

| PR | Branch | Issue | State |
|---|---|---|---|
| #49 | `codex/backend-integration` → `main` | Integration of the backend with the Patient UI | Base for everything below |
| #50 | `feat/22-red-flag-alert-on-49` | #22, backend: `redFlagAlert` email on a red flag | Open; tested (functions 166, emulators 82) |
| #52 | `feat/6-spike-results-on-49` | #6, backend half: spike results and fixtures | Open |
| #53 | `fix/digest-scheduler-region-on-49` | `weeklyDigest` in `europe-west1` (Cloud Scheduler has no `europe-north1`), plus the live deployment record | Open. **Merge before deploying functions from #49.** |
| #54 | `feat/28-silence-check-on-49` (on #50) | #28: `silenceCheck`, hourly | Open; tested (functions 206, emulators 86 + 16) |
| #55 | `docs/session-handoff-on-49` | Session handoff, and this overview | Open |
| #56 | `docs/cloud-setup-on-49` | Firebase and Google Cloud setup record | Open |
| #57 | `feat/14-typed-checkin-on-49` (on #50, merges #52) | #14, backend: `startCheckIn`, `finishCheckIn`, and `LiveProtocol` in `core` | Open; tested (functions 249, core 39, emulators 87 + 14). Not deployed. |
| #69 | `feat/26-daily-job-rules` (from `main`) | #26, `core` only: the daily job's pure pipeline (daily record, Baseline, sign of life, Signal flag rules, write plan) | Tested (core 105, seed 91); the app's background work, debug action and device check are still to do |
| #68 | `feat/27-nudge-rules` → `feat/26-daily-job-rules` (stacked on #69) | #27, `core` part: Nudge rules, Nudge text, quiet hours, and the `core` purity check | Open; tested (core CORE68) |
| — | — | #20 (Decisions into flags), then #21 (Outcomes) | Next, after #14 |
| — | — | #18 (Map tool) | Waits on enabling `mapstools.googleapis.com` and the #17 tool catalog |

The stacked PRs #34–#45 are superseded by #49 and can be closed once it lands. `integrate/ui-main` is kept as a reference only; it also wired the ratings and Voice cue Consents into the app, which #49 doesn't yet.

**Deployed on `junction26hel-7400`:**
- Rules and indexes.
- `extractIntake`, `saveIntake`, `generateDigest` and `health` in `europe-north1`.
- `weeklyDigest` in `europe-west1`.

**Not deployed:** `redFlagAlert`, `silenceCheck`, the Check-in functions, Hosting and the Trigger Email extension.

The full setup is recorded in [context/firebase-and-google-cloud-setup.md](context/firebase-and-google-cloud-setup.md) (PR #56).

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
  - The red flag alert (#22) and the silence check (#28) skip Patients who aren't sharing.
  - Every function that writes must stamp what it writes.
- **Flag level on the Patient record:** `flagLevel` and `flagReasons` count only flags stamped `true`, so a flag raised while sharing was off doesn't leak its reason to the Clinician.

### Cloud Functions (`firebase/functions`, TypeScript, region `europe-north1`; the scheduled job in `europe-west1`)

| Function in [system design](context/system-design.md#cloud-functions) | Status | Notes |
|---|---|---|
| Extract Intake | **Built:** `extractIntake` and `saveIntake` (#13) | Clinician-only callables. Extraction writes nothing; saving writes only `intakeHighlights` (at most 120 words). The report is never stored or logged, and a spy test checks this. |
| Weekly Digest | **Built:** `weeklyDigest` (Mondays 07:00 Helsinki) and `generateDigest` (callable) (#23) | Document key is the ISO week (`2026-W46`). Uses only shared records. A week with no Check-ins gets fixed text and never calls the model. Patients who aren't sharing get no Digest. |
| Start Check-in (Live token) | **Built:** `startCheckIn` (#14, backend part), callable in `europe-north1`, deployed | Caller rule (`assertActsAsPatient` in `src/patientCaller.ts`, mirroring `actsAsPatient` in the rules): `auth.uid == patientId`, or anyone signed in when the Patient is `synthetic: true`; signed out is `unauthenticated`, anyone else or a missing Patient `permission-denied`. Request `{patientId, brief, mode?}` (Brief 1 to 12,000 characters, mode `typed` or `spoken`), response `{checkInId, token, model, endpoint, mode, connectByMillis, expiresAtMillis}`. Mints a single-use token with the recorded `bidiGenerateContentSetup` + `fieldMask` body, locked to `gemini-3.8-live`, the Brief plus fixed safety rules, the tool declarations (`src/tools.ts`, nine BLOCKING tools the phone runs in `CompanionTools`), AUDIO output and both transcriptions; 60 s to connect, 10-minute lifetime. Creates `checkIns/{id}` (function-only fields empty, `sharingStamp`). A real mint and a typed turn on that token were checked by hand. Client contract in the [README](../README.md#check-in-start-and-finish). |
| Finish Check-in | **Built:** `finishCheckIn` (#14, backend part), callable in `europe-north1`, deployed; Decisions (#20) and the Outcome (#21) not yet | Same caller rule as Start Check-in. Request `{patientId, checkInId, draft, todayLines?, lastSuggestionId?}`, response `{checkInId, summary, minimal}`; a Check-in Start Check-in never created is `not-found`. Text model with storage off and structured output; writes the Summary (keyed by the Check-in, a retry overwrites, stamp kept; a retry without model output keeps what the model wrote before), the ratings, Voice cues (from the draft), crisis marker and end time, and the Patient's `lastCheckInAtMillis` / `lastSeenAtMillis`, in one transaction. Silent Check-ins and bad model output give a minimal Summary. The draft is never written or logged; a spy test checks this. `TODO(#20)` and `TODO(#21)` mark where the Decisions call and the Outcome write go. |
| Map tool | Not built | #18. Direct Places and Weather fixtures recorded; Maps agent tools needs `mapstools.googleapis.com` enabled ([spike results](spike-results.md#5-maps-18)). |
| Red flag alert | **Built:** `redFlagAlert` (#22, backend part) | Firestore trigger on the creation of `patients/{patientId}/flags/{flagId}`, in `europe-north1`, retried on failure. For a flag that is red, uncleared and stamped `sharedWithClinician: true`, of a Patient who is sharing, isn't synthetic and has a `clinicianEmail`, it writes one Trigger Email document to `mail/red-flag-<sha256(patientId/flagId)>` with `create()`, so a retry never sends twice. The subject marks a crisis apart from other reds (`[CRISIS]` / `[RED]`). The body is the display name, the flag's reason, a fixed line per kind (a quiet phone isn't read as self-harm) and a link to the Patient page from `DASHBOARD_URL` (defaults to `https://<project>.web.app`). Pure logic in `src/alerts.ts`. Logs only ids, kind and outcome; a spy test checks this. **Sending needs the Trigger Email extension, which needs a person** (below). |
| Silence check | **Built:** `silenceCheck` (#28) | Scheduled at the top of every hour, Europe/Helsinki, in `europe-west1` (`SCHEDULER_REGION`: Cloud Scheduler has no `europe-north1`). For each Patient who is sharing, isn't synthetic and was last seen (`lastSeenAtMillis`) more than 24 hours ago, it creates a red `silent` flag at `silent-<lastSeenAtMillis>`, stamped with `sharingStamp` (true), and raises the record's `flagLevel` and `flagReasons` in the same transaction, after reading the record again. Exactly 24 hours, never seen (`null`) and a time in the future are not silent. No second flag while one is open, and none again for a silence the Clinician already cleared. Reason: "The phone has been quiet: it has not connected for over 24 hours." It sends no email itself: `redFlagAlert` does. Pure logic in `src/silence.ts`. Logs only ids and counts; a spy test checks this. **Demo:** `npm run silence-test -- --patient <id> [--project <id>]` in `firebase/seed` sets a live, sharing Patient's last sign of life to 25 hours ago (refuses Demo Patients and Patients not sharing); force-run the Cloud Scheduler job to run the check at once. No callable or HTTP trigger was added. |

There is also a trivial `health` endpoint.

Deployed on the project `junction26hel-7400`, with `GEMINI_API_KEY` set as a function secret:

| Function | Type | Endpoint |
|---|---|---|
| `extractIntake` | Callable, Clinician only | `https://europe-north1-junction26hel-7400.cloudfunctions.net/extractIntake` |
| `saveIntake` | Callable, Clinician only | `https://europe-north1-junction26hel-7400.cloudfunctions.net/saveIntake` |
| `generateDigest` | Callable, Clinician only | `https://europe-north1-junction26hel-7400.cloudfunctions.net/generateDigest` |
| `health` | HTTP | `https://europe-north1-junction26hel-7400.cloudfunctions.net/health` (answered `{"ok":true}` on 14 November 2026) |
| `weeklyDigest` | Scheduled, Mondays 07:00 Helsinki | `europe-west1`. Private: only Google's scheduler can call it. |

The callables are reached through the Firebase SDK (`httpsCallable` in `europe-north1`), which adds the caller's sign-in token; they are not plain REST endpoints. `weeklyDigest` is deployed in `europe-west1`, and `SCHEDULED_REGION` in `src/region.ts` now says so.

### Live protocol parsing (`core`, #14)

`app.depressify.core.live.LiveProtocol`, pure common Kotlin (no platform imports; the purity check, `checkCommonPurity` in `core/build.gradle.kts`, runs before `:core:jvmTest`):
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

### Nudge rules and quiet hours (`core`, #27)

**Built** in `app.depressify.core.nudge`, pure common Kotlin with tests. Nothing in the data contract changed.

- **`NudgeDecision.decide(NudgeInput): NudgeOutcome`**: `None(NoNudgeReason)` or `Nudge(NudgeReason)`.
  - Inputs: `now` and the Patient's `timeZone`, `nudgesEnabled`, `lastNudgeAt`, `quietHours`, `recentDays` (daily records with their stored `vsBaseline`), `lastCheckInAt`, `calendar` (`Busy`, `Free`, `Unknown`), `weather` (`Good`, `Bad`, `Unknown`), `staleAfterDays`.
  - No Nudge, in this order: Nudges off; one already sent today (local date); inside quiet hours (overnight windows included; invalid quiet hours count as the default); calendar busy.
  - Otherwise the first that applies:
    1. `RoughNights`: the newest record not dated in the future and the record for the day before, both no older than the staleness limit and both with sleep at or below −1, and time at home or late-night screen time above +1 on either day.
    2. `FreeHourGoodWeather`: `Free` and `Good`.
    3. `NoCheckInByEvening`: 17:00 or later with no Check-in today.
  - Unknown calendar or weather never counts as free or good. A missing night never counts. Stale or future-dated records are never evidence.
- **`NudgeThresholds`**: every threshold and time, all starting values. Sleep −1, "more than usual" above +1, 17:00, a 60-minute window, records stale after 1 day.
- **`CalendarAvailability.forWindow(busy, now)`**: turns free/busy intervals into `Busy` or `Free` for the next hour. No reading gives `Unknown`.
- **`NudgeNotification.forNudge(nudge)`**: the interface design's copy, "A moment for you?" / "Your Check-in is here when you want it.", for every reason.
- **`QuietHoursRules`**, on top of `QuietHours` / `LocalMinutes` in `Schedule.kt`:
  - `Default` is 21:00 to 09:00. `validate` accepts overnight ranges and rejects identical endpoints and times off the hour.
  - `fromContract` / `toContract` map to the Patient record's whole-hour `quietHoursStart` / `quietHoursEnd`. A broken stored record reads as the default.
  - `display` shows the time zone: `21:00–09:00 (Europe/Helsinki)`.
- **Kept on the phone, not in Firestore:** the last Nudge time and the Nudge on/off choice. Nudges are local notifications decided on the phone, so nothing else reads them. A reinstall forgets them, which allows at most one extra Nudge that day.
- **The app team wires up:**
  - Calling `decide` from the daily job, after today's daily record is built.
  - Recording `lastNudgeAt` when it posts.
  - The calendar and weather reads.
  - The notification, its channel, the permission (denied gives `nudgesEnabled = false`), and the tap into a ready-to-start Check-in without the microphone.
  - The quiet-hours screen through `QuietHoursRules`, and its Compose UI tests.
  - The S24+ check.
- **Open:** the quiet-hours screen steps by 30 minutes, but the Patient record stores whole hours. Either the stepper moves by an hour, or the contract moves to minutes.

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
| EU region | System design, ADR 0008 | `europe-north1` for the functions and the dashboard; the scheduled `weeklyDigest` and `silenceCheck` run in `europe-west1`, because Cloud Scheduler has no `europe-north1` location. |
| GitLive `firebase-kotlin-sdk` 2.8.0 in shared code | ADR 0008 | Holds. |
| Anonymous Patient sign-in, linked to the one Clinician on first open | System design, roles | Holds, now behind `main`'s screens. |

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

Results on `feat/14-typed-checkin-on-49` (on #50, with #52's spike fixtures merged in), all from local runs on 14 November 2026:

| Suite | Command | Result |
|---|---|---|
| Kotlin `core` (contract, `CoreRulesTest`, `LiveProtocolTest`, `LiveProtocolFixturesTest`, and on `feat/26-daily-job-rules` the daily pipeline, `BaselineFixtureTest` and `SignalRulesFixtureTest`) | `./gradlew :core:jvmTest` | 39 pass; 105 on `feat/26-daily-job-rules` (66 new). The exported contract is unchanged |
| Kotlin `shared` (session and view model wiring, with fakes) | `./gradlew :shared:testAndroidHostTest` | 10 pass; 16 on `feat/26-daily-job-rules` (from `main`) |
| Android build | `./gradlew :androidApp:assembleDebug` | APK builds |
| iOS build | `xcodegen generate`, then `xcodebuild` for the arm64 simulator | Builds and links with the Firebase iOS SDK |
| Functions | `cd firebase/functions && npm test` | 206 pass; 291 on `feat/26-daily-job-rules` (from `main`, after `npx -y npm@10 ci`), with the contract drift guard |
| Seed | `cd firebase/seed && npm test` | 89 pass; 91 on `feat/26-daily-job-rules` (`flags.test.js`) |
| Dashboard helpers | `cd firebase/hosting && node --test` | 308 pass |
| Rules, functions and end-to-end on the emulators | `firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"` | 86 pass with Firebase CLI 15.36.0, including the `redFlagAlert` trigger and the silence test raising red with one email |
| Seed on the emulator | `... "npm --prefix seed run test:emulator"` | 16 pass (with the Functions emulator; the seeded Demo Patients' red flags are skipped as synthetic) |
| Patient app on an Android emulator (API 36) against the Firebase emulators, with the dashboard open | By hand, see below | Pass |

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
| Functions in `europe-north1` | `extractIntake`, `saveIntake`, `generateDigest`, `health`. Callers can reach them; the callables refuse anyone not signed in ("Sign in to continue."). |
| `weeklyDigest` in `europe-west1` | Cloud Scheduler has no `europe-north1` location (`SCHEDULER_REGION` in `region.ts`). Not publicly invokable. |
| `GEMINI_API_KEY` secret | Set. One call with the stored key to `gemini-4-hydrogen` (storage off) answered in about 3 s. |
| Container cleanup policies | Set in both regions. |

Deploy notes:
- Cloud Build runs `npm ci` with Node 22's npm 10, so regenerate `firebase/functions/package-lock.json` with npm 10 (`npx npm@10 install`). The lock on this branch passes `npx npm@10 ci`.
- The first deploy didn't grant public invoker access on the callables. It was added by hand (`allUsers` → Cloud Run Invoker) on `extractintake`, `saveintake`, `generatedigest` and `health` only.

`redFlagAlert` and `silenceCheck` are not deployed yet: deploy them with `firebase deploy --only functions:redFlagAlert,functions:silenceCheck --project prod` together with the Trigger Email extension.

**Not verified (needs a person, hardware or credentials):**
- The Patient app against the real project, and on iOS beyond the build.
- A full Intake extraction or Digest through the deployed callables, signed in as the Clinician. Only the one direct call to `gemini-4-hydrogen` above has been made.
- The app on the S24+ and on an iPhone.
- A full Intake extraction or Digest through the deployed callables, signed in as the Clinician.
- A spoken Check-in, a Check-in on a real phone, and its Summary on the dashboard. `startCheckIn` and `finishCheckIn` are deployed, and a typed Check-in ran end to end from the Android emulator as `demo-declining` (14 November): the Live session with tool calls, Finish Check-in with the real model (8 to 23 seconds), and the Summary on the phone.
- The red flag email arriving in an inbox: needs the Trigger Email extension installed with SMTP credentials, then a red flag on a live, sharing Patient (#22's S24+ check).
- The silence check on the real project: deploy `silenceCheck`, run `npm run silence-test -- --patient <live id> --project <id>`, force-run the scheduler job (`gcloud scheduler jobs run firebase-schedule-silenceCheck-europe-west1 --location=europe-west1`; the job name is the Firebase default and has not been seen in a real project yet), then confirm red on the dashboard, the email, and no Crisis notice or notification on the phone (#28's last acceptance criterion).

## Decisions made in review

1. **Function-only fields.** Summaries are written only by functions. Check-in ratings, Voice cues, the crisis marker and Suggestion Outcome fields are function-only too. The Patient can't edit what the Clinician reads.
2. **Re-consent shares future records only.** Only the off period is hidden, using the sharing stamp.
3. **Ratings and Voice cues** are included until the Patient leaves them out.
4. **Clearing a flag.** The dashboard computes the new level when a flag is cleared; the rules don't check it.
5. **Region: `europe-north1` (Finland).** The real Firestore database is there, and every function runs there too, except the scheduled `weeklyDigest` and `silenceCheck`: Cloud Scheduler has no `europe-north1` location, so they run in `europe-west1` (`SCHEDULER_REGION`). It is set once for the functions (`REGION` in `firebase/functions/src/region.ts`) and once for the dashboard (`FUNCTIONS_REGION` in `firebase/hosting/js/functions.js`); `firebase/functions/test/region.test.ts` keeps the two in step. The database location itself is chosen when the database is created, not in this repository.
6. **Values the spec didn't fix:**
   - The Baseline spread floor: `max(sample SD, 0.05 × |median|, 0.001)`.
   - A 28-day window for "what seems to help".
   - "Stale" means the latest value is more than 2 days old.

## Open items for the backend

- **Moved from the daily job:** the spec has the phone's daily job write `objectiveChange` and `outcomeScore`. These are now function-only, so Finish Check-in computes them (#21, PR #65). The `core` daily pipeline (#26) does not touch Suggestions.
- **Seams left by #14:**
  - **#17 (tool catalog):** `LIVE_TOOL_DECLARATIONS` in `firebase/functions/src/tools.ts` now holds nine tools written by hand to match `CompanionTools` in `shared`. #17 still replaces them with `core`'s `ToolCatalog` export and adds the comparison test; the token body, field mask and the crisis rule (which names `raise_crisis` once it is declared) need no change.
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
- **Silence test from the phone (#31):** the demo panel's "Silence test" can write the Patient's own `lastSeenAtMillis` 25 hours back (the rules let the Patient update that field); until the panel exists, `npm run silence-test` does the same. The phone's daily job must not overwrite it before the next check runs.
- **Blocked on #6** (needs the S24+, the Watch and an iPhone): #14–#22, #24–#27 and #30–#32. The backend part of #28 is built; its device check is not.
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
