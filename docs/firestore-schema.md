# Firestore schema

The data contract is defined once in Kotlin, in [`core/.../core/model/Models.kt`](../core/src/commonMain/kotlin/app/depressify/core/model/Models.kt). It is mirrored by hand in TypeScript for the functions ([`firebase/functions/src/types.ts`](../firebase/functions/src/types.ts)) and in JavaScript for the dashboard ([`firebase/hosting/js/lib/contract.js`](../firebase/hosting/js/lib/contract.js)). This note lists every collection and field.

The mirrors are kept in step by tests. The `core` JVM tests export the Kotlin contract to `firebase/functions/test/fixtures/contract.json`, and `firebase/functions/test/contract.test.ts` checks both mirrors against that file. If you change a model, run `./gradlew :core:jvmTest`, update both mirrors and this note, then run `npm test` in `firebase/functions`.

## Rules for every document

- **Timestamps** are epoch milliseconds (integers) in fields ending `AtMillis`.
- **Dates** are `yyyy-MM-dd` strings in the device time zone (`Europe/Helsinki` in the demo). In Kotlin, use `DateKeys`.
- **Enumerations** are stored as lower-case words, for example `sleep_collapse`. A Signal is stored by its key, which is also a field name (`sleepMinutes`).
- **Missing is null, never zero.** Every field is written, and a missing value is written as an explicit `null`. A night without the watch is `null` sleep, not `0`. In Kotlin, `FirestoreJson` writes with `encodeDefaults` and `explicitNulls`; the app writes through GitLive with `encodeDefaults = true`, and a JVM test checks that the two agree.
- **Ratings** (mood, energy, sleep quality) are integers 1 to 5, or `null` when not given. Voice cue intensity is 1 to 5.
- **The sharing stamp.** Every document in `daily`, `checkIns`, `summaries`, `suggestions`, `flags` and `digests` has `sharedWithClinician` (boolean): whether the Patient's `sharingConsent` was `granted` when the document was created. It is set once and never changes. The Clinician reads only documents stamped `true`. `consents`, `visits` and the Patient record are not stamped. See [The sharing stamp](#the-sharing-stamp).

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
mail/{mailId}                        MailDoc         written by functions only; read by Trigger Email
clinicians/{email}                   (allowlist)     the Clinicians a new Patient may link to; Admin SDK only
```

### `patients/{patientId}`: PatientDoc

| Field | Type | Default on creation | Notes |
|---|---|---|---|
| `displayName` | string | `"Live patient"` (app) | The Clinician may rename. |
| `clinicianEmail` | string | the configured Clinician (`DemoConfig.clinicianEmail`, from `secrets.properties` or the iOS plist) | Links the Patient to the Clinician; the dashboard queries on it. Lower case. On creation it must have a document in [`clinicians`](#cliniciansemail-allowlist). |
| `intakeHighlights` | string | `""` | Extracted from the Intake, at most 120 words, reviewed by the Clinician. Written only by the `saveIntake` function (Clinician only); no client writes it. The report itself is never stored. |
| `tmsEndDate` | date string or null | `null` | Set by the Clinician. Week 1 starts the day after. |
| `flagLevel` | FlagLevel | `green` | The highest uncleared flag stamped `sharedWithClinician: true`. A flag raised while the Patient was not sharing never counts. Never shown to the Patient. |
| `flagReasons` | string[] | `[]` | The reasons of those flags, highest level first, then newest. Plain sentences, never a number. |
| `quietHoursStart` | int 0..23 | `21` | No Nudges inside quiet hours; the window may cross midnight. |
| `quietHoursEnd` | int 0..23 | `9` | |
| `lastSeenAtMillis` | int or null | `null` | Last sign of life from the phone. The hourly silence check (`silenceCheck`, #28) reads it: older than 24 hours on a sharing, non-synthetic Patient raises red `silent`. `null` (never seen) is not silent. Finish Check-in moves it to the time of the finish (never back). |
| `lastCheckInAtMillis` | int or null | `null` | The end of the latest finished Check-in. Finish Check-in moves it forward (never back). `null` means no Check-in has finished yet: Start Check-in then adds the first-Check-in AI disclosure to the token's instruction. |
| `healthSource` | HealthSource | `device` | Exactly one source per Patient. |
| `synthetic` | boolean | `false` | `true` for Demo Patients. |
| `sharingConsent` | SharingConsent | `undecided` | The Patient's Consent for the Clinician's view. Only `granted` lets the Clinician see anything; see [Sharing Consent](#sharing-consent). |
| `sharingChangedAtMillis` | int or null | `null` | When `sharingConsent` last changed. Written with every change. |

### `daily/{date}`: DailyDoc

Written by the phone's daily job (#26): the decision is `DailyJob.run` in `core` (`app.depressify.core.daily`), and the app writes its result. Every run rewrites today's record whole, keeping the stamp it was created with. A record a demo control wrote (`demoOverride: true`) keeps its values on later device runs.

| Field | Type | Notes |
|---|---|---|
| `date` | date string | Same as the document id. |
| `values` | map of Signal key to number or null | Holds every Signal key; `null` where there is no value. |
| `vsBaseline` | map of Signal key to number or null | Today's distance from the Patient's own Baseline, in units of their spread. `null` with fewer than 5 valid prior days or no value today. |
| `composite` | number or null | Mean of the oriented comparisons that exist; `null` if none. |
| `demoOverride` | boolean | `true` when a demo control wrote this record. Overrides only ever touch these. |
| `sharedWithClinician` | boolean | The sharing stamp. A record rewritten later in the day keeps the stamp it was created with. |

#### Baseline

A Signal's Baseline is the Patient's own median over the 14 calendar dates strictly before the record's date, counting only dates with a value (ADR 0003). With fewer than 5 such dates, or no value today, the comparison is `null`. Otherwise:

```
spread     = max(sample standard deviation (n - 1), 0.05 x |median|, 0.001)
vsBaseline = (today - median) / spread
```

The floor keeps a constant history from dividing by zero. `vsBaseline` keeps the sign as measured; the oriented comparison negates it for `lower_is_better` Signals, so negative always means worse, and is `null` for Signals with direction `none`. `composite` is the mean of the oriented comparisons that are not `null`.

The rule is pinned by a shared fixture, [`fixtures/baseline/baseline-cases.json`](../fixtures/baseline/baseline-cases.json): inputs and expected comparisons, oriented values and composites, including fewer than 5 valid days, null days, a constant series and both directions. The JavaScript rule lives once, in the dashboard's `firebase/hosting/js/lib/baseline.js`; the seed re-exports it (`firebase/seed/src/baseline.js`). The seed tests and the dashboard tests (`firebase/hosting/test/baseline.test.mjs`) run the fixture through it. The Kotlin rule is `SignalBaseline` in `core` (`app.depressify.core.daily`), and `BaselineFixtureTest` runs every case of the same file on the JVM. (The screens' older `app.depressify.core.Baseline` has no spread floor; moving the screens to `SignalBaseline` is #16.) Change the rule only by changing the fixture, core and that file together.

### `consents/{subject}`: Consent

| Field | Type | Notes |
|---|---|---|
| `subject` | string | A Signal key, or `sharing`, `ratings`, `voice_cues`. Same as the document id. |
| `granted` | boolean | |
| `changedAtMillis` | int | |

- `consents/sharing` mirrors the record's `sharingConsent` (`granted` is `true` only for `granted`) and is written in the same transaction. The record's field is what the rules and functions read.
- `consents/ratings` and `consents/voice_cues`: with no document, ratings and Voice cues are included in Check-ins; `granted: false` leaves them out of future Check-ins (the Brief's instructions omit them). They are set in Settings → Sharing and privacy and are independent of sharing and of every Signal Consent.

### `checkIns/{checkInId}`: CheckIn

Start Check-in (#14, `startCheckIn`) creates the Check-in with the Admin SDK when it mints the Live token: `startedAtMillis` is the server time, the ratings, Voice cues and crisis marker are empty (`null`, `[]`, `false`), and it is stamped with `sharingStamp`. Finish Check-in (`finishCheckIn`) writes the ratings, Voice cues and crisis marker from the draft it receives, the same draft the Summary is made from, and `endedAtMillis` if it is still `null`. The app owns only the times: it may change them with an update of those fields, and never changes the rest. The rules still let the app create a Check-in as it would (empty function-only fields, stamped as now), but with Start Check-in it does not need to, and Finish Check-in refuses a Check-in id that does not exist (`not-found`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Same as the document id. |
| `startedAtMillis` | int | Set by Start Check-in; the app may update it. |
| `endedAtMillis` | int or null | Set by Finish Check-in when still `null` (a time the app already wrote is kept); the app may update it. |
| `mood`, `energy`, `sleepQuality` | int 1..5 or null | Unanswered is `null`. Written by Finish Check-in only. |
| `voiceCues` | VoiceCue[] | `{label, intensity 1..5, heard}`. Observations, never a diagnosis. Written by Finish Check-in only, from the draft. |
| `crisis` | boolean | `true` when the Check-in raised a crisis. Written by Finish Check-in only, from the draft's crisis marker. The red crisis flag itself is still raised by the phone at once (`flags`). |
| `sharedWithClinician` | boolean | The sharing stamp. |

### `summaries/{checkInId}`: Summary

The Patient reads exactly what the Clinician reads. Written only by Finish Check-in (`finishCheckIn`), in one transaction with the Check-in's fields and the Patient's `lastCheckInAtMillis` and `lastSeenAtMillis`. Without usable model output (a silent Check-in, a failed or malformed model reply) it is the minimal Summary: empty `themes`, `sleepLine` and `quotes`, `null` ratings, Voice cues and the Suggestion still from the draft. The transcript itself is never written.

| Field | Type | Notes |
|---|---|---|
| `checkInId` | string | Same as the document id. |
| `createdAtMillis` | int | When the first finish wrote it. A retried finish keeps it. |
| `mood`, `energy`, `sleepQuality` | int 1..5 or null | Only a number the Patient said; out-of-range values become `null`. `null` when the Patient left ratings out (`consents/ratings` `granted: false`). The same values go on the Check-in. |
| `sleepLine` | string | |
| `themes` | string[] | |
| `voiceCues` | VoiceCue[] | Taken from the Check-in draft, never from the model. `[]` when the Patient left Voice cues out (`consents/voice_cues` `granted: false`). |
| `suggestion` | string or null | The Suggestion made: the draft's accepted one, else its open proposal (`null` if every one was declined); when the draft has none, the line the text model heard agreed. |
| `previousOutcome` | string or null | What the Patient said about the previous Suggestion. |
| `quotes` | string[] | At most three, each at most 200 characters, and only the Patient's own words: a quote the model returns that is not in a Patient turn of the draft is dropped. |
| `sharedWithClinician` | boolean | The sharing stamp, from `sharingStamp` when Finish Check-in writes it. A retried finish keeps the stamp the Summary already has. |

### `suggestions/{suggestionId}`: Suggestion

The app records a Suggestion and changes only `status` and `booked`. The Outcome (`tried`, `felt`, `objectiveChange`, `outcomeScore`) is written by functions only: `null` when the app creates the Suggestion, and never changed by the app. The spec has the phone's daily job fill in `objectiveChange` and `outcomeScore`; under these rules that has to happen in a function instead (Finish Check-in, which writes `tried` and `felt`, can compute both, since the day's steps comparison is already on the daily record).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Same as the document id. |
| `kind` | SuggestionKind | Set when the app creates it. |
| `details` | string | Set when the app creates it. |
| `suggestedAtMillis` | int | Set when the app creates it. |
| `status` | SuggestionStatus | `proposed` until the Patient answers. The app may change it. |
| `booked` | boolean | Set only after the calendar write succeeds. The app may change it. |
| `tried` | boolean or null | `null` until answered; `false` is "not this time". Functions only. |
| `felt` | int 1..5 or null | Functions only. |
| `objectiveChange` | number or null | That day's oriented steps comparison with Baseline. Functions only. |
| `outcomeScore` | number or null | `null` until the Patient answers. Functions only. |
| `sharedWithClinician` | boolean | The sharing stamp. An Outcome filled in later does not change it. |

### `flags/{flagId}`: Flag

| Field | Type | Notes |
|---|---|---|
| `level` | FlagLevel | |
| `kind` | FlagKind | A kind with an uncleared flag is not raised again. |
| `reason` | string | A plain sentence, never a score. |
| `raisedAtMillis` | int | |
| `clearedAtMillis` | int or null | Set only by the Clinician, and only on a flag they can see. History is kept. |
| `sharedWithClinician` | boolean | The sharing stamp. A flag stamped `false` is never shown to the Clinician, never counts toward the Patient's `flagLevel`, and does not stop a shared flag of the same kind being raised later (the "not raised again" rule compares flags with the same stamp). |

**The silence check's flags.** `silenceCheck` (#28, hourly) writes red `silent` flags with the id `silent-<lastSeenAtMillis>`: one id per silence, so a retried or overlapping run never writes a second flag for the same silence, and a silence whose flag the Clinician has cleared is not flagged again until the phone has been seen and gone quiet once more. It writes only for a Patient who is sharing (`isSharingActive`), is not synthetic, and whose `lastSeenAtMillis` is more than 24 hours old (exactly 24 hours, `null` and a time in the future are not silent), and only when no uncleared `silent` flag with the same stamp is open. In the same transaction it raises the Patient's `flagLevel` to `red` and puts the reason first in `flagReasons`, keeping the other reasons; nothing else on the record changes. The flag is stamped with `sharingStamp(patient)`, which is `true` there. The reason is always "The phone has been quiet: it has not connected for over 24 hours." It says nothing about mood or self-harm.

**The daily job's flags.** The phone's daily job (#26, `FlagWriteRules` in `core`) raises `sleep_collapse`, `inactive`, `poor_sleep`, `low_mood` and `drift` with the id `<kind>-<date>` (the seed's format), or `<kind>-<date>-unshared` when stamped `false`, so a repeated run the same day computes the same id and a kind is raised at most once a day per stamp. It creates them uncleared and stamped with `sharingStamp()`, skips a kind with an uncleared flag of the same stamp, and skips a `low_mood` whose three Check-ins an earlier flag of that kind already covered. Only flags stamped `true` change the record: the level only rises and every existing reason is kept, as in `raisedAttention`. It never writes Suggestions: `objectiveChange` and `outcomeScore` are Finish Check-in's (#21).

**Creating a red flag emails the Clinician.** Any writer can create the flag: the phone's crisis tool, Finish Check-in's Decisions backstop (#20), the phone's daily job, or the hourly silence check (#28, `silent`). The `redFlagAlert` function reacts to every created flag and writes the email to [`mail`](#mailmailid-maildoc). A writer must never send mail itself, and must not create a red flag a second time to "resend" it. The "not raised again" rule already prevents that, and the email is tied to the flag's id.

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
| `sharedWithClinician` | boolean | The sharing stamp (`sharingStamp`). Digests are written only for sharing Patients, so it is `true`. |

The text and `summaryCount` draw only on Summaries and daily records stamped `sharedWithClinician: true` (`weekData` in `firebase/functions/src/digest.ts`): a week that spans a time without sharing never tells the Clinician what was said or measured then.

Which week each writer covers:

- **`weeklyDigest`** runs on Mondays at 07:00 Europe/Helsinki and writes the **previous** ISO week, Monday 00:00 to the next Monday 00:00 in Helsinki: the last complete week. It writes one Digest for every Patient who is sharing.
- **`generateDigest`** ("Generate now" on the dashboard, the Patient's Clinician only) writes the **current** ISO week from Monday to today. It overwrites that week's document, so pressing it again regenerates, and the next Monday's job replaces it with the complete week.

A Summary belongs to the week of its `createdAtMillis` in Helsinki time; a daily record to the week of its `date`.

**Patients who are not sharing get no Digest.** The weekly job skips them (`isSharingActive`) and `generateDigest` refuses them (`assertClinicianOf`). A Digest is written for the Clinician, who cannot read it while sharing is off, so making one would send the Patient's week to the model with no reader. Digests written before sharing was withdrawn are kept: deleting derived records is an open decision (see [Sharing Consent](#sharing-consent)). Nothing logs a Summary, a quote, the prompt or the Digest text.

### `mail/{mailId}`: MailDoc

Red flag emails for the Clinician (issue #22), in the shape the [Firebase Trigger Email extension](../README.md#red-flag-email) reads. **Written only by the `redFlagAlert` function** (`firebase/functions/src/alertFunctions.ts`, Admin SDK), and only when a flag is created in `patients/{patientId}/flags/{flagId}`. No client can read or write the collection.

| Field | Type | Notes |
|---|---|---|
| `to` | string | The Patient's `clinicianEmail`, read from the Patient record when the flag is created, trimmed and in lower case. Never in code. |
| `message.subject` | string | `[CRISIS] Red flag for <display name>: crisis in a Check-in` for a crisis. Any other red is `[RED] Red flag for <display name>: <kind>`, where `silent` is worded "quiet phone". |
| `message.text` | string | Plain text: who the flag is for and when (Helsinki time); `Reason: ` and the flag's reason on one line, at most 300 characters; a fixed line for the kind (the quiet-phone line says a quiet phone is not by itself a sign of self-harm); and a link to the Patient's dashboard page, `<DASHBOARD_URL>/#/patient/<patientId>`. It never carries a transcript, a quote, Summary text, the Intake or any other field, and it uses the companion's words: no diagnosis, treatment or score. |

The extension adds a `delivery` map (state, attempts, error) to the document as it sends. Nothing in this repository reads it.

**Document id:** `red-flag-` followed by the SHA-256 hex of `<patientId>/<flagId>`. The function writes it with `create()`. Triggers are delivered at least once and this one is retried on failure, so a second delivery finds the document and sends nothing. There is at most one email per flag.

**When an email is written** (`alertDecision` in `firebase/functions/src/alerts.ts`, a pure function):

- The flag is `red`, has `clearedAtMillis: null` and is stamped `sharedWithClinician: true`. Amber and green never email.
- The Patient's `sharingConsent` is `granted` when the trigger runs (`isSharingActive`). A Patient who declined or withdrew sharing gets no email, and nothing is sent later if they share again.
- The Patient is not a Demo Patient (`synthetic: false`). The seed deletes and recreates the Demo Patients' invented red flags on every run, and each run would otherwise email the Clinician.
- `clinicianEmail` is an address.

Each run logs one line: the Patient and flag ids, the flag's kind (a `FlagKind`, or `other`) and the outcome (`sent`, `duplicate`, or `skipped` with the check that stopped it). It never logs the reason, the display name, the address or the email.

**`DASHBOARD_URL`** is a non-secret function parameter for the link. Empty, which is the default, means the project's Hosting site, `https://<project-id>.web.app`.

### `clinicians/{email}`: allowlist

The Clinicians a new Patient may link to, one document per email. The document id is the email in lower case, exactly as the Clinician's sign-in token carries it and as the app writes `clinicianEmail`. The rules only check that the document exists. No client may read or write the collection; it is written with the Admin SDK by `npm run allow-clinician -- --email <addr>` and by the seed (for the Clinician it seeds for). This keeps the real Clinician's email out of the repository. Removing a document stops new Patients linking to that Clinician; Patients already linked keep their link.

| Field | Type | Notes |
|---|---|---|
| `email` | string | The same as the document id. |

## Queries

| Who | Query | Index |
|---|---|---|
| Dashboard Patient list | `patients` where `clinicianEmail == <signed-in email>` and `sharingConsent == "granted"` | none: two equality filters are served by merging the automatic single-field indexes. Adding an `orderBy` on another field needs a composite index in `firestore.indexes.json`. |
| Dashboard newest-flag order, banner and level | `patients/{id}/flags` where `sharedWithClinician == true`, for each listed Patient | none: one equality filter |
| Dashboard Patient page | `daily`, `checkIns`, `summaries`, `suggestions`, `flags` where `sharedWithClinician == true`; `consents`, `visits` unfiltered | none: one equality filter, sorted in the browser |
| Dashboard latest Digest | `patients/{id}/digests` where `sharedWithClinician == true`, order by `isoWeek` descending, limit 1 | composite `digests (sharedWithClinician ASC, isoWeek DESC)` in [`firestore.indexes.json`](../firebase/firestore.indexes.json). The emulator does not enforce indexes; production does. |
| Clear after follow-up | `patients/{id}/flags` where `sharedWithClinician == true`, then the reviewed flags by id in a transaction | none |
| Digest functions | `summaries` by `createdAtMillis` range, `daily` by `date` range (Admin SDK); the stamp is filtered in code | single field (automatic) |
| Seed reset | `patients` where `synthetic == true` (Admin SDK) | single field (automatic) |
| Silence check | all `patients`, selecting `sharingConsent`, `synthetic` and `lastSeenAtMillis` only; then, in each silent Patient's transaction, `patients/{id}/flags` where `kind == "silent"` (Admin SDK) | single field (automatic) |

The list query must carry the sharing filter (built by `clinicianListFilters` in `firebase/hosting/js/lib/sharing.js`); without it the rules reject the whole query. Likewise every query on a stamped collection is built by `patientCollectionQuery` in the same file (bound to the browser SDK in `js/queries.js`), which adds `sharedWithClinician == true`. A new query that adds an `orderBy` or range on another field needs a composite index.

## Demo Patients

`firebase/seed` writes three Demo Patients with the Admin SDK: `demo-steady` (green), `demo-declining` (amber flags, then red in the last two days) and `demo-sparse` (seven Check-ins at most, days of missing Signals, amber for low mood). Each has `synthetic: true`, `healthSource: "synthetic"`, `sharingConsent: "granted"`, the seeded Clinician (`--clinician` or `CLINICIAN_EMAIL`, also added to `clinicians`), an Intake that begins "Synthetic demo data", 42 daily records ending today, a TMS end date 42 days ago, one Visit 21 days ago with a PHQ-9 score, every Consent granted, and Check-ins with Summaries and Suggestions (most with an Outcome score). Every value is invented. Flags sit on the first morning the spec's starting thresholds hold. Every stamped document is `sharedWithClinician: true`, except that `demo-steady` stopped sharing from 06:00 30 days ago to 06:00 27 days ago: its three daily records, Check-ins, Summaries and Suggestions from that time are stamped `false`, so the dashboard shows a three-day gap; its `sharingChangedAtMillis` and `consents/sharing` are the time it shared again. Document ids are stable: daily records by date, `checkin-<date>` (also the Summary id), `suggestion-<date>`, `<kind>-<date>` for flags and `visit-<date>`.


## Security rules

[`firebase/firestore.rules`](../firebase/firestore.rules) encodes who may see a Patient's progress: the Patient themselves, their Clinician, and, as a demo shortcut, any signed-in user for a Patient marked `synthetic`. The tests are in [`firebase/functions/test/rules/`](../firebase/functions/test/rules/firestore-rules.test.ts). Functions and the seed use the Admin SDK, which bypasses the rules.

- **Patient**: the anonymous auth uid equal to `patientId`.
- **Clinician**: a signed-in user whose token email equals the record's `clinicianEmail`, while the record's `sharingConsent` is `granted`. A new record may only name a Clinician in the `clinicians` allowlist. The demo does not require `email_verified` because emulator accounts are unverified; production must.
- **Demo shortcut**: on a record with `synthetic == true`, any signed-in user has the Patient's access, with the Patient's limits.

| | Patient (or anyone on a Demo Patient) | Clinician of the Patient, while sharing is granted | Anyone else signed in | Signed out |
|---|---|---|---|---|
| Patient record: read | yes | yes | no | no |
| Patient record: create | own id only, `clinicianEmail` a Clinician in `clinicians`, `synthetic` false, `tmsEndDate` null, `intakeHighlights` empty | no | no | no |
| Patient record: update | `quietHoursStart`, `quietHoursEnd`, `lastSeenAtMillis`, `lastCheckInAtMillis`, `healthSource`, `sharingConsent` (to `granted` or `declined`, always with a new `sharingChangedAtMillis`), `sharingChangedAtMillis`; `flagLevel` and `flagReasons` only to raise (level never lower, reasons kept) | `displayName`, `tmsEndDate`, and a reset of `flagLevel` and `flagReasons` | no | no |
| Patient record: delete | no | no | no | no |
| `daily` | read, write (create stamped as now; the stamp never changes) | read documents stamped `true` | no | no |
| `consents` | read, write | read | no | no |
| `checkIns` | read; create with no ratings, no Voice cues and `crisis: false`, stamped as now; update `startedAtMillis` and `endedAtMillis` only; delete | read documents stamped `true` | no | no |
| `suggestions` | read; create with no Outcome, stamped as now; update `status` and `booked` only; delete | read documents stamped `true` | no | no |
| `summaries` | read | read documents stamped `true` | no | no |
| `flags` | read; create uncleared flags stamped as now; no change or delete | read documents stamped `true`; set `clearedAtMillis` only, on those | no | no |
| `visits` | read | read, create, update, delete | no | no |
| `digests` | read | read documents stamped `true` | no | no |
| `mail` | no | no | no | no |
| `clinicians` | no | no | no | no |

Anything not listed, including a collection outside this schema, is denied. Field owners: `displayName`, `tmsEndDate` and clearing flags belong to the Clinician; `intakeHighlights`, Summaries, a Check-in's ratings, Voice cues and crisis marker, and a Suggestion's Outcome are written by functions only, so what reaches the Clinician is recorded by the app and functions, not edited by hand; `synthetic` and `clinicianEmail` never change after creation from a client; `sharedWithClinician` never changes after creation.

A Clinician query on a stamped collection must filter on `sharedWithClinician == true`, or the whole query is refused. A Clinician `get` of a stamped document that does not exist is refused like a hidden one, so a refusal never tells that a document exists.

`flagLevel`, `flagReasons` and `flags` are readable by the Patient's own app, because the phone raises flags and needs the open ones to avoid duplicates. The app never shows them (ADR 0005, ADR 0009).

## Sharing Consent

The Patient decides whether their Clinician sees their progress (issue #29, ADR 0005). `undecided` (a new record) and `declined` both mean the Clinician sees nothing.

- **Rules.** `clinicianCanRead` in `firestore.rules` requires `sharingConsent == 'granted'`, and every Clinician read and write of the record and its collections goes through it. Withdrawing takes effect at once: the dashboard's list query (which filters on `granted`) drops the Patient, and a listener already open on the Patient's record or collections gets `permission-denied`. The dashboard maps that error to a "sharing withdrawn" state with `sharingStateFromError` in `firebase/hosting/js/lib/sharing.js`; every Patient view should use it rather than show an error. A Demo Patient stays readable through the demo shortcut, so views also check the field with `sharingStateFromSnapshot`.
- **Functions.** Functions use the Admin SDK and bypass the rules, so they check `isSharingActive(patient)` from `firebase/functions/src/sharing.ts` themselves. **The flag email (#22, `redFlagAlert`) and the silence check (#28, `silenceCheck`) use it**: while it is false no flag email is sent for the Patient and the silence check skips them. The weekly Digest (#23) skips them too, and `generateDigest` refuses them. Check-ins, Summaries and the Patient's own records continue.
- **Granting again** shares future records only: the Clinician sees what is saved from then on and, again, what was saved during earlier sharing periods, but never what was saved while the Patient was not sharing. That is the sharing stamp, below. The app says so where the Patient withdraws and where they share again (`SharingCopy` in `shared`). Whether records are deleted on withdrawal is an open decision.
- **The app** shows the welcome and the sharing choice while `sharingConsent` is `undecided`, and saves a decision with `sharingChangedAtMillis` and `consents/sharing` in one transaction. Nothing moves a record back to `undecided`.

### The sharing stamp

Re-consent shares future records only. Every document in `daily`, `checkIns`, `summaries`, `suggestions`, `flags` and `digests` carries `sharedWithClinician`, set when the document is created to whether the Patient's `sharingConsent` is `granted` at that moment, and never changed.

- **Rules.** On a client create the stamp must equal `patient.sharingConsent == 'granted'` as it stands before the write; on a client update it must not change (nor be dropped). The Clinician reads a stamped document only when `clinicianCanRead` holds and the document is stamped `true`, and clears only flags stamped `true`. The Patient, and the demo shortcut, read everything.
- **Writers.** The app stamps with `PatientDoc.sharingStamp()` (core) and functions with `sharingStamp(patient)` (`firebase/functions/src/sharing.ts`); the Admin SDK bypasses the rules, so every function writer must call it: the Digest functions and the silence check (#28) today, and Finish Check-in (#14) and any other writer of these collections later. A writer that rewrites an existing document (the daily job's later runs, a retried finish) keeps the stamp the document has; it never deletes and recreates a document to change it.
- **Flags and the Patient's level.** The Clinician can read only flags stamped `true`, so the record's `flagLevel` and `flagReasons` count only those: a flag raised while not sharing is stamped `false`, leaves the level and reasons alone, and does not block raising a shared flag of the same kind later. That keeps the record free of reasons the Clinician must not see, and lets "Clear after follow-up" recompute the level from all the flags that make it. The dashboard shows the level and reasons from the visible open flags once they load (`shownAttention` in `firebase/hosting/js/lib/clear.js`), and from the record only until then.
- **Dashboard.** Every query on a stamped collection goes through `patientCollectionQuery` (`firebase/hosting/js/lib/sharing.js`). On a Demo Patient any signed-in user has the Patient's access, so there the rules do not hide unshared documents; the dashboard's filter does.
- **Not stamped.** `consents` (the current permissions the dashboard needs), `visits` (written by the Clinician) and the Patient record. The record's `lastSeenAtMillis` and `lastCheckInAtMillis` are current values, not records: after sharing again, `lastCheckInAtMillis` can be the time of a Check-in saved while not sharing.
