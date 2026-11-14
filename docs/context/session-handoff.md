# Session handoff: backend build, 14 November 2026

Notes for whoever picks this work up next: a person, or a new Claude Code session. It records what this session set out to do, what is done, what is in progress, and how to resume. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The detailed status is in [implementation-status.md](../implementation-status.md).

## Scope

This repository's work is the **backend only**: Firestore rules, Cloud Functions, the seed, the data contract, and the Gemini and Google API integrations in [research/](../research/) and [system-design.md](system-design.md). Teammates build the frontend: the Patient app UI in `shared`, and the design prototypes. The two are joined through the data layer and the data contract.

## Plan for this session

1. Build the issues that don't need hardware: #7, #8, #9, #13, #29, then #10, #11, #12, #23.
2. Apply the review decisions: function-only fields, and re-consent that shares future records only.
3. Set up the real Firebase project and deploy the backend.
4. Merge the teammates' UI from `main` and wire the backend into it.
5. Build the backend half of the remaining issues: #6 (spikes), #14, #18, #20, #21, #22, #28.

## Done

### Issues and PRs (pushed, stacked: merge in order)

| PR | Branch | Content |
|---|---|---|
| #34 | `feat/7-walking-skeleton` | KMP scaffold, data contract, five test seams |
| #35 | `feat/8-security-rules` | Firestore rules for the whole contract |
| #36 | `feat/9-demo-patients` | Deterministic seed of three Demo Patients, shared Baseline fixture, Patient list |
| #37 | `feat/13-intake` | `extractIntake` / `saveIntake` (Gemini text model, storage off) |
| #38 | `feat/29-sharing-consent` | Sharing gate in the rules and functions |
| #39 | `feat/11-patient-overview` | Dashboard Patient page, Phases, Visits |
| #40 | `feat/10-attention-queue` | Red banner, clearing flags |
| #41 | `feat/23-weekly-digest` | `weeklyDigest` / `generateDigest` |
| #42 | `feat/12-signals-summaries` | Signals, Summaries, what seems to help |
| #43 | `fix/review-decisions` | Function-only fields, the `sharedWithClinician` stamp, `docs/implementation-status.md` |
| #45 | `chore/real-project-config` | Clinician email out of the repo (allowlist), region `europe-north1`, app id and Kotlin package `app.depressify` |

**Not pushed yet** on `chore/real-project-config`:
- the npm 10 lock-file fix (`82e1834`);
- `weeklyDigest` in `europe-west1` (`671a5f8`);
- this file.

### Decisions the user made
- **Function-only fields:** Summaries, Check-in ratings, Voice cues, the crisis marker and Suggestion Outcome fields are written only by functions.
- **Re-consent shares future records only:** the off period stays hidden through the `sharedWithClinician` stamp; earlier shared history comes back.
- **Ratings and Voice cues** are included until the Patient leaves them out.
- **Values kept as built:** the dashboard computes the level after a clear, the Baseline spread floor, the 28-day "what helps" window, and stale meaning more than 2 days.
- **Repository and identity:** the repo is public, so the Clinician email is never committed. The Kotlin package is `app.depressify`. The Patient app id is the teammates' `app.depressify.patient`.

### Real project `junction26hel-7400` ("Hack Junction 2026-7400", Blaze)

| Part | State |
|---|---|
| Firestore `(default)` | `europe-north1`. Rules and indexes deployed; signed-out reads get HTTP 403. |
| Auth | Anonymous and Email/Password enabled; the Clinician user exists. |
| Clinician allowlist | One email in `clinicians/{email}`. |
| Demo Patients | Seeded (401 documents). |
| Secrets | `GEMINI_API_KEY` (checked with a real call to `gemini-4-hydrogen`) and `MAPS_API_KEY`. |
| APIs enabled | Gemini (Generative Language), Places API (New), Weather API. **Not yet:** Maps Tools (`mapstools.googleapis.com`), Routes API. |
| Android apps registered | `app.depressify.patient` (in use; SHA-1 and SHA-256 of the main Mac's debug key) and `app.depressify` (unused). |
| Hosting | Not deployed. |

**Deployed endpoints:**

| Function | Type | URL |
|---|---|---|
| `extractIntake` | callable | `https://europe-north1-junction26hel-7400.cloudfunctions.net/extractIntake` |
| `saveIntake` | callable | `https://europe-north1-junction26hel-7400.cloudfunctions.net/saveIntake` |
| `generateDigest` | callable | `https://europe-north1-junction26hel-7400.cloudfunctions.net/generateDigest` |
| `health` | HTTP | `https://europe-north1-junction26hel-7400.cloudfunctions.net/health` |
| `weeklyDigest` | scheduled, Mondays 07:00 Helsinki, private | `europe-west1` |

The callables are public at the network level (`allUsers` → Cloud Run Invoker, added by hand) and refuse anyone not signed in. Apps call them through the Firebase SDK by name and region, not by URL.

## In progress at the time of writing

| Work | Branch (worktree under `.claude/worktrees/`) | Notes |
|---|---|---|
| Merge the UI from `main` and wire the backend into it | `integrate/ui-main` (`integrate-ui-main`) | The teammates' UI wins; our first-pass app screens are removed; the data layer (sign-in, Patient record, consent) is wired into their `PatientViewModel`; screens the backend doesn't serve yet stay on `DemoData`. |
| #6 backend spikes | `feat/6-spike-results` (`issue-6-spike-results`), harness on `spike/6-throwaway` | Live token and protocol capture from the Mac, structured output, Decisions API, Maps (direct Places and Weather if Maps Tools is off). Writes `docs/spike-results.md` and `fixtures/spike/`. |
| #22 red flag alert | `feat/22-red-flag-alert` (`issue-22-red-flag-alert`) | **Done, not pushed.** `redFlagAlert` trigger writes `mail/red-flag-<hash>` for red, shared, sharing, non-synthetic flags. The Trigger Email extension isn't installed yet (needs SMTP). |
| #28 silence check | `feat/28-silence-check` (`issue-28-silence-check`), on #22 | Hourly `silenceCheck` in `europe-west1` raises a red `silent` flag; the email follows through `redFlagAlert`. |

## Next

1. Merge the finished branches (#6, #22, #28) into `integrate/ui-main` once it's done. Run every suite, push, and open PRs.
2. Start from `integrate/ui-main` (#6 must be done first):
   - #14: Start Check-in (mints the Live token) and Finish Check-in (Summary, drops the transcript).
   - #18: the Map tool.
3. Then #20 (Decisions API into flags), then #21 (ratings, Outcome, `objectiveChange` / `outcomeScore`).
4. Deploy each finished function to `junction26hel-7400`, after the user agrees.

## Needs the user or a person

- Enable the **Maps Tools API** and the **Routes API**, and allow both on the Maps key if it has API restrictions.
- SMTP details for the **Trigger Email** extension (#22). The install steps are in the README.
- The device parts of #6: Health Connect and HRV on the S24+ with the Watch, usage stats, the phone microphone, the iPhone test.
- Require `email_verified` in the rules before real Patients use the app.
- Decide whether alert emails should skip Demo Patients. They do now, so reseeding never emails the Clinician.

## How to resume

- **Secrets:** `secrets.properties` at the repo root and in each worktree (gitignored) holds the real project config. The Gemini and Maps keys live only in Secret Manager. Never print or commit them.
- **CLI access:** the Firebase CLI is logged in as the project owner, and Application Default Credentials are set with quota project `junction26hel-7400`.
- **Toolchain:** JDK 21 at `/opt/homebrew/opt/openjdk@21`, Android SDK at `~/Library/Android/sdk`, firebase-tools, and gcloud.
- **Local tests** use the emulator project `demo-twoam`. Parallel agents shared one emulator through a lock script, because the ports are fixed.
- **Before a functions deploy:** Cloud Build uses npm 10, so regenerate `firebase/functions/package-lock.json` with `npx npm@10 install`. Cloud Scheduler has no `europe-north1`, so scheduled functions use `SCHEDULER_REGION`.
- **Full test sweep:**
  - `./gradlew :core:jvmTest :shared:jvmTest :androidApp:assembleDebug`
  - `npm test` in `firebase/functions` and in `firebase/seed`
  - `node --test` in `firebase/hosting`
  - `firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"` and the same for `seed`
