# Dashboard design ↔ backend sync

This note maps everything the Clinician dashboard design shows to the backend that provides it.

**The design:**
- the prototype in [`design/clinician/`](../../design/clinician/): `src/App.jsx`, `src/Charts.jsx` and its in-memory data model `src/data.mjs`;
- the spec in [interface-design.md](interface-design.md), "Clinician screens and states".

**The backend:**
- the rules in [`firebase/firestore.rules`](../../firebase/firestore.rules);
- the functions in `firebase/functions/src`;
- the data contract in [firestore-schema.md](../firestore-schema.md);
- the dashboard's pure helpers in `firebase/hosting/js/lib`.

Written 14 November 2026, on branch `feat/dashboard-backend-sync` from `main` at `b41f9b7`.

**Status words:**
- **available**: the backend stores it, and an existing helper already gives the design's shape.
- **available-with-adapter**: the data is stored. `js/lib/design-model.js` (added here) maps it to the shape `data.mjs` uses.
- **missing-backend**: not stored or not provided. **Added here** means this branch adds it; otherwise it is proposed.
- **conflicts-with-a-decision**: the design asks for something an ADR or a user decision rules out. Left for the user; see [Conflicts](#conflicts-for-the-user-to-decide).

**How the UI consumes it:**
- `js/lib/design-model.js` turns Firestore documents into the design's objects. It is pure.
- `js/lib/design-live.js` holds the subscriptions and actions. The Firestore functions are passed in.
- `js/data/design-data.js` binds those to the browser SDK.

See the [README](../../README.md#dashboard-data-layer) and [Using it from the UI](#using-it-from-the-ui).

## The design's data model and the backend's

The design's `createPatients()` builds one object per Patient. Each design field below maps to backend documents.

| Design field (`data.mjs`) | Backend source | Status |
|---|---|---|
| `id` | `patients/{id}` document id | available |
| `name`, `initials` | `displayName`; initials computed | available-with-adapter |
| `level` | The open flags the Clinician can see (`shownAttention`, `js/lib/clear.js`), else the record's `flagLevel`. `unknown` and `hidden` are display states only, see below. | available-with-adapter |
| `reason`, `source`, `observed` | Top open flag: `reason`, `flagSource(kind)` (`js/lib/flag-detail.js`), `raisedAtMillis` | available-with-adapter |
| `activeFlags[]` | `flags` where `sharedWithClinician == true` and `clearedAtMillis == null`, highest level first, then newest | available-with-adapter |
| `history[]` (Raised / Cleared) | Every visible flag: one *Raised* entry, plus a *Cleared* entry when `clearedAtMillis` is set | available-with-adapter |
| `history[].email` | Derived from the alert policy (`alertDecision` in `functions/src/alerts.ts`): amber/green "Not applicable", Demo Patient "No email (Demo Patient)", red "Email requested". Delivery (`mail/{id}.delivery`) is not readable by any client. | available-with-adapter (policy); delivery state **missing-backend**, proposed |
| `lastPhone` | `lastSeenAtMillis` (`latestCheckInText`, `freshness` in `js/lib/list-row.js`) | available-with-adapter |
| `checkIn` | `lastCheckInAtMillis` | available-with-adapter |
| `note` (roster subtitle, e.g. "Recent sleep collapse") | Nothing. The design's note is invented free text. The adapter gives the first open reason, or `null`. | missing-backend: not needed (the reason already says it) |
| `quote` (flag-supporting quote) | Nothing links a flag to a Summary on `main`. #62 names Check-in flags `<kind>-<checkInId>`, so the Summary's `quotes` could be joined then. | missing-backend, unblocked by #62; not done here |
| `sharing` | `sharingConsent` (`sharingStateFromSnapshot` / `sharingStateFromError`, `js/lib/sharing.js`) | available-with-adapter |
| `alertsEnabled` | `sharingConsent == "granted"` and not `synthetic` (the email policy) | available-with-adapter |
| `assessmentStatus` | `CheckIn.assessment` from #62 (`unavailable` on a timeout). On `main` the field does not exist yet, so the adapter reads it if present and otherwise reports `complete`. | missing-backend on `main`, **#62 adds it**; adapter ready |
| `tms` | `tmsEndDate` | available |
| `visits[]` `{id, date, type, score}` | `visits` `{date, questionnaire: phq2/phq9/null, score}`; `type` mapped to `PHQ-2`, `PHQ-9`, `none` | available-with-adapter |
| `intake.highlights[]` | `intakeHighlights` (one string, ≤120 words); split into lines | available-with-adapter |
| `intake.date` ("saved 2 Oct") | Not stored: `saveIntake` writes only the text | missing-backend, proposed (`intakeSavedAtMillis`, written by `saveIntake`) |
| `daily[]` `{date, mood, sleep, steps, heart, rhr, hrv, home, radius, calendar}` | `daily/{date}.values` (stamped), converted to the design's units (minutes → hours); `mood` from that day's Summary. Missing dates are filled with `null`. | available-with-adapter |
| `summaries[]` `{id, date, time, generated, text, mood, energy, sleep, themes, voice, suggestion, previousKind, tried, feeling}` | `summaries` + `checkIns` (start time) + `suggestions` (previous Outcome) | available-with-adapter; see [Summaries](#summaries) |
| `digest` `{time, ids, text}` | `digests` (latest, stamped) | `ids`: **missing-backend, added here** (`Digest.sourceCheckInIds`) |

## Roster (Patients)

| Item | Backend | Status |
|---|---|---|
| Patient list | `patients` where `clinicianEmail == <email>` and `sharingConsent == "granted"` (`clinicianListFilters`) | available |
| Counts per level ("All 4, Red 1…") | Computed from the list + each Patient's visible flags | available-with-adapter (`rosterView`) |
| Ordering: red, amber, unassessed, green, then name | `sortPatients` (`js/lib/sort.js`) orders red, amber, green, then newest open flag, then name. The adapter puts `unknown` between amber and green, and `hidden` last. | available-with-adapter |
| Search by name | `nameMatches` (`js/lib/list-filter.js`; ignores case and accents) | available |
| Filter by level, incl. "Unassessed" | `filterRows` handles red/amber/green; the adapter adds `unknown` and `hidden` | available-with-adapter |
| Connection freshness ("Phone last seen") | `lastSeenAtMillis`. `null` means the phone was never seen. | available |
| "Updated 14:19" (dashboard data freshness) | Firestore snapshot metadata (`fromCache`); the subscription reports it | available-with-adapter |
| Red banner, count, "stays until cleared", not hidden by filters | `bannerModel` (`js/lib/banner.js`), built before any filter | available |
| Sound for red flags (explicit opt-in, test chime, blocked playback) | `js/alerts.js`, `newRedFlags` (`js/lib/banner.js`), `sound-pref.js`. The subscription reports `newRed` per snapshot. | available |
| 14-day sleep sparkline + Baseline per row | Each listed Patient's last 28 daily records. The query needs the composite index `daily (sharedWithClinician, date DESC)`. | **missing-backend (index), added here** |
| "Unassessed" level in the roster | The latest Check-in's `assessment` (#62). The query needs the composite index `checkIns (sharedWithClinician, startedAtMillis DESC)`. | index **added here**; field from #62 |
| Withdrawn Patient row ("Patient sharing withdrawn", level `hidden`) | The rules drop a withdrawn Patient from the list query at once; the backend cannot list them. The roster subscription can remember, for this session only, ids that left the list, and show a placeholder with no name or data (`keepWithdrawn`). | available-with-adapter (session-only); see [Conflicts](#conflicts-for-the-user-to-decide) for deletion |

## Overview

| Item | Backend | Status |
|---|---|---|
| Attention block: level word, reason, source, observed time | Open flags (see above) | available-with-adapter |
| Several reasons; a new amber while red stays red | Flags are separate documents, and the level is the highest open one (`levelAfterClearing`). The phone and functions never lower the level (rules `flagRaisedOnly`). | available |
| Level words (`levels` in `data.mjs`) | Checked against ADR 0001 and 0009: "Red · Needs attention", "Amber · Worth a look", "Green · No current flag". There is no number, and green is not "safe". The existing dashboard says "Red / Amber / Green"; both are allowed. | available-with-adapter (`DESIGN_LEVELS`) |
| `unknown` ("Assessment unavailable") as a level | ADR 0009 has three levels only, and the spec says "beside the last known flag". The adapter keeps the stored level and adds `assessment: "unavailable"`. `designLevel` is `unknown` only when nothing is open, so a timeout is never shown as green. It is a display state; nothing is written. | available-with-adapter (display only), field from #62 |
| Week since TMS ("Week 6 since TMS") | `weekOf(today, tmsEndDate)` (`js/lib/timeline.js`) | available-with-adapter |
| "TMS end date not recorded" + Add TMS end date | `tmsEndDate == null`; Clinician `updateDoc` (rules `clinicianUpdate`) | available |
| Timeline Phases (TMS end → Visits → today, backdated Visits) | `phases()` (`js/lib/timeline.js`). A Visit day closes its Phase, and the next Phase starts the day after. The design reuses the Visit day as the next start. Mapped to `{start, end, label}`. | available-with-adapter |
| Mood lane (1–5, gaps) | Summary `mood` per day; weekly means `moodByWeek` | available-with-adapter |
| PHQ-2 / PHQ-9 lanes, separate scales | `questionnairePoints` / `pointsByKind` | available-with-adapter |
| Latest Summary card | Newest Summary (`sortSummaries`) | available-with-adapter |
| "What seems to help" (compact) | See below | available-with-adapter |
| Weekly Digest (compact) | See below | available-with-adapter |

## Summaries

| Item | Backend | Status |
|---|---|---|
| List, newest first; one in full | `summaries` (stamped), `sortSummaries` / `selectSummary` | available |
| Check-in time and "Generated" time | Check-in `startedAtMillis`; Summary `createdAtMillis` | available-with-adapter |
| `text` (one prose paragraph) | The Summary is structured; there is no prose field. The adapter joins the stored sentences (`sleepLine`, `previousOutcome`, the Suggestion) into `text`, without inventing words, and also gives `sleepLine`, `quotes`, `voiceCues` and `suggestion` separately. | available-with-adapter. Proposal: the UI shows the structured fields, as the Patient app does (ADR 0005, same content) |
| Ratings mood / energy / sleep quality | `mood`, `energy`, `sleepQuality` (null = not given) | available |
| Themes | `themes` | available |
| Voice cue as an observation | `voiceCues[]` → `voiceCueText` | available-with-adapter |
| Suggestion | `suggestion` | available |
| Previous Outcome: kind, tried, feeling | Matched by the Suggestion's `outcomeCheckInId == summary id` (#65); on `main`, the newest Suggestion made before the Check-in started. Then `kind`, `tried`, `felt`. Also the Summary's own `previousOutcome` sentence. | available-with-adapter (exact once #65 lands) |
| No transcript archive | Never stored (ADR 0006) | available |

## Signals

| Item | Backend | Status |
|---|---|---|
| The 8 design trends: sleep, steps, heart, rhr, hrv, home, radius, calendar | `daily.values`: `sleepMinutes`, `steps`, `meanHeartRate`, `restingHeartRate`, `hrv`, `timeAtHomeMinutes`, `movementRadiusKm`, `calendarBusyMinutes`. The backend also has a ninth, `lateNightScreenMinutes`; the adapter returns it as `screen` and the UI may leave it out. | available-with-adapter |
| Baseline: median of the previous 14 days, ≥5 valid days | `baselineFor` / `baselineValues` (`js/lib/baseline.js`, pinned by the shared fixture). It is the same rule as the design's `baseline()`. | available |
| Insufficient Baseline ("Building Baseline · n/5") | `validDays < 5` | available-with-adapter |
| Unavailable / no data | `signalState`: `no_consent`, `no_data`, `stale`, `ok` (`js/lib/signals.js`). Values without Consent are hidden (null). | available-with-adapter |
| Missing day is a gap, never zero | Missing record or `null` value → `null` | available |
| Device / synthetic label | `healthSource` (`sourceLabel`) | available |
| Per-signal origin ("Watch daily aggregate") | Fixed text per Signal; not data | available-with-adapter (static) |
| HRV statistic (RMSSD on Android, SDNN on iOS) | Not stored | missing-backend, proposed (`hrvStatistic` on the record, or per daily record); not needed for the demo |
| Phase selection of a window | `signalWindow` / `signalSeries` | available |

## Intake & Visits

| Item | Backend | Status |
|---|---|---|
| Paste a report; extract; preview; edit; save highlights | `extractIntake`, `saveIntake` callables (`js/functions.js`), `intakeReducer` (`js/lib/intake.js`). The report is never stored. | available |
| File up to 100 KB, `.txt` / `.md` | The functions take text ≤ 100,000 characters (`REPORT_MAX_CHARS`). A file ≤ 100 KB always fits, since it has at most as many characters as bytes. The browser reads the file; the adapter checks it with `intakeFileProblem`. | available-with-adapter |
| Errors and retry without losing the text | `intakeErrorMessage`, reducer keeps text | available |
| Intake saved date | Not stored | missing-backend, proposed (see above) |
| Record a Visit: date ≤ today, PHQ-2 0–6 / PHQ-9 0–27 integers, or no score | `validateVisit` (`js/lib/visit.js`); rules check shape | available |
| Design-only Visit checks: not before the TMS end date; one Visit per date | Not enforced by rules; `validateDesignVisit` in the adapter | available-with-adapter (UI rule) |
| Saving a Visit leaves flags unchanged | Visits never feed the flag | available |
| TMS end date: add/edit, not after the first Visit | `validateTmsEndDate`; "not after the first Visit" is design-only, in `validateDesignTms` | available-with-adapter |

## Weekly Digest

| Item | Backend | Status |
|---|---|---|
| Read the latest | `digests` where stamped, `orderBy isoWeek desc limit 1` (index exists) | available |
| Generate now | `generateDigest` callable (`digestCalls`) | available |
| Pending / error / retry / regenerated | `digestReducer`, `digestErrorMessage` (`js/lib/digest.js`) | available |
| Covered dates, generated time | `weekStart`, `weekEnd`, `generatedAtMillis` (`digestCoverage`, `digestGenerated`) | available |
| Stale (an earlier week's Digest) | `weekEnd` before this week's Monday | available-with-adapter |
| Source count | `summaryCount` | available |
| **Source list** ("View source Summaries") | The Digest stored only a count. This branch adds `sourceCheckInIds`: the ids of the Summaries the text drew on (a Summary's id is its Check-in id), oldest first. It is written by `writeDigestFor` and is in every copy of the contract. The adapter resolves them against the loaded Summaries. Older Digests without the field show the count only. | **missing-backend, added here** |

## What seems to help

| Item | Backend | Status |
|---|---|---|
| Per kind: Outcomes counted, reported feeling, stated window | `whatHelps` (`js/lib/what-helps.js`): scored Suggestions in the last 28 days, feeling groups | available |
| "Felt x/5 on average" (design) | The adapter computes the mean of the Patient's own `felt` answers per kind. The existing dashboard shows grouped counts instead ("3 felt better"), and never the mean Outcome score. The adapter gives both; the UI chooses. | available-with-adapter; wording choice noted in [Conflicts](#conflicts-for-the-user-to-decide) |
| "Association, not an effect" | Copy only | available |

## Flags

| Item | Backend | Status |
|---|---|---|
| Multiple reasons, highest level retained | Flags collection, `levelAfterClearing` | available |
| New amber while red stays red | Level only rises (rules + writers) | available |
| History of raised and cleared reasons | Flags are never deleted; `clearedAtMillis` | available |
| Clear with confirmation, all reasons at once | `clearFlags(fs, db, {flagIds, reviewed})` clears several flags in one transaction. If a new reason arrives during review, it refuses with `flag/changed` (`js/lib/clear.js`). | available (`clearAttention` in `design-live.js`) |
| Cleared by whom | Only the Patient's one Clinician can clear (rules); no actor field | available (implicit) |
| Optional action note when clearing | No field; the rules allow only `clearedAtMillis` on a flag | **conflicts-with-a-decision**, proposed only (see below) |
| Quiet phone (red, "Phone quiet for 26 hours") | `silenceCheck`: red `silent` flag, fixed reason, no self-harm inference. Not raised for Demo Patients. | available |
| Quiet phone → no new Signals that day | No daily record is written; the adapter shows `null` | available |
| Email status per flag | See `history[].email` above | available-with-adapter / delivery missing |

## Assessment unavailable

| Item | Backend | Status |
|---|---|---|
| "Assessment unavailable" beside the last known flag; never a fabricated green | `CheckIn.assessment == "unavailable"` (#62). The adapter: `assessment`, plus `designLevel: "unknown"` only when no flag is open. | field from #62; adapter ready |
| **Explicit "Retry automatic assessment"** | The transcript is dropped after the Summary (ADR 0006), so no later request can re-assess. | **conflicts-with-a-decision**, see below |

## Sharing withdrawal

| Item | Backend | Status |
|---|---|---|
| Hide everything at once, even in an open tab | Rules (`clinicianCanRead` needs `granted`). Listeners get `permission-denied`, which maps to `sharingStateFromError`. On a Demo Patient, `sharingStateFromSnapshot` gives the same result. | available |
| No new flags or alerts while withdrawn | `isSharingActive` in `redFlagAlert`, `silenceCheck`, the Digest | available |
| Re-consent shares future records only | The sharing stamp | available |
| **Delete the associated data** (the design's `withdrawSharing`) | The user's decision: future-only sharing; the off period is hidden, not deleted. Deleting derived records is an open decision. | **conflicts-with-a-decision**, see below |

## Sign-in and session

| Item | Backend | Status |
|---|---|---|
| Email + password sign-in, wrong-credentials message without account enumeration | Firebase Auth, `signInErrorMessage` (`js/lib/auth.js`) | available |
| Retry after a network failure | `auth/network-request-failed` message | available |
| Session expired | `onAuthStateChanged(null)` → sign-in page. The subscriptions report `error.code`, and `unauthenticated` maps to the expired state. | available-with-adapter (`statusFromError`) |
| Permission denied | List query `permission-denied` → `status: "denied"` | available-with-adapter |
| Clinician claim (`role == "clinician"` and a verified email) | #67: rules, `assertClinicianOf`, and `clinicianAccessMessage(claims)` in `js/lib/auth.js` | missing-backend on `main`, **#67 adds it**; nothing to do here |

## Prototype states

| State | Backend | Status |
|---|---|---|
| Loading | Before the first snapshot → `status: "loading"` | available-with-adapter |
| Empty caseload / no matches | `listMessage` (`js/lib/list-filter.js`); `rosterView` | available |
| Offline / stale ("Offline · showing saved data") | Snapshot `metadata.fromCache` (`includeMetadataChanges`). The subscription reports `fromCache`. Writes made offline are queued by the SDK; the design asks to refuse them, so the UI should check `fromCache`. | available-with-adapter |
| Signals unavailable / new Baseline | `signalState`, `validDays` | available-with-adapter |
| Generation / extraction / save failure + retry | Reducers in `js/lib/digest.js`, `intake.js`, `clear.js` | available |
| Frozen clock (13 Nov 2026) | The adapter takes `{ nowMillis, timeZone }` | available-with-adapter |

## Conflicts for the user to decide

None of these is implemented. Each needs a decision first.

1. **Retrying an assessment later** (`Retry automatic assessment` in `Attention`).
   - **The conflict:** ADR 0006 drops the transcript once the Summary is written, so nothing is left to re-assess. A retry on the stored Summary would judge the model's summary, not the Patient's words. It would also change what the Decisions API is asked.
   - **Options:**
     - (a) **Retry within the finish window only.** #60 already answers `unavailable` on a retryable model failure while the phone still holds the transcript. The same retry could re-run the Decisions call, with no dashboard button.
     - (b) **A Clinician "Mark reviewed"** that records the Clinician looked at the Summary. This needs a function-written field, e.g. `checkIns/{id}.assessmentReviewedAtMillis`, and a rules change.
     - (c) **Drop the button.** Show "Assessment unavailable" with the Summary link, and let the Clinician clear or keep flags as today.
   - **Recommendation:** (a) plus (c), and (b) only if the user wants an audit trail.
2. **Withdrawing sharing deletes data** (`withdrawSharing`, "Associated data removed").
   - **The conflict:** the user decided on future-only sharing, where the off period is hidden. Deleting derived records (Summaries, Digests, flags) is an open decision (firestore-schema.md, "Sharing Consent").
   - **The adapter's choice:** it follows the current decision. A withdrawn Patient is hidden, with "not sharing right now" wording, and nothing is said to be deleted.
   - **Before the UI copies the design's "Associated data removed" line:**
     - decide the deletion policy;
     - add a function that deletes or tombstones on withdrawal;
     - update the Patient's withdrawal copy (`SharingCopy` in `shared`).
3. **The Clinician's action note when clearing.**
   - **Why not done:** the design labels it "Prototype proposal".
   - **What it would need:**
     - a new field on `flags` (e.g. `clearNote`, ≤ 300 characters, Clinician-written);
     - a rules change, since today the Clinician may set only `clearedAtMillis`;
     - a contract change in all copies.
   - **The problem:** it is free text, so it can hold anything identifying. The Patient's own app can read `flags` today (rules: the Patient reads their flags), so the note would be readable by the Patient too, unless it lives in a Clinician-only collection.
   - **Proposal:** a Clinician-only subcollection `patients/{id}/clinicianNotes/{flagId}` `{note, writtenAtMillis}`. The Clinician reads and writes it; the Patient has no access. It is not stamped and is deleted with the record. Decide that first, then it is about 30 lines plus rules tests.
4. **Average feeling in "What seems to help".**
   - The design shows "Felt 3.7/5 on average".
   - The existing dashboard deliberately shows grouped counts and never a mean, to avoid a number that reads as a grade (ADR 0009, spec "No effectiveness percentage").
   - A mean of the Patient's own 1–5 answers is not an effectiveness percentage, so this is a wording choice, not a hard conflict. The adapter gives both `feltMean` and the counts.
5. **A withdrawn Patient's row in the roster.** The rules remove the Patient from the list query, so the backend cannot list them. The adapter's session-only placeholder (`keepWithdrawn`) carries no name. Whether even an anonymous "someone withdrew" row is wanted is a product choice.

## Added in this branch

| Change | Where |
|---|---|
| `Digest.sourceCheckInIds: string[]`: the Summaries the Digest drew on, oldest first; `[]` for a week with no Check-ins | Kotlin `core.model.Digest` (+ serialization test), `functions/src/types.ts`, `hosting/js/lib/contract.js` (`DIGEST_FIELDS`), `contract.json` (regenerated), `writeDigestFor`, firestore-schema.md, rules fixture |
| Composite indexes `daily (sharedWithClinician ASC, date DESC)` and `checkIns (sharedWithClinician ASC, startedAtMillis DESC)` for the roster's sparkline and latest Check-in | `firebase/firestore.indexes.json` |
| The adapter `js/lib/design-model.js` (pure) | `firebase/hosting/js/lib/design-model.js`, `test/design-model.test.mjs` |
| The live helpers `js/lib/design-live.js` (Firestore functions injected) and the browser binding `js/data/design-data.js` | `firebase/hosting/js/lib/design-live.js`, `firebase/hosting/js/data/design-data.js`, `test/design-live.test.mjs`, `seed/test/emulator/design-live.test.js` |

No rules change: Digests stay function-written, and the indexes do not change access.

## Interactions with open PRs

- **#60 (caps):** no overlap. A red flag past the email cap still shows on the dashboard; `history[].email` says "Email requested" from policy and cannot see the cap. A delivery/cap status would need the proposal above.
- **#62 (Decisions → flags, `CheckIn.assessment`, `previousTried`):**
  - The adapter already reads `assessment` and maps `unavailable`.
  - Text conflicts are expected in `Models.kt`, `types.ts`, `contract.js`, `contract.json`, the contract test and firestore-schema.md, since both add fields. Resolve by keeping both, then regenerate `contract.json` with `./gradlew :core:jvmTest`.
  - Flag ids `<kind>-<checkInId>` would let the adapter attach the Summary's quote to the flag (`quote`).
- **#65 (Outcomes):** the adapter prefers `Suggestion.outcomeCheckInId` to find a Summary's previous Outcome. Same contract-file conflicts as #62.
- **#67 (accounts, Clinician claim):**
  - It changes the rules for who is a Clinician. The adapter does not check claims; the app's sign-in does (`clinicianAccessMessage`).
  - Emulator tests here sign in with an email token. After #67 they need the `role: "clinician"` claim and `email_verified: true` (same change #67 makes to the existing seed attention test).
- **#68, #69 (core rules):** no overlap.
- **#70 (live Patient seed):** not on `main`, so the fixtures use the three Demo Patients. The live profile (`synthetic: false`, `healthSource: "synthetic"`, cleared amber history) would exercise `alertsEnabled` and the Cleared history entries. Add it as a fixture when #70 lands.

## Using it from the UI

The React prototype can swap `createPatients()` for the live data with no other change in shape:

```js
import * as fs from "firebase/firestore";                       // or the gstatic URLs, see js/data/design-data.js
import { subscribeRoster, subscribePatient, clearAttention, recordVisit } from "../../firebase/hosting/js/lib/design-live.js";
import { rosterView, DESIGN_LEVELS } from "../../firebase/hosting/js/lib/design-model.js";

const stop = subscribeRoster(fs, db, { clinicianEmail: user.email, keepWithdrawn: true }, (roster) => {
  // roster.status: "loading" | "ok" | "denied" | "expired" | "error"; roster.fromCache: offline/stale
  const view = rosterView(roster, { search, filter });            // view.patients, view.counts, view.banner, view.message
});
const stopOne = subscribePatient(fs, db, patientId, {}, (state) => {
  // state.status: "loading" | "ok" | "withdrawn" | "error"; state.patient has the design's shape
});
```
