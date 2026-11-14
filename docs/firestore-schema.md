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
| `Assessment` | `assessed`, `unassessed`, `unavailable`. How Finish Check-in's automatic review of a Check-in went (#20); see `checkIns`. |

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
patientLimits/{patientId}            PatientLimits   hourly caps and who started each recent Check-in; functions only
```

### `patients/{patientId}`: PatientDoc

| Field | Type | Default on creation | Notes |
|---|---|---|---|
| `displayName` | string | `"Live patient"` (app) | The Clinician may rename. |
| `clinicianEmail` | string | the configured Clinician (`DemoConfig.clinicianEmail`, from `secrets.properties` or the iOS plist) | Links the Patient to the Clinician; the dashboard queries on it. Lower case. On creation it must have a document in [`clinicians`](#cliniciansemail-allowlist). |
| `intakeHighlights` | string | `""` | Extracted from the Intake, at most 120 words, reviewed by the Clinician. Written only by the `saveIntake` function (Clinician only); no client writes it. The report itself is never stored. |
| `tmsEndDate` | date string or null | `null` | Set by the Clinician. Week 1 starts the day after. |
| `flagLevel` | FlagLevel | `green` | The highest uncleared flag stamped `sharedWithClinician: true`. A flag raised while the Patient was not sharing never counts. Never shown to the Patient. |
| `flagReasons` | string[] | `[]` | The reasons of those flags, highest level first, then newest. Plain sentences: never a score or a decimal number (a plain duration such as "under 3 hours" is fine). |
| `quietHoursStart` | int 0..23 | `21` | No Nudges inside quiet hours; the window may cross midnight. |
| `quietHoursEnd` | int 0..23 | `9` | |
| `lastSeenAtMillis` | int or null | `null` | Last sign of life from the phone. The hourly silence check (`silenceCheck`, #28) reads it: older than 24 hours on a sharing, non-synthetic Patient raises red `silent`. `null` (never seen) is not silent. Finish Check-in moves it to the time of the finish, and the phone's daily job (#26) to the time of each run (never back). |
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
| `demoOverride` | boolean | `true` when a demo control wrote this record. Overrides only ever touch these. The live demo Patient's seeded history sets it on every daily record it writes, and `--reset` deletes exactly those (see [Live demo Patient](#live-demo-patient)). The app writes `false`. |
| `sharedWithClinician` | boolean | The sharing stamp. A record rewritten later in the day keeps the stamp it was created with. |

#### Baseline

A Signal's Baseline is the Patient's own median over the 14 calendar dates strictly before the record's date, counting only dates with a value (ADR 0003). With fewer than 5 such dates, or no value today, the comparison is `null`. Otherwise:

```
spread     = max(sample standard deviation (n - 1), 0.05 x |median|, 0.001)
vsBaseline = (today - median) / spread
```

The floor keeps a constant history from dividing by zero. `vsBaseline` keeps the sign as measured; the oriented comparison negates it for `lower_is_better` Signals, so negative always means worse, and is `null` for Signals with direction `none`. `composite` is the mean of the oriented comparisons that are not `null`.

The rule is pinned by a shared fixture, [`fixtures/baseline/baseline-cases.json`](../fixtures/baseline/baseline-cases.json): inputs and expected comparisons, oriented values and composites, including fewer than 5 valid days, null days, a constant series and both directions. The JavaScript rule lives once, in the dashboard's `firebase/hosting/js/lib/baseline.js`; the seed re-exports it (`firebase/seed/src/baseline.js`). The functions keep a TypeScript copy, `firebase/functions/src/baseline.ts` (functions are built from `src` alone), which Finish Check-in uses for an Outcome's `objectiveChange` (#21). The seed tests, the dashboard tests (`firebase/hosting/test/baseline.test.mjs`) and the functions tests (`firebase/functions/test/baseline.test.ts`) run the fixture through their copy, and in `core`, `BaselineFixtureTest` runs every case on the JVM through `SignalBaseline` (`app.depressify.core.daily`), the Kotlin rule. (The screens' older `app.depressify.core.Baseline` has no spread floor; moving the screens to `SignalBaseline` is #16.) Change the rule only by changing the fixture and every copy together.

### `consents/{subject}`: Consent

| Field | Type | Notes |
|---|---|---|
| `subject` | string | A Signal key, or `sharing`, `ratings`, `voice_cues`. Same as the document id. |
| `granted` | boolean | |
| `changedAtMillis` | int | |

- `consents/sharing` mirrors the record's `sharingConsent` (`granted` is `true` only for `granted`) and is written in the same transaction. The record's field is what the rules and functions read.
- `consents/ratings` and `consents/voice_cues`: with no document, ratings and Voice cues are included in Check-ins; `granted: false` leaves them out of future Check-ins (the Brief's instructions omit them). They are set in Settings → Sharing and privacy and are independent of sharing and of every Signal Consent.

### `checkIns/{checkInId}`: CheckIn

Start Check-in (#14, `startCheckIn`) creates the Check-in with the Admin SDK when it mints the Live token: `startedAtMillis` is the server time, the ratings, Voice cues, crisis marker, `assessment` and `previousTried` are empty (`null`, `[]`, `false`, `null`, `null`), and it is stamped with `sharingStamp`. Finish Check-in (`finishCheckIn`) writes the ratings, Voice cues and crisis marker from the draft it receives, the same draft the Summary is made from, `assessment` and `previousTried` from the Decisions API's answers (#20), and `endedAtMillis` if it is still `null`. The app owns only the times: it may change them with an update of those fields, and never changes the rest. The rules still let the app create a Check-in as it would (empty function-only fields, stamped as now), but with Start Check-in it does not need to, and Finish Check-in refuses a Check-in id that does not exist (`not-found`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Same as the document id. |
| `startedAtMillis` | int | Set by Start Check-in; the app may update it. |
| `endedAtMillis` | int or null | Set by Finish Check-in when still `null` (a time the app already wrote is kept); the app may update it. |
| `mood`, `energy`, `sleepQuality` | int 1..5 or null | Unanswered is `null`. Written by Finish Check-in only. |
| `voiceCues` | VoiceCue[] | `{label, intensity 1..5, heard}`. Observations, never a diagnosis. Written by Finish Check-in only, from the draft. |
| `crisis` | boolean | `true` when the Check-in raised a crisis. Written by Finish Check-in only, from the draft's crisis marker. The phone raises its own red crisis flag at once (`flags`); Finish Check-in also raises `crisis-<checkInId>` from the marker unless a crisis flag with the same stamp is still open. |
| `assessment` | Assessment or null | How the automatic review (the Decisions API, #20) went. `assessed`: answered, and any flag it gave is in `flags`. `unassessed`: the safety filter refused to judge it; an amber `unassessed` flag was raised. `unavailable`: a timeout or other failure; no flag came from the review, and the dashboard shows "Assessment unavailable" beside the last known level when the latest reviewed Check-in has it (`assessmentNote` in `hosting/js/lib/flag-detail.js`), never a new green. `null` until Finish Check-in, and for a Check-in in which the Patient said nothing (nothing to review). A retry whose review fails keeps an earlier `assessed` or `unassessed`. Written by Finish Check-in only; never shown to the Patient. |
| `previousTried` | boolean or null | Whether the Patient tried the previous Suggestion, as the review heard it: `true` (the answer was at or above 0.6), `false` (at or below 0.4), or `null` when unknown (in between, not asked because there was no previous Suggestion, or no review). It is the review's answer only: the Outcome on the Suggestion (#21) takes the text model's answer first and this one only when the text model is unsure, so the two can differ. Written by Finish Check-in only. |
| `sharedWithClinician` | boolean | The sharing stamp. |

### `summaries/{checkInId}`: Summary

The Patient reads exactly what the Clinician reads. Written only by Finish Check-in (`finishCheckIn`), in one transaction with the Check-in's fields and the Patient's `lastCheckInAtMillis` and `lastSeenAtMillis`. A model timeout, lost connection, rate limit or server error writes nothing and answers `unavailable`, so the phone retries while it still holds the draft. Without usable model output otherwise (a silent Check-in, a request the model refuses, a malformed reply) it is the minimal Summary: empty `themes`, `sleepLine` and `quotes`, `null` ratings, Voice cues and the Suggestion still from the draft. The transcript itself is never written.

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
| `sharedWithClinician` | boolean | The sharing stamp: `true` only when the Check-in is stamped `true` and the Patient still shares when Finish Check-in writes it. A Check-in started while not sharing, or one the Patient stopped sharing during, gives an unshared Summary. A retried finish keeps the stamp the Summary already has. |

### `suggestions/{suggestionId}`: Suggestion

The app records a Suggestion and changes only `status` and `booked`. The Outcome (`tried`, `felt`, `objectiveChange`, `outcomeScore`, `outcomeCheckInId`) is written by functions only: `null` when the app creates the Suggestion (an app that sends no `outcomeCheckInId` is accepted too), and never changed by the app. The spec has the phone's daily job fill in `objectiveChange` and `outcomeScore`; under these rules Finish Check-in computes both when it records the Outcome (#21, below).

The four states of an accepted Suggestion's Outcome, kept apart by two fields (a field that means more than two things gets a type):

| State | `outcomeCheckInId` | `tried` | `felt` | `objectiveChange` | `outcomeScore` |
|---|---|---|---|---|---|
| Open: not answered yet | `null` | `null` | `null` | `null` | `null` |
| "Prefer not to say": answered, unknown | the Check-in | `null` | `null` | `null` | `null` |
| "Not this time" | the Check-in | `false` | `null` | the day's change, or `null` | `-0.1` |
| Tried | the Check-in | `true` | 1..5 or `null` | the day's change, or `null` | `-1..1` |

A proposed or declined Suggestion never gets an Outcome, so "declined" (`status`) never means "not tried".

| Field | Type | Notes |
|---|---|---|
| `id` | string | Same as the document id. |
| `kind` | SuggestionKind | Set when the app creates it. |
| `details` | string | Set when the app creates it. |
| `suggestedAtMillis` | int | Set when the app creates it. |
| `status` | SuggestionStatus | `proposed` until the Patient answers. The app may change it. |
| `booked` | boolean | Set only after the calendar write succeeds. The app may change it. |
| `tried` | boolean or null | `null` until answered, and for "prefer not to say"; `false` is "not this time". Functions only. |
| `felt` | int 1..5 or null | How trying it felt, when tried and the Patient said. Functions only. |
| `objectiveChange` | number or null | The oriented steps comparison with Baseline on the day the Suggestion was made (Helsinki date of `suggestedAtMillis`). `null` for "prefer not to say", when the Patient has left steps out, or when that day has no comparison. Functions only. |
| `outcomeScore` | number or null | `null` until the Patient answers, and for "prefer not to say". Functions only. See the rule below. |
| `outcomeCheckInId` | string or null | The Check-in whose answer recorded the Outcome; `null` while it is open. Functions only. |
| `sharedWithClinician` | boolean | The sharing stamp. An Outcome filled in later does not change it. |

**Outcomes and learning what helps (#21).** Finish Check-in records the Outcome in its one transaction (`firebase/functions/src/outcomes.ts`, pure):

- **Target.** The function finds it: the most recent accepted Suggestion (by `suggestedAtMillis`, then id) made before the Check-in started, not one of the draft's own Suggestions, with no Outcome yet (`outcomeCheckInId`, `tried` and `outcomeScore` all `null`), or whose Outcome this same Check-in recorded. When the request names `lastSuggestionId` (the Suggestion the Companion asked about) and it is not that target, no Outcome is written: the answer was about another Suggestion, such as a declined one. The transaction finds the target again and writes only if it is unchanged.
- **Which answer counts.** The text model's structured output first: `previousTried` true or false (with `previousFelt` 1..5 when tried), then `previousPreferNotToSay`. Only when the text model is unsure (said nothing either way, or gave no usable reply) does the Decisions answer (#20) decide, and only a clear yes or no (`previousTried` on the Check-in). With neither, nothing is written and the Outcome stays open for the next Check-in. A silent Check-in records none.
- **`objectiveChange`.** The daily record of the Suggestion's day: its stored `vsBaseline.steps` when that is a number, otherwise the comparison computed from the 14 records before it by the shared Baseline rule; oriented (steps are higher-is-better). `null` when there is no such day, no steps that day, too few valid days, or `consents/steps` is `granted: false`.
- **`outcomeScore`.** `null` until answered and for "prefer not to say"; `-0.1` for "not this time", whatever the steps say (an Outcome is the Patient's report, and sensors never override "not this time"); otherwise `clamp(0.7 x (felt - 3) / 2 + 0.3 x clamp(objectiveChange, -1, 1), -1, 1)`, where a feeling not given and a missing step change each count as 0. The step change is clamped before it is weighted, so it moves the score by at most 0.3 and cannot turn a bad feeling good.
- **Once.** An Outcome is applied once: a Suggestion that has one, from this Check-in or another, is never written again, so a retried finish leaves what its first attempt recorded and a late retry never overwrites a later Check-in's Outcome. Only the Outcome fields change; the stamp, status and the rest stay.
- **Ranking.** Only scored Suggestions count, by mean then count (both descending, ties in `SuggestionKind` order). The Brief gets the top three kinds and, when the injected random source is below 0.2, one kind to try: the first kind with no score, or else the least-scored kind outside the top three. Kotlin: `SuggestionRanker` and `Outcomes` in `core` (`app.depressify.core.learning`), for the phone's Brief builder (the functions only write the scores). The dashboard's "what seems to help" (`firebase/hosting/js/lib/what-helps.js`) orders by the same stored `outcomeScore` and counts a Suggestion as waiting only while its Outcome is open.
- **One rule.** The score, the ranking, the guidance and the target are pinned by [`fixtures/outcomes/outcome-cases.json`](../fixtures/outcomes/outcome-cases.json), read by the functions' tests, core's JVM tests and the seed's tests.

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

**Finish Check-in's flags (#20).** Finish Check-in asks the Decisions API three yes/no questions about the Check-in (crisis, marked hopelessness or decline, tried the last Suggestion) and routes the answers with the spec's starting thresholds (`DECISION_THRESHOLDS` in `firebase/functions/src/decisions.ts`): crisis at or above 0.5, or the draft's crisis marker, gives red `crisis`; decline at or above 0.6 gives amber `decline`; a safety refusal (HTTP 400 with a documented safety code) gives amber `unassessed`; a timeout or any other failure gives no flag and `assessment: "unavailable"` on the Check-in. The flag id is `<kind>-<checkInId>`, so a retried finish never writes a second one, and a flag the Clinician cleared is not raised again by the same Check-in. No flag is written when an uncleared flag of that kind with the same stamp is open (the phone's own `crisis-<millis>` counts). Flags are stamped like the Summary: `true` only when the Check-in was started while sharing and the Patient still shares. In the same transaction as the Summary, a flag stamped `true` raises the Patient's `flagLevel` (never lowers it) and adds its reason (`raisedAttention` in `src/flags.ts`, shared with the silence check). When the text model fails in a way that may pass (Finish Check-in answers `unavailable` and saves no Summary), the flags are still written in their own transaction, so a crisis is not lost if the phone never retries. The reasons are fixed sentences with no number and nothing the Patient said:

| Kind | Level | Reason |
|---|---|---|
| `crisis` (draft's marker) | red | "Signs of a crisis came up during a Check-in." |
| `crisis` (Decisions answer) | red | "The automatic review of a Check-in found signs of a crisis." |
| `decline` | amber | "The automatic review of a Check-in found marked hopelessness or a clear decline in coping." |
| `unassessed` | amber | "A Check-in could not be assessed automatically." |

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

**Hourly cap.** A phone writes its own flags, with its own reason, so one Patient record causes at most 5 emails an hour (`MAX_RED_FLAG_EMAILS_PER_HOUR`, counted in [`patientLimits`](#patientlimitspatientid-functions-only) in the same transaction that creates the email). A flag past the cap is still recorded and shown on the dashboard; only its email is skipped.

**When an email is written** (`alertDecision` in `firebase/functions/src/alerts.ts`, a pure function):

- The flag is `red`, has `clearedAtMillis: null` and is stamped `sharedWithClinician: true`. Amber and green never email.
- The Patient's `sharingConsent` is `granted` when the trigger runs (`isSharingActive`). A Patient who declined or withdrew sharing gets no email, and nothing is sent later if they share again.
- The Patient is not a Demo Patient (`synthetic: false`). The seed deletes and recreates the Demo Patients' invented red flags on every run, and each run would otherwise email the Clinician.
- `clinicianEmail` is an address.

Each run logs one line: the Patient and flag ids, the flag's kind (a `FlagKind`, or `other`) and the outcome (`sent`, `duplicate`, `capped`, or `skipped` with the check that stopped it). It never logs the reason, the display name, the address or the email.

**`DASHBOARD_URL`** is a non-secret function parameter for the link. Empty, which is the default, means the project's Hosting site, `https://<project-id>.web.app`.

### `clinicians/{email}`: allowlist

The Clinicians a new Patient may link to, one document per email. The document id is the email in lower case, exactly as the Clinician's sign-in token carries it and as the app writes `clinicianEmail`. The rules only check that the document exists. No client may read or write the collection; it is written with the Admin SDK by `npm run allow-clinician -- --email <addr>` and by the seed (for the Clinician it seeds for). This keeps the real Clinician's email out of the repository. Removing a document stops new Patients linking to that Clinician; Patients already linked keep their link.

| Field | Type | Notes |
|---|---|---|
| `email` | string | The same as the document id. |

### `patientLimits/{patientId}`: functions only

What the functions count per Patient record (`firebase/functions/src/limits.ts`). No client reads or writes it, so a client cannot reset a cap, and it is not part of the data contract in `core`. The seed does not delete it.

| Field | Type | Notes |
|---|---|---|
| `checkInStarts` | list of `{checkInId, uid, startedAtMillis}` | One entry per Check-in Start Check-in created in the last day (older entries are dropped on the next start). Start Check-in refuses the 11th start in an hour with `resource-exhausted`, before minting a token; only the last hour counts. Finish Check-in reads `uid`: a caller who is not the Patient (the Demo Patient shortcut) may finish only a Check-in they started, also when the finish is retried hours later. |
| `redFlagEmailsAtMillis` | list of integers | When `redFlagAlert` wrote each email in the last hour. The 6th in an hour is skipped (`capped`). |

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
| Live demo Patient reset | every document of one Patient's `daily`, `checkIns`, `summaries`, `suggestions`, `flags` and `visits`, filtered in code by the seeded markers (Admin SDK) | none |
| Finish Check-in | in the finish transaction, `patients/{id}/flags` where `kind in ["crisis", "decline", "unassessed"]` (Admin SDK) | single field (automatic) |
| Silence check | all `patients`, selecting `sharingConsent`, `synthetic` and `lastSeenAtMillis` only; then, in each silent Patient's transaction, `patients/{id}/flags` where `kind == "silent"` (Admin SDK) | single field (automatic) |

The list query must carry the sharing filter (built by `clinicianListFilters` in `firebase/hosting/js/lib/sharing.js`); without it the rules reject the whole query. Likewise every query on a stamped collection is built by `patientCollectionQuery` in the same file (bound to the browser SDK in `js/queries.js`), which adds `sharedWithClinician == true`. A new query that adds an `orderBy` or range on another field needs a composite index.

## Demo Patients

`firebase/seed` writes three Demo Patients with the Admin SDK: `demo-steady` (green), `demo-declining` (amber flags, then red in the last two days) and `demo-sparse` (seven Check-ins at most, days of missing Signals, amber for low mood). Each has `synthetic: true`, `healthSource: "synthetic"`, `sharingConsent: "granted"`, the seeded Clinician (`--clinician` or `CLINICIAN_EMAIL`, also added to `clinicians`), an Intake that begins "Synthetic demo data", 42 daily records ending today, a TMS end date 42 days ago, one Visit 21 days ago with a PHQ-9 score, every Consent granted, and Check-ins with Summaries and Suggestions (most with an Outcome score). Every value is invented. Flags sit on the first morning the spec's starting thresholds hold. Every stamped document is `sharedWithClinician: true`, except that `demo-steady` stopped sharing from 06:00 30 days ago to 06:00 27 days ago: its three daily records, Check-ins, Summaries and Suggestions from that time are stamped `false`, so the dashboard shows a three-day gap; its `sharingChangedAtMillis` and `consents/sharing` are the time it shared again. Seeded Check-ins carry `assessment: "assessed"` and, when the previous Suggestion was accepted, `previousTried` equal to its `tried`; that Suggestion's Outcome is scored by the shared Outcome rule and its `outcomeCheckInId` is that Check-in. Document ids are stable: daily records by date, `checkin-<date>` (also the Summary id), `suggestion-<date>`, `<kind>-<date>` for flags and `visit-<date>`.

## Live demo Patient

`npm run seed-live-patient` in `firebase/seed` gives one real account (found or created in Firebase Auth by `--email`) six weeks of invented history under `patients/<uid>`. The record is a normal Patient's: `synthetic: false`, so only the owner and their Clinician read it and alerts apply, with `healthSource: "synthetic"` to label the data, `sharingConsent: "granted"` and the given Clinician. The history comes from the same generator as the Demo Patients (profile `live` in `firebase/seed/src/live-profile.js`). The README lists what it contains.

The contract has no marker field on most documents, so the seeded history is marked with what the contract already has:

| Collection | Marker | Why it is safe |
|---|---|---|
| `daily` | `demoOverride: true` (the id is the date) | The app writes `false`. A date the app has already written is skipped, so the app's record wins. |
| `checkIns`, `summaries`, `suggestions`, `flags`, `visits` | id starts with `demo-`: `demo-checkin-<date>` (also the Summary id), `demo-suggestion-<date>`, `demo-<kind>-<date>`, `demo-visit-<date>` | Start Check-in uses random ids, the app's crisis flag is `crisis-<millis>`, the silence check's is `silent-<millis>`, and the app's Suggestion ids are `s<millis>`. |
| `consents` | none: one document per subject | Rewritten (all granted) on every run, never deleted. |
| the record | none | Rewritten on every run (merged), with `flagLevel` and `flagReasons` from every open flag stamped `sharedWithClinician`, the app's included, and `lastCheckInAtMillis` the later of the seeded history's and the app's. |
| `digests` | not written | The Digest function's. A Digest it made from seeded Summaries stays after a reset. |

Without `--reset`, a Patient who already has seeded history is refused. With it, the documents with these markers are deleted and the history written again; nothing else is deleted. `npm run seed` never touches this Patient (it deletes only `synthetic == true`).


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
| `checkIns` | read; create with no ratings, no Voice cues, `crisis: false` and null `assessment` and `previousTried`, stamped as now; update `startedAtMillis` and `endedAtMillis` only; delete | read documents stamped `true` | no | no |
| `suggestions` | read; create with no Outcome (`outcomeCheckInId` `null` or absent), stamped as now; update `status` and `booked` only; delete | read documents stamped `true` | no | no |
| `summaries` | read | read documents stamped `true` | no | no |
| `flags` | read; create uncleared flags stamped as now; no change or delete | read documents stamped `true`; set `clearedAtMillis` only, on those | no | no |
| `visits` | read | read, create, update, delete | no | no |
| `digests` | read | read documents stamped `true` | no | no |
| `mail` | no | no | no | no |
| `clinicians` | no | no | no | no |

Anything not listed, including a collection outside this schema, is denied. Field owners: `displayName`, `tmsEndDate` and clearing flags belong to the Clinician; `intakeHighlights`, Summaries, a Check-in's ratings, Voice cues, crisis marker, `assessment` and `previousTried`, and a Suggestion's Outcome are written by functions only, so what reaches the Clinician is recorded by the app and functions, not edited by hand; `synthetic` and `clinicianEmail` never change after creation from a client; `sharedWithClinician` never changes after creation.

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
