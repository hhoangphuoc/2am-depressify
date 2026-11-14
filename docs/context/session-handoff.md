# Session handoff: backend build, 14 November 2026

Notes for whoever picks this work up next: a person, or a new Claude Code session. It records what is done, what is in progress, and how to resume. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The detailed status is in [implementation-status.md](../implementation-status.md).

## Scope

This repository's work is the **backend only**: Firestore rules, Cloud Functions, the seed, the data contract, and the Gemini and Google API integrations in [research/](../research/) and [system-design.md](system-design.md). Teammates build the frontend: the Compose Multiplatform Patient UI in `shared` and the design prototypes. The two meet in `shared/data` and the data contract in `core/model`.

## Where the work is

### The integration base: PR #49

PR #49 (`codex/backend-integration` → `main`) is **the** integration of the backend with the teammates' Patient UI. Build on it.

- It starts from `main` and keeps `main`'s Patient UI.
- From our stack tip (`chore/real-project-config` at `14d751e`) it copies `firebase/`, `fixtures/` and the `core/model` data contract. The exported `contract.json` is byte-identical.
- It has **no Koin**. Its own small data layer is in `shared/data` (`AuthGateway`, `PatientStore`, `ConsentStore`, `PatientSession`, GitLive in `shared/data/firebase`), and `PatientViewModel` is wired to it.
- What the app does with the backend: anonymous sign-in, the Patient record, and the sharing Consent, saved before the screen changes. "Explore the demo" records no choice. When Firebase can't be reached at start, the app stays on local demo data.
- Still demo data on the Patient screens: Check-ins, Summaries, Signals, Signal Consents, quiet hours and booking.
- If #49 lands, the old stack PRs #34 to #45 can be closed.

### Superseded: `integrate/ui-main`

`integrate/ui-main` merged the whole stack with `main`'s UI and wired our older data layer (with Koin) into `PatientViewModel`. #49 replaces it. Keep it unmerged, as a reference only: for example, it also wired the ratings and Voice cue Consents, which #49 doesn't yet.

### Extras ported onto #49

Each piece is its own branch, created from `origin/codex/backend-integration` with `git cherry-pick -x` from the old branches. Nothing is pushed yet and no PRs are open; add the PR numbers here when they are.

| Branch | From | Content | PR |
|---|---|---|---|
| `feat/22-red-flag-alert-on-49` | `feat/22-red-flag-alert` (`70a6103`, `7bd59ec`) | `redFlagAlert`: a Firestore trigger that writes one Trigger Email document per red, shared flag. Also the `adminDb()` `[DEFAULT]` fix, the emulator test, the docs, and the gitignored `firebase/extensions/*.env`. | not opened |
| `fix/digest-scheduler-region-on-49` | `671a5f8` on `chore/real-project-config` | `weeklyDigest` runs in `SCHEDULER_REGION` (`europe-west1`), plus "Live deployment" in the status doc. | not opened |
| `feat/28-silence-check-on-49` | `feat/28-silence-check` (`aebd98d`, `4942ff6`, `b55782b`) | The hourly `silenceCheck`, the `silence-test` seed command, and the docs. Built on `feat/22-red-flag-alert-on-49`, and it merges `fix/digest-scheduler-region-on-49`, because it needs `SCHEDULER_REGION`. | not opened |
| `feat/6-spike-results-on-49` | `feat/6-spike-results` (`bda4e3b`) | `docs/spike-results.md` and the redacted fixtures in `fixtures/spike/`. | not opened |
| `docs/session-handoff-on-49` | `dd7f2b6`, `fde5d18` | This file, rewritten for #49. | not opened |

The lock file needed no port: #49's `firebase/functions/package-lock.json` already matches the npm 10 one (`82e1834`), and `npx -y npm@10 ci --dry-run` accepts it.

### In progress

| Work | Branch (worktree under `.claude/worktrees/`) | State |
|---|---|---|
| #14: the Start Check-in and Finish Check-in callables, plus Live protocol parsing in `core` if time allows | `feat/14-typed-checkin` (`issue-14-typed-checkin`), started from `integrate/ui-main` | In progress. Port it onto #49 as its own branch when it's done. Anything that uses Koin or the old `shared` packages must move to #49's `shared/data`. |
| #6 throwaway harness | `spike/6-throwaway` | Keep unmerged |

## Decisions the user made

- **Function-only fields:** Summaries, Check-in ratings, Voice cues, the crisis marker and Suggestion Outcome fields are written only by functions.
- **Re-consent shares future records only:** the off period stays hidden through the `sharedWithClinician` stamp; earlier shared history comes back.
- **Ratings and Voice cues** are included until the Patient leaves them out.
- **Values kept as built:** the dashboard computes the level after a clear, the Baseline spread floor, the 28-day "what helps" window, and stale meaning more than 2 days.
- **Repository and identity:** the repo is public, so the Clinician email is never committed. The Kotlin package is `app.depressify`. The Patient app id is the teammates' `app.depressify.patient` (Android and iOS).
- **Alert emails skip Demo Patients**, so reseeding never emails the Clinician.

## Real project `junction26hel-7400` ("Hack Junction 2026-7400", Blaze)

Deployed from the old stack (`chore/real-project-config` with `671a5f8`). Its `firebase/` matches #49's plus the scheduler region fix.

| Part | State |
|---|---|
| Firestore `(default)` | `europe-north1`. Rules and indexes deployed; signed-out reads get HTTP 403. |
| Auth | Anonymous and Email/Password enabled; the Clinician user exists. |
| Clinician allowlist | One email in `clinicians/{email}`. |
| Demo Patients | Seeded (401 documents). |
| Secrets | `GEMINI_API_KEY` (checked with a real call to `gemini-4-hydrogen`) and `MAPS_API_KEY`. |
| APIs enabled | Gemini (Generative Language), Places API (New), Weather API. **Not yet:** Maps Tools (`mapstools.googleapis.com`), Routes API. |
| Android apps registered | `app.depressify.patient` (in use; SHA-1 and SHA-256 of the main Mac's debug key) and `app.depressify` (unused). |
| iOS app | **Not registered.** |
| Hosting (the dashboard) | Not deployed. |
| `redFlagAlert`, `silenceCheck` | Not deployed. |

**Deployed endpoints:**

| Function | Type | Where |
|---|---|---|
| `extractIntake` | callable | `https://europe-north1-junction26hel-7400.cloudfunctions.net/extractIntake` |
| `saveIntake` | callable | `https://europe-north1-junction26hel-7400.cloudfunctions.net/saveIntake` |
| `generateDigest` | callable | `https://europe-north1-junction26hel-7400.cloudfunctions.net/generateDigest` |
| `health` | HTTP | `https://europe-north1-junction26hel-7400.cloudfunctions.net/health` |
| `weeklyDigest` | scheduled, Mondays 07:00 Helsinki, private | `europe-west1` |

The callables are public at the network level (`allUsers` → Cloud Run Invoker, added by hand) and refuse anyone not signed in. Apps call them through the Firebase SDK by name and region, not by URL.

**Region:** Cloud Scheduler rejects `europe-north1` ("Location 'europe-north1' is not a valid location"); this was seen on the real deploy. Scheduled functions (`weeklyDigest`, and `silenceCheck` once deployed) must use `SCHEDULER_REGION` (`europe-west1`). #49 on its own still has `weeklyDigest` in `europe-north1`, and its PR text calls this unchecked. **Don't deploy functions from a branch without `fix/digest-scheduler-region-on-49`.**

## Spike facts the build relies on

Details are in `docs/spike-results.md` (on `feat/6-spike-results-on-49`).

- **Live token:** `POST /v1beta/auth_tokens` with `bidiGenerateContentSetup` plus a `fieldMask` that lists every field set, **including `model`**. `liveConnectConstraints` is rejected by REST. Return only `name` to the phone, and never log it.
- **Live client:** a raw Ktor WebSocket from common Kotlin to `BidiGenerateContentConstrained` (`v1beta`) worked with `gemini-3.8-live` on the OkHttp and CIO engines. Server frames are binary. Firebase AI Logic is the fallback only.
- **Structured output:** `/v1/interactions` (`v1beta` is the same) with `response_format` and a JSON Schema, on `gemini-4-hydrogen` with `store: false`.
- **Decisions:** `POST /v1beta/decisions`, `gemini-decision-1`, three `noul` questions (`crisis`, `decline`, `triedLast`).
- **Maps:** Maps agent tools get HTTP 403 until `mapstools.googleapis.com` is enabled. Direct Places (New) and Weather work. Routes gets 403 (not enabled).
- **The SDK defaults to `v1`.** Live tokens and Decisions exist only on `v1beta`, so those calls must set the API version.

## Next

1. Push the ported branches and open their PRs against `codex/backend-integration` (or against `main` once #49 lands), after the user agrees. Order: the region fix and #22 first, then #28, which stacks on both. The spike results and this file are independent.
2. When #14 is done: port it onto #49, then #20 (Decisions into flags), then #21 (ratings, Outcome, `objectiveChange` / `outcomeScore`). Each goes on its own branch, stacked.
3. #18, the Map tool: needs `mapstools.googleapis.com` enabled (recommended) and the tool catalog from #17.
4. Deploy the new functions (`redFlagAlert`, `silenceCheck`, then `startCheckIn`, `finishCheckIn`) after the user agrees. Deploy the dashboard too, or set `DASHBOARD_URL`, because the alert email links to `https://<project>.web.app`, which isn't deployed yet.
5. For the UI team:
   - In the offline fallback the sharing choice shown is local and can differ from the stored one (the `shortcut:` comment in `PatientViewModel.connect`).
   - `core` has two sets of types, the screen models and the contract, which don't map one to one yet.
   - Switch screens from demo data to the backend as each function lands (see `docs/implementation-status.md`).

**npm caution:** in `firebase/functions` always use `npx -y npm@10 install` / `ci`. The local npm 11 rewrites `package-lock.json` into a shape Cloud Build's npm 10 rejects. The README's plain `npm install` is fine in `firebase/seed`.

## Needs the user or a person

- Enable the **Maps Tools API** (`mapstools.googleapis.com`; the key already allows it). Enable the Routes API too only if we fall back to the direct APIs.
- SMTP details for the **Trigger Email** extension (#22). The install steps are in the README on `feat/22-red-flag-alert-on-49`.
- Require `email_verified` in `authEmail()` in `firestore.rules` before real Patients use the app.
- The device parts of #6: Live on the S24+ with the real microphone, Live on an iPhone, Health Connect and HRV with the Watch, usage statistics, and the Calendar consent.
- Register the **iOS app** (`app.depressify.patient`) in the Firebase console, and put its `GoogleService-Info.plist` and a `Secrets.plist` in `iosApp/Depressify/` (both gitignored).

## How to resume

- **Secrets:** `secrets.properties` at the repo root and in each worktree (gitignored) holds the real project config. The Gemini and Maps keys live only in Secret Manager. Never print or commit them.
- **CLI access:** the Firebase CLI is logged in as the project owner, and Application Default Credentials are set with quota project `junction26hel-7400`.
- **Toolchain:** JDK 21 at `/opt/homebrew/opt/openjdk@21`, Android SDK at `~/Library/Android/sdk`, Firebase CLI 15 or newer (14 can't load functions built with `firebase-functions` 7), and gcloud.
- **Local tests** use the emulator project `demo-twoam`. Parallel agents shared one emulator through a lock script, because the ports are fixed.
- **Before a functions deploy:** check the lock with `npx -y npm@10 ci --dry-run` in `firebase/functions`, and that the branch has `SCHEDULER_REGION`.
- **Full test sweep on #49:**
  - `./gradlew :core:jvmTest :shared:testAndroidHostTest :androidApp:assembleDebug`
  - `npm test` in `firebase/functions` and in `firebase/seed`
  - `node --test` in `firebase/hosting`
  - `firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"` (build the functions first), and `"npm --prefix seed run test:emulator"`
