# Firestore schema

The data contract is defined once in Kotlin, in [`core/.../core/model/Models.kt`](../core/src/commonMain/kotlin/com/twoam/companion/core/model/Models.kt). It is mirrored by hand in TypeScript for the functions ([`firebase/functions/src/types.ts`](../firebase/functions/src/types.ts)) and in JavaScript for the dashboard ([`firebase/hosting/js/lib/contract.js`](../firebase/hosting/js/lib/contract.js)). This note lists every collection and field.

The mirrors are kept in step by tests. The `core` JVM tests export the Kotlin contract to `firebase/functions/test/fixtures/contract.json`, and `firebase/functions/test/contract.test.ts` checks both mirrors against that file. If you change a model, run `./gradlew :core:jvmTest`, update both mirrors and this note, then run `npm test` in `firebase/functions`.

## Rules for every document

- **Timestamps** are epoch milliseconds (integers) in fields ending `AtMillis`.
- **Dates** are `yyyy-MM-dd` strings in the device time zone (`Europe/Helsinki` in the demo). In Kotlin, use `DateKeys`.
- **Enumerations** are stored as lower-case words, for example `sleep_collapse`. A Signal is stored by its key, which is also a field name (`sleepMinutes`).
- **Missing is null, never zero.** Every field is written, and a missing value is written as an explicit `null`. A night without the watch is `null` sleep, not `0`. In Kotlin, `FirestoreJson` writes with `encodeDefaults` and `explicitNulls`; the app writes through GitLive with `encodeDefaults = true`, and a JVM test checks that the two agree.
- **Ratings** (mood, energy, sleep quality) are integers 1 to 5, or `null` when not given. Voice cue intensity is 1 to 5.

## Enumerations

| Name | Values |
|---|---|
| Signal key and direction | `sleepMinutes` (higher is better), `steps` (higher), `meanHeartRate` (none), `restingHeartRate` (lower), `hrv` (higher), `timeAtHomeMinutes` (lower), `movementRadiusKm` (higher), `calendarBusyMinutes` (none), `lateNightScreenMinutes` (lower) |
| `SignalDirection` | `higher_is_better`, `lower_is_better`, `none`. Signals with `none` are stored and charted but stay out of the composite. |
| `FlagLevel` | `green`, `amber`, `red` |
| `FlagKind` | `drift`, `low_mood`, `poor_sleep`, `decline`, `unassessed`, `sleep_collapse`, `inactive`, `silent`, `crisis` |
| `SuggestionKind` | `walk`, `nature`, `music`, `social_call`, `breathing`, `class_activity`, `daylight` |
| `SuggestionStatus` | `proposed`, `accepted`, `declined` |
| `HealthSource` | `device`, `synthetic` |
| `SharingConsent` | `undecided`, `granted`, `declined` |
| `ConsentPurpose` | `sharing`, `ratings`, `voice_cues` |
| `QuestionnaireKind` | `phq2`, `phq9` |

## Collections

```
patients/{patientId}                 PatientDoc      patientId = the Patient's anonymous auth uid
  daily/{date}                       DailyDoc        date = yyyy-MM-dd
  consents/{subject}                 Consent         subject = a Signal key or a ConsentPurpose
  checkIns/{checkInId}               CheckIn
  summaries/{checkInId}              Summary         keyed by the Check-in id: a retried finish overwrites
  suggestions/{suggestionId}         Suggestion
  flags/{flagId}                     Flag
  visits/{visitId}                   Visit           written by the Clinician
  digests/{isoWeek}                  Digest          isoWeek = e.g. 2026-W46
mail/{autoId}                        MailDoc         written by functions only; read by Trigger Email
```

### `patients/{patientId}`: PatientDoc

| Field | Type | Default on creation | Notes |
|---|---|---|---|
| `displayName` | string | `"Live patient"` (app) | The Clinician may rename. |
| `clinicianEmail` | string | the demo Clinician (`DemoConfig.CLINICIAN_EMAIL`) | Links the Patient to the Clinician; the dashboard queries on it. |
| `intakeHighlights` | string | `""` | Extracted from the Intake, at most 120 words, reviewed by the Clinician. Written only by the `saveIntake` function (Clinician only); no client writes it. The report itself is never stored. |
| `tmsEndDate` | date string or null | `null` | Set by the Clinician. Week 1 starts the day after. |
| `flagLevel` | FlagLevel | `green` | The highest uncleared flag. Never shown to the Patient. |
| `flagReasons` | string[] | `[]` | Plain sentences, never a number. |
| `quietHoursStart` | int 0..23 | `21` | No Nudges inside quiet hours; the window may cross midnight. |
| `quietHoursEnd` | int 0..23 | `9` | |
| `lastSeenAtMillis` | int or null | `null` | Last sign of life from the phone. The hourly silence check reads it. |
| `lastCheckInAtMillis` | int or null | `null` | |
| `healthSource` | HealthSource | `device` | Exactly one source per Patient. |
| `synthetic` | boolean | `false` | `true` for Demo Patients. |
| `sharingConsent` | SharingConsent | `undecided` | The Patient's Consent for the Clinician's view. Only `granted` lets the Clinician see anything; see [Sharing Consent](#sharing-consent). |
| `sharingChangedAtMillis` | int or null | `null` | When `sharingConsent` last changed. Written with every change. |

### `daily/{date}`: DailyDoc

| Field | Type | Notes |
|---|---|---|
| `date` | date string | Same as the document id. |
| `values` | map of Signal key to number or null | Holds every Signal key; `null` where there is no value. |
| `vsBaseline` | map of Signal key to number or null | Today's distance from the Patient's own Baseline, in units of their spread. `null` with fewer than 5 valid prior days or no value today. |
| `composite` | number or null | Mean of the oriented comparisons that exist; `null` if none. |
| `demoOverride` | boolean | `true` when a demo control wrote this record. Overrides only ever touch these. |

#### Baseline

A Signal's Baseline is the Patient's own median over the 14 calendar dates strictly before the record's date, counting only dates with a value (ADR 0003). With fewer than 5 such dates, or no value today, the comparison is `null`. Otherwise:

```
spread     = max(sample standard deviation (n - 1), 0.05 x |median|, 0.001)
vsBaseline = (today - median) / spread
```

The floor keeps a constant history from dividing by zero. `vsBaseline` keeps the sign as measured; the oriented comparison negates it for `lower_is_better` Signals, so negative always means worse, and is `null` for Signals with direction `none`. `composite` is the mean of the oriented comparisons that are not `null`.

The rule is pinned by a shared fixture, [`fixtures/baseline/baseline-cases.json`](../fixtures/baseline/baseline-cases.json): inputs and expected comparisons, oriented values and composites, including fewer than 5 valid days, null days, a constant series and both directions. The JavaScript rule lives once, in the dashboard's `firebase/hosting/js/lib/baseline.js`; the seed re-exports it (`firebase/seed/src/baseline.js`). The seed tests and the dashboard tests (`firebase/hosting/test/baseline.test.mjs`) run the fixture through it, and core's Kotlin Baseline tests read the same file. Change the rule only by changing the fixture, core and that file together.

### `consents/{subject}`: Consent

| Field | Type | Notes |
|---|---|---|
| `subject` | string | A Signal key, or `sharing`, `ratings`, `voice_cues`. Same as the document id. |
| `granted` | boolean | |
| `changedAtMillis` | int | |

- `consents/sharing` mirrors the record's `sharingConsent` (`granted` is `true` only for `granted`) and is written in the same transaction. The record's field is what the rules and functions read.
- `consents/ratings` and `consents/voice_cues`: with no document, ratings and Voice cues are included in Check-ins; `granted: false` leaves them out of future Check-ins (the Brief's instructions omit them). They are set in Settings → Sharing and privacy and are independent of sharing and of every Signal Consent.

### `checkIns/{checkInId}`: CheckIn

| Field | Type | Notes |
|---|---|---|
| `id` | string | Same as the document id. |
| `startedAtMillis` | int | |
| `endedAtMillis` | int or null | |
| `mood`, `energy`, `sleepQuality` | int 1..5 or null | Unanswered is `null`. |
| `voiceCues` | VoiceCue[] | `{label, intensity 1..5, heard}`. Observations, never a diagnosis. |
| `crisis` | boolean | `true` when the Check-in raised a crisis. |

### `summaries/{checkInId}`: Summary

The Patient reads exactly what the Clinician reads.

| Field | Type | Notes |
|---|---|---|
| `checkInId` | string | Same as the document id. |
| `createdAtMillis` | int | |
| `mood`, `energy`, `sleepQuality` | int 1..5 or null | |
| `sleepLine` | string | |
| `themes` | string[] | |
| `voiceCues` | VoiceCue[] | Taken from the Check-in draft, never from the model. |
| `suggestion` | string or null | The Suggestion made, or `null`. |
| `previousOutcome` | string or null | What the Patient said about the previous Suggestion. |
| `quotes` | string[] | At most three, each at most 200 characters. |

### `suggestions/{suggestionId}`: Suggestion

| Field | Type | Notes |
|---|---|---|
| `id` | string | Same as the document id. |
| `kind` | SuggestionKind | |
| `details` | string | |
| `suggestedAtMillis` | int | |
| `status` | SuggestionStatus | `proposed` until the Patient answers. |
| `booked` | boolean | Set only after the calendar write succeeds. |
| `tried` | boolean or null | `null` until answered; `false` is "not this time". |
| `felt` | int 1..5 or null | |
| `objectiveChange` | number or null | That day's oriented steps comparison with Baseline. |
| `outcomeScore` | number or null | `null` until the Patient answers. |

### `flags/{flagId}`: Flag

| Field | Type | Notes |
|---|---|---|
| `level` | FlagLevel | |
| `kind` | FlagKind | A kind with an uncleared flag is not raised again. |
| `reason` | string | A plain sentence, never a score. |
| `raisedAtMillis` | int | |
| `clearedAtMillis` | int or null | Set only by the Clinician. History is kept. |

### `visits/{visitId}`: Visit

| Field | Type | Notes |
|---|---|---|
| `date` | date string | Not in the future. |
| `questionnaire` | QuestionnaireKind or null | |
| `score` | int or null | PHQ-2: 0 to 6. PHQ-9: 0 to 27. Never feeds the Attention flag. |

### `digests/{isoWeek}`: Digest

A short weekly account of one Patient for the Clinician (issue #23), written by functions only (clients read it). One document per ISO week: weeks run Monday to Sunday in Europe/Helsinki, and a week belongs to the year that holds its Thursday (13 November 2026 is in `2026-W46`).

| Field | Type | Notes |
|---|---|---|
| `isoWeek` | string | Same as the document id, for example `2026-W46`. Zero-padded, so ids sort by week. |
| `weekStart` | date string | First date covered: the Monday. |
| `weekEnd` | date string | Last date covered: the Sunday, or the day "Generate now" ran for a week still in progress. |
| `summaryCount` | int | How many Summaries the text drew on. `0` means the week had no Check-ins. |
| `text` | string | At most 180 words. Written by the text model with storage off, from that week's Summaries and daily Signals only; or, for a week with no Check-ins, a fixed sentence saying so (the model is not called). |
| `generatedAtMillis` | int | |

Which week each writer covers:

- **`weeklyDigest`** runs on Mondays at 07:00 Europe/Helsinki and writes the **previous** ISO week, Monday 00:00 to the next Monday 00:00 in Helsinki: the last complete week. It writes one Digest for every Patient who is sharing.
- **`generateDigest`** ("Generate now" on the dashboard, the Patient's Clinician only) writes the **current** ISO week from Monday to today. It overwrites that week's document, so pressing it again regenerates, and the next Monday's job replaces it with the complete week.

A Summary belongs to the week of its `createdAtMillis` in Helsinki time; a daily record to the week of its `date`.

**Patients who are not sharing get no Digest.** The weekly job skips them (`isSharingActive`) and `generateDigest` refuses them (`assertClinicianOf`). A Digest is written for the Clinician, who cannot read it while sharing is off, so making one would send the Patient's week to the model with no reader. Digests written before sharing was withdrawn are kept: deleting derived records is an open decision (see [Sharing Consent](#sharing-consent)). Nothing logs a Summary, a quote, the prompt or the Digest text.

### `mail/{autoId}`: MailDoc

The shape the Trigger Email extension reads. Written by functions only.

| Field | Type | Notes |
|---|---|---|
| `to` | string | The Clinician's email. |
| `message.subject` | string | `[CRISIS]` or `[RED]` plus the display name. |
| `message.text` | string | The reason and a dashboard link. Never a transcript or a quote. |

## Queries

| Who | Query | Index |
|---|---|---|
| Dashboard Patient list | `patients` where `clinicianEmail == <signed-in email>` and `sharingConsent == "granted"` | none: two equality filters are served by merging the automatic single-field indexes. Adding an `orderBy` on another field needs a composite index in `firestore.indexes.json`. |
| Dashboard newest-flag order | `patients/{id}/flags` for each listed Patient | none |
| Seed reset | `patients` where `synthetic == true` (Admin SDK) | single field (automatic) |

The list query must carry the sharing filter (built by `clinicianListFilters` in `firebase/hosting/js/lib/sharing.js`); without it the rules reject the whole query.

## Demo Patients

`firebase/seed` writes three Demo Patients with the Admin SDK: `demo-steady` (green), `demo-declining` (amber flags, then red in the last two days) and `demo-sparse` (seven Check-ins at most, days of missing Signals, amber for low mood). Each has `synthetic: true`, `healthSource: "synthetic"`, `sharingConsent: "granted"`, the demo Clinician, an Intake that begins "Synthetic demo data", 42 daily records ending today, a TMS end date 42 days ago, one Visit 21 days ago with a PHQ-9 score, every Consent granted, and Check-ins with Summaries and Suggestions (most with an Outcome score). Every value is invented. Flags sit on the first morning the spec's starting thresholds hold. Document ids are stable: daily records by date, `checkin-<date>` (also the Summary id), `suggestion-<date>`, `<kind>-<date>` for flags and `visit-<date>`.


## Security rules

[`firebase/firestore.rules`](../firebase/firestore.rules) encodes who may see a Patient's progress: the Patient themselves, their Clinician, and, as a demo shortcut, any signed-in user for a Patient marked `synthetic`. The tests are in [`firebase/functions/test/rules/`](../firebase/functions/test/rules/firestore-rules.test.ts). Functions and the seed use the Admin SDK, which bypasses the rules.

- **Patient**: the anonymous auth uid equal to `patientId`.
- **Clinician**: a signed-in user whose token email equals the record's `clinicianEmail`, while the record's `sharingConsent` is `granted`. The demo does not require `email_verified` because emulator accounts are unverified; production must.
- **Demo shortcut**: on a record with `synthetic == true`, any signed-in user has the Patient's access, with the Patient's limits.

| | Patient (or anyone on a Demo Patient) | Clinician of the Patient, while sharing is granted | Anyone else signed in | Signed out |
|---|---|---|---|---|
| Patient record: read | yes | yes | no | no |
| Patient record: create | own id only, `clinicianEmail` the demo Clinician, `synthetic` false, `tmsEndDate` null, `intakeHighlights` empty | no | no | no |
| Patient record: update | `quietHoursStart`, `quietHoursEnd`, `lastSeenAtMillis`, `lastCheckInAtMillis`, `healthSource`, `sharingConsent` (to `granted` or `declined`, always with a new `sharingChangedAtMillis`), `sharingChangedAtMillis`; `flagLevel` and `flagReasons` only to raise (level never lower, reasons kept) | `displayName`, `tmsEndDate`, and a reset of `flagLevel` and `flagReasons` | no | no |
| Patient record: delete | no | no | no | no |
| `daily`, `consents`, `checkIns`, `summaries`, `suggestions` | read, write | read | no | no |
| `flags` | read; create uncleared flags; no change or delete | read; set `clearedAtMillis` only | no | no |
| `visits` | read | read, create, update, delete | no | no |
| `digests` | read | read | no | no |
| `mail` | no | no | no | no |

Anything not listed, including a collection outside this schema, is denied. Field owners: `displayName`, `tmsEndDate` and clearing flags belong to the Clinician; `intakeHighlights` and Summaries are written by functions; `synthetic` and `clinicianEmail` never change after creation from a client.

`flagLevel`, `flagReasons` and `flags` are readable by the Patient's own app, because the phone raises flags and needs the open ones to avoid duplicates. The app never shows them (ADR 0005, ADR 0009).

## Sharing Consent

The Patient decides whether their Clinician sees their progress (issue #29, ADR 0005). `undecided` (a new record) and `declined` both mean the Clinician sees nothing.

- **Rules.** `clinicianCanRead` in `firestore.rules` requires `sharingConsent == 'granted'`, and every Clinician read and write of the record and its collections goes through it. Withdrawing takes effect at once: the dashboard's list query (which filters on `granted`) drops the Patient, and a listener already open on the Patient's record or collections gets `permission-denied`. The dashboard maps that error to a "sharing withdrawn" state with `sharingStateFromError` in `firebase/hosting/js/lib/sharing.js`; every Patient view should use it rather than show an error. A Demo Patient stays readable through the demo shortcut, so views also check the field with `sharingStateFromSnapshot`.
- **Functions.** Functions use the Admin SDK and bypass the rules, so they check `isSharingActive(patient)` from `firebase/functions/src/sharing.ts` themselves. **The flag email (#22) and the silence check (#28) must use it**: while it is false no flag email is sent for the Patient and the silence check skips them. The weekly Digest (#23) skips them too, and `generateDigest` refuses them. Check-ins, Summaries and the Patient's own records continue.
- **Granting again** gives access from then on. The rules do not filter by time, so the Clinician can then also read what was saved while the Patient was not sharing; the app says so before the Patient shares again. Whether records are deleted on withdrawal is an open decision.
- **The app** shows the welcome and the sharing choice while `sharingConsent` is `undecided`, and saves a decision with `sharingChangedAtMillis` and `consents/sharing` in one transaction. Nothing moves a record back to `undecided`.
