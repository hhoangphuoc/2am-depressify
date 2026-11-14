# Session handoff: backend build, 14 November 2026

Notes for whoever picks this work up next: a person, or a new Claude Code session. It records what is done, what is in progress, and how to resume. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The detailed status is in [implementation-status.md](../implementation-status.md).

## Scope

This repository's work is the **backend only**: Firestore rules, Cloud Functions, the seed, the data contract, and the Gemini and Google API integrations in [research/](../research/) and [system-design.md](system-design.md). Teammates build the frontend: the Compose Multiplatform Patient UI in `shared` and the design prototypes. The two meet in `shared/data` and the data contract in `core/model`.

## Where the work is (updated 14 November 2026, afternoon)

**`main` is the base.** It contains:
- PR #49, which integrates the backend with the teammates' Patient UI;
- everything ported onto #49, merged by hand into it: #22 `redFlagAlert`, the `europe-west1` scheduler region, #28 `silenceCheck`, the #6 spike results and fixtures, #14 `startCheckIn` / `finishCheckIn` and `LiveProtocol` in `core`, this file, and the setup record. PRs #50 and #52–#57 show as closed for that reason.
- the teammate's app-side Check-in over Gemini Live (#58).

The old stack (#34–#45) and `integrate/ui-main` are superseded.

Open PRs:

| PR | Branch | Owner | Content |
|---|---|---|---|
| #60 | `codex/check-in-review-fixes` → `main` | repo owner | Caps in `patientLimits` (10 Check-in starts and 5 red flag emails an hour per Patient); a retryable model failure → `unavailable`; the Summary stamp from the Check-in |
| #62 | `feat/20-checkin-flags` → #60 | us | #20: the Decisions API in Finish Check-in → flags; `CheckIn.assessment`, `CheckIn.previousTried` |
| #65 | `feat/21-outcomes` → #62 | us | #21: the Outcome on the previous Suggestion, the Outcome score, `objectiveChange`, ranking (TypeScript and Kotlin `core.learning`); `Suggestion.outcomeCheckInId` |
| #61 | `codex/find-places` | teammate | #18, the Map tool. **Not ours: the user asked us not to implement #18**, only to make sure the Maps configuration works (it does). |
| #63 | `codex/patient-context-suggestions` → #61 | teammate | Today suggestions (`suggestToday`), maps and music. It touches `Models.kt`, the seed and `checkInFunctions.ts`, so expect conflicts with #65. |

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

1. When #60, #62 and #65 merge: deploy `finishCheckIn` and the rules (after the user agrees). Then run two real Check-ins on a live, sharing Patient and check the dashboard.
2. Deploy `redFlagAlert` and `silenceCheck` once the Trigger Email extension is installed (needs SMTP). Grant Cloud Run Invoker to any new callable.
3. Waiting on the user: Patient sign-in by email and password. Invite-only, or open sign-up with email verification? The backend half is `email_verified`, a `role: "clinician"` custom claim, the seed and tests, and an ADR.
4. Open questions for the team:
   - #20: how the phone learns to show the Crisis notice when only Decisions finds a crisis (the response reveals no flag).
   - The dashboard showing "assessment unavailable".
   - #21: which day's steps count, and whether to add an explicit Outcome answer to the Finish request.
5. Suggested hardening: App Check on the callables, `maxInstances`, and a billing budget alert.

**npm caution:** in `firebase/functions` always use `npx -y npm@10 install` / `ci`. The local npm 11 rewrites `package-lock.json` into a shape Cloud Build's npm 10 rejects.

## Needs the user or a person

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
