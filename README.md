# Depressify

A wellbeing companion for the time between Visits: a Kotlin Multiplatform Patient app (Android and iOS), a Firebase backend, and a plain web Clinician dashboard. The design is in [docs/context/system-design.md](docs/context/system-design.md), terms are in [GLOSSARY.md](GLOSSARY.md), and the Firestore data contract is in [docs/firestore-schema.md](docs/firestore-schema.md).

## Layout

| Path | What it is |
|---|---|
| `core/` | Pure Kotlin Multiplatform common code (JVM, iOS): the rules the Patient screens use and, in `core/model`, the Firestore data contract. No platform code. |
| `shared/` | Kotlin Multiplatform client code: the Compose Multiplatform Patient UI, its view model, and Firebase through the GitLive SDK (`shared/data`). |
| `androidApp/` | Android application entry point. |
| `iosApp/` | XcodeGen spec (`project.yml`) and Swift glue. |
| `design/` | The Patient and Clinician design prototypes and the screen deck. |
| `firebase/` | `firebase.json`, Firestore rules, `functions/` (TypeScript, vitest), `hosting/` (the dashboard) and `seed/` (the Demo Patients). |
| `fixtures/` | Fixtures shared by Kotlin and Node tests, such as the Baseline cases. |
| `gradle/libs.versions.toml` | The only place library versions are pinned. |

## Setup

- JDK 21, the Android SDK (platform 37, build tools 36), Node 22 or newer, the Firebase CLI 15 or newer, and XcodeGen for iOS.
- Create `local.properties` at the repository root with `sdk.dir=/path/to/Android/sdk` (gitignored).
- Use `./gradlew` for everything Gradle.

### Firebase configuration

There is no `google-services.json` and no Google Services plugin. The Android app initialises Firebase in code (`DepressifyApplication`) from `BuildConfig` fields set in `androidApp/build.gradle.kts`:

- **By default** it uses the emulator-only project `demo-twoam`, which needs no credentials, and debug builds talk to the local emulators on `127.0.0.1`. On a phone or an Android emulator, forward the ports first:
  ```sh
  adb reverse tcp:9099 tcp:9099 && adb reverse tcp:8080 tcp:8080 && adb reverse tcp:5001 tcp:5001
  ```
- **For a real project**, register an Android app in the Firebase console with the package name `app.depressify.patient` (the `applicationId` in `androidApp/build.gradle.kts`), then copy `secrets.properties.example` to a gitignored `secrets.properties` at the repository root:
  ```properties
  firebase.projectId=your-project
  firebase.applicationId=1:1234567890:android:abcdef
  firebase.apiKey=AIza...
  # Leave empty to stop using the emulators in debug builds
  firebase.emulatorHost=
  # The Clinician a new Patient is linked to (must be allowed, see below)
  demo.clinicianEmail=<clinician-email>
  ```

iOS reads `iosApp/Depressify/GoogleService-Info.plist` (gitignored) when it exists, and otherwise uses `demo-twoam` and the emulators. Register the iOS app with the bundle ID `app.depressify.patient` (`PRODUCT_BUNDLE_IDENTIFIER` in `iosApp/project.yml`), and run `xcodegen generate` again after adding the file. The app is called Depressify on both platforms. The dashboard uses the emulators when served from `localhost`, and the deployed project's `/__/firebase/init.json` otherwise.

### The Clinician's email

The repository is public, so the Clinician's email is configuration, never code. The app links every new Patient to it, and the security rules accept the link only if the email has a document in the `clinicians` allowlist in Firestore, which only the Admin SDK writes.

| Where | Setting | Without it |
|---|---|---|
| Android app | `demo.clinicianEmail` in `secrets.properties` (becomes `BuildConfig.CLINICIAN_EMAIL`) | `clinician@example.com` for the `demo-twoam` emulator project; with a real `firebase.projectId` the build fails |
| iOS app | `ClinicianEmail` (string) in a gitignored `iosApp/Depressify/Secrets.plist` | `clinician@example.com` with the emulators; with `GoogleService-Info.plist` the app stops at launch |
| Allowlist | `npm run allow-clinician -- --email <clinician-email> [--project <project-id>]` in `firebase/seed` | a new Patient cannot create their record |
| Seed | `--clinician <clinician-email>` or `CLINICIAN_EMAIL` (the option wins); the seed also allows that email | `clinician@example.com` in the emulator; a real project (`--project`) refuses to seed |

Emails are stored trimmed and in lower case, as Firebase Auth puts them in the sign-in token. A minimal `Secrets.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ClinicianEmail</key>
	<string>clinician-email-here</string>
</dict>
</plist>
```

## Build

```sh
./gradlew :androidApp:assembleDebug        # Android APK
./gradlew :androidApp:installDebug         # install on a connected phone
```

iOS: run `cd iosApp && xcodegen generate`, open `iosApp/Depressify.xcodeproj` in Xcode and run. The build phase calls `./gradlew :shared:embedAndSignAppleFrameworkForXcode`; Xcode resolves the Firebase iOS SDK through Swift Package Manager.

The Patient app runs on local demo data until Firebase answers. With a backend it signs in anonymously, creates the Patient record and saves the sharing choice; when the backend cannot be reached it stays on demo data.

## Tests, one command per seam

| Seam | Command |
|---|---|
| 1. `core` JVM tests (the Patient screen rules and the data contract) | `./gradlew :core:jvmTest` |
| 2. Cloud Functions (vitest, plus a type check) | `cd firebase/functions && npm install && npm test` |
| 3. Dashboard helpers (Node test runner) | `cd firebase/hosting && node --test` |
| 3. Seed generator and Baseline fixture (Node test runner, plus a type check) | `cd firebase/seed && npm install && npm test` |
| 4. `shared` common tests (the session and the view model's backend wiring, with fakes) | `./gradlew :shared:testAndroidHostTest` |

`./gradlew :core:jvmTest` also regenerates `firebase/functions/test/fixtures/contract.json`, which the functions tests compare with the TypeScript and dashboard mirrors. Commit that file when it changes.

Security rules and the end-to-end flow run against the emulators:

```sh
cd firebase
npm --prefix functions run build
firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"
firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix seed run test:emulator"
```

With the Functions emulator as well (`--only auth,firestore,functions`, after `npm run build` in `firebase/functions`), the suites also call the deployed callables and check that the `redFlagAlert` trigger writes its email, including for the silence check's flag after the silence test. The first such run writes `firebase/functions/.env.local` with an empty `DASHBOARD_URL` (gitignored).

The rules are described, with a who-can-do-what table, in [`docs/firestore-schema.md`](docs/firestore-schema.md#security-rules).

## Set up a real Firebase project

The Firestore database and every function are in `europe-north1` (Finland), except the scheduled `weeklyDigest` and `silenceCheck`, which run in `europe-west1` because Cloud Scheduler has no `europe-north1` location. The functions' regions are `REGION` and `SCHEDULER_REGION` in `firebase/functions/src/region.ts`, and the dashboard's copy of `REGION` is checked against it. Real IDs, keys and the Clinician's email go only into gitignored files (`secrets.properties`, `GoogleService-Info.plist`, `Secrets.plist`) or into Firestore, never into a commit. Deploying functions needs the Blaze plan.

1. **Sign in and add the project under an alias.** `.firebaserc` keeps `demo-twoam` as the default so that local runs and tests never reach a real project, so name the real one explicitly every time:
   ```sh
   firebase login
   cd firebase
   firebase use --add        # pick the project, alias it "prod"
   firebase use default      # back to demo-twoam for local work
   ```
   `firebase use --add` writes the alias into `.firebaserc`. A project ID is not a secret, but leave that change out of commits unless the team wants it.
2. **In the Firebase console:** enable the Anonymous and Email/Password sign-in providers, add the Clinician as a user (Authentication, Users, Add user), and register the apps: Android package name `app.depressify.patient`, iOS bundle ID `app.depressify.patient`. Put the apps' values in `secrets.properties` (with `demo.clinicianEmail`) and `iosApp/Depressify/GoogleService-Info.plist` plus `Secrets.plist`, as above.
3. **Deploy the rules and indexes.** Run the rules tests first. The dashboard's latest-Digest query needs the composite index in `firestore.indexes.json` (the emulator does not check indexes). Before real Patients use it, require `email_verified` in `authEmail()` in `firestore.rules` (see the comment there).
   ```sh
   firebase deploy --only firestore:rules,firestore:indexes --project prod
   ```
4. **Allow the Clinician.** The seed commands use the Admin SDK with Application Default Credentials and take the project ID, not the alias:
   ```sh
   gcloud auth application-default login
   cd seed && npm install
   npm run allow-clinician -- --email <clinician-email> --project <your-project-id>
   ```
5. **Seed the Demo Patients** (optional; they are readable by any signed-in user, by design of the demo):
   ```sh
   npm run seed -- --project <your-project-id> --clinician <clinician-email>
   ```
6. **Set the Gemini key** for Intake and the Digest (it prompts for the value). The key must belong to a paid-tier project, and AI Studio logging should be off for it; see [API keys](#api-keys):
   ```sh
   cd .. && firebase functions:secrets:set GEMINI_API_KEY --project prod
   ```
7. **Deploy the functions** (the predeploy step builds them):
   ```sh
   firebase deploy --only functions --project prod
   ```

8. **The red flag email (needs a person with SMTP credentials).** `redFlagAlert` deploys with the functions in step 7 and writes emails to the `mail` collection, but nothing is sent until the Firebase **Trigger Email** extension is installed. It needs an SMTP account, which only a person can provide. See [Red flag email](#red-flag-email) for the steps.

The dashboard can then be deployed with `firebase deploy --only hosting --project prod`.

## API keys

Where each key or credential lives, following [ADR 0002](docs/adr/0002-phone-connects-directly-to-gemini-live.md) and the [Gemini](docs/research/gemini-api.md) and [Maps](docs/research/google-maps-platform.md) research notes. The Gemini and Maps keys never reach the phone or the repository.

| Credential | Where it goes | Used by | State |
|---|---|---|---|
| `GEMINI_API_KEY` | Function secret: `firebase functions:secrets:set GEMINI_API_KEY --project prod`. Locally: `firebase/functions/.secret.local` (copy `.secret.local.example`). | Interactions API (`gemini-4-hydrogen`, `store: false`) for Intake and the Digest, and Start Check-in, which mints the single-use Gemini Live token (`gemini-3.8-live`) the phone connects with. Later, Decisions. | Wired; no real call made from this repository yet |
| `MAPS_API_KEY` | Function secret, same two places. Enable `mapstools.googleapis.com` and restrict the key to it. | Maps agent tools (`lookupWeather`, `searchText`, `computeRoutes`) from the Map tool function. | Name reserved; the function is not built (#18) |
| Google Calendar | No key. The Patient grants access on the phone. | Free time and booking, on the phone. | Not built (#19) |
| Firebase app config | `secrets.properties` (Android), `GoogleService-Info.plist` (iOS). These identify the project and are not secrets, but stay out of the repository. | The Patient app. | Wired |

Before the first real Gemini call:

- Use a paid-tier Gemini project. The terms require it for users in the EEA, and paid-tier prompts are not used for training.
- Turn off AI Studio logging for that project. It is on by default for Interactions calls.
- The SDK calls `/v1/interactions`. Live tokens (`/v1beta/auth_tokens`) and Decisions (`/v1beta/decisions`) exist only on `v1beta`, so those calls must set the API version when they are added.
## The spoken Check-in

A Check-in is a Gemini Live session the phone opens itself (ADR 0002):

1. The app calls `startCheckIn {patientId}`. The function mints a single-use token locked to `gemini-3.8-live`, the Companion's instruction (with the Intake highlights) and its tools.
2. The app opens the Live WebSocket with the token (`KtorLiveClient`), streams the microphone at 16 kHz and plays the Companion's speech at 24 kHz. Typing uses the same connection.
3. The Companion's tool calls run on the phone (`CompanionTools`): it reads the Patient's background, recent daily Signals against their Baseline, recent Summaries and the last Suggestion from Firestore, records the Suggestion it offers, and can show a music or Google Maps search card. Each call shows on screen as a short status line and, where there is something to show, a card.
4. A lost connection offers a retry and keeps what was said. Without a signed-in Patient the app plays the scripted demo instead.

To give the Companion history to draw on, seed the Demo Patients and set `demo.patientId` in `secrets.properties` (Android) or `DemoPatientId` in `Secrets.plist` (iOS) to `demo-steady`, `demo-declining` or `demo-sparse`. Locally, put `GEMINI_API_KEY` in `firebase/functions/.secret.local` and restart the emulators.

Not built yet: Finish Check-in (the Summary, ratings and flag from the transcript), weather, place results and walking routes from the Maps agent tools, and calendar booking. The place card only opens a Google Maps search.

## Run the walking skeleton locally

```sh
cd firebase/functions && npm install && npm run build && cd ..
firebase emulators:start --project demo-twoam
```

This starts Auth (9099), Firestore (8080), Functions (5001), Hosting (5002) and the Emulator UI (4000). Then:

1. Create the Clinician in the Auth emulator and allow them. `<clinician-email>` is the app's configured email: `clinician@example.com` unless `demo.clinicianEmail` is set.
   ```sh
   curl -s -X POST 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key' \
     -H 'Content-Type: application/json' \
     -d '{"email":"<clinician-email>","password":"demo-password-1","returnSecureToken":true}'
   cd seed && npm install && npm run allow-clinician -- --email <clinician-email>
   ```
   (`npm run seed` allows its Clinician too.)
2. Open http://localhost:5002 and sign in as that Clinician. The Patient list is empty.
3. Run the Android debug build (after `adb reverse`, above). The app signs in anonymously and creates the Patient record, then shows the welcome and the sharing choice. Choose **Share my progress**: the app lands on Today and "Live patient" appears on the dashboard without a reload. **Continue without sharing** also lands on Today, and the Patient stays off the dashboard (the security rules allow the Clinician to see a Patient only while sharing is granted). Stopping in Settings → Sharing & privacy removes them from the open dashboard at once. Sharing again shows what is saved from then on and what was shared before, never what was saved in between: every shared record is stamped `sharedWithClinician` when it is saved (see [the sharing stamp](docs/firestore-schema.md#the-sharing-stamp)).

Use only the `demo-twoam` project with the emulators. Do not run `firebase deploy` against it.

### Patient page

A Patient's page (`#/patient/{id}`) has four sections: **Overview** (the Attention flag level and reasons, then the Phase timeline), **Summaries**, **Signals**, and **Intake and Visits**. A menu at the top moves to each section. `firebase/hosting/js/views/patient.js` lists the slots each section has and what a block mounted into one receives.

- **Phase timeline.** Week 1 starts the day after TMS ended. Phases run from the end of TMS to the first Visit, Visit to Visit, and the last Visit to today. The weekly Mood rating (1 to 5, gaps where there is none) and each Questionnaire kind have their own lanes on one axis; "Show the timeline as a table" gives the same data as a table. Without a TMS end date the timeline uses calendar weeks and asks for the date. The arithmetic is in `js/lib/timeline.js`.
- **Visits.** Under Intake and Visits the Clinician sets the TMS end date and records or edits a Visit with an optional PHQ-2 (0 to 6) or PHQ-9 (0 to 27) score. The date cannot be in the future. Both are written straight to Firestore within the rules; a Visit never changes an Attention flag. A failed save keeps what was typed.
- **Signals.** A Phase selector (the current Phase by default, or all days) and one trend for each of the nine Signals against the Patient's own Baseline, with its unit, date range, number of days with a value and whether the data is synthetic or from the device. A missing day is a gap, never zero; fewer than 5 valid days shows "insufficient Baseline" instead of a comparison. A Signal without Consent shows nothing but that; there are also no-data and stale states (latest value more than 2 days old). Each chart has a table with the same data. The comparison stored on the daily record is used; the Baseline line is computed with `js/lib/baseline.js`, the one JavaScript copy of the rule (the seed re-exports it) and pinned by the shared fixture. The arithmetic is in `js/lib/signals.js`.
- **Summaries.** Every Summary, newest first; the selected one shows the ratings, sleep line, themes, the Suggestion, the previous Outcome, Voice cues as observations and at most three quotes. The latest also appears on the Overview. There is no transcript or audio. Helpers: `js/lib/summaries.js`.
- **What seems to help.** On the Overview: each kind of Suggestion answered about in the last 28 days, how many times, and how the Patient said it felt (counts of "felt better", "about the same" and so on). Only Suggestions with an Outcome score count; kinds are ordered by mean Outcome score, then count, but no score or percentage is shown. Helpers: `js/lib/what-helps.js`.
- **Copy.** `test/copy.test.mjs` fails if `index.html` or anything under `js/` contains "diagnosis", "treatment" or "risk score".

### Intake

On the dashboard, open a Patient from the list (`#/patient/{id}`) to reach the Intake section. The Clinician pastes the clinical report, reviews and edits the extracted highlights (at most 120 words) and saves them. Two callables do the work, both for the Patient's Clinician only:

| Callable | Request | Response |
|---|---|---|
| `extractIntake` | `{patientId, reportText}` | `{highlights, wordCount, trimmed}`; writes nothing |
| `saveIntake` | `{patientId, highlights}` | `{intakeHighlights, wordCount}`; writes `patients/{patientId}.intakeHighlights` only |

`extractIntake` calls the text model with storage off and needs the `GEMINI_API_KEY` function secret (`firebase functions:secrets:set GEMINI_API_KEY` on a real project). The emulator has no secret, so extraction there fails with a retry and nothing is sent to Gemini. To try a real extraction locally, put `GEMINI_API_KEY=...` in `firebase/functions/.secret.local` (gitignored); the pasted text then goes to Gemini with storage off, so paste only fictional reports. The report is never stored or logged.

The emulator tests also call the Intake callables through the Functions emulator when it is running:

```sh
cd firebase/functions && npm run build && cd ..
firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"
```

The fictional Intake for the live demo Patient is in [docs/demo/intake-live-patient.md](docs/demo/intake-live-patient.md).

### Attention work queue

The Patient list shows a red banner for every uncleared red flag of the Clinician's Patients, with one reason and a "Review Patient" link. It stays until the flag is cleared; search by name and the level filter never hide it. A red flag that arrives while the dashboard is open is announced, and plays a short chime (WebAudio, no file) only after the Clinician turns on "Sound for red flags" in the header; the choice is kept in this browser.

On the Patient page, the Attention section lists open flags (level word, reason, source, raised time) and the cleared history. "Clear after follow-up" clears one flag in a transaction: it sets the flag's `clearedAtMillis` and resets the Patient's `flagLevel` and `flagReasons` to the flags still open, or green. If anything new was raised since the dialog opened, it asks for a new review instead. The logic is in `firebase/hosting/js/lib/{banner,list-filter,sound-pref,flag-detail,clear}.js`; `firebase/seed/test/emulator/attention.test.js` runs the clearing helper as the Clinician under the rules.
### Weekly Digest

The Patient page shows the latest weekly Digest: the dates it covers, how many Summaries it drew on, when it was generated, and a short account written from that week's Summaries and Signals. Two functions write it to `patients/{id}/digests/{isoWeek}` (for example `2026-W46`):

| Function | Trigger | Covers |
|---|---|---|
| `weeklyDigest` | Mondays 07:00 Europe/Helsinki | The previous ISO week, Monday to Sunday, for every Patient who is sharing |
| `generateDigest` | "Generate now" on the dashboard, Clinician only: `{patientId}` → `{digest}` | The current ISO week from Monday to today; pressing it again overwrites that week |

Both call the text model with storage off and need the `GEMINI_API_KEY` secret. A week with no Check-ins is written from fixed copy without calling the model, so it works in the emulator; a week with Check-ins fails there with a retry, and nothing is sent to Gemini. Patients who are not sharing get no Digest. The scheduled job does not run in the emulator (it needs Pub/Sub); the emulator tests run its handler against Firestore with a fake model instead. Week semantics are in [`docs/firestore-schema.md`](docs/firestore-schema.md#digestsisoweek-digest).

### Red flag email

When a red flag is created (`patients/{id}/flags/{flagId}`), the `redFlagAlert` function writes one email for the Patient's Clinician to the top-level `mail` collection. The Firebase Trigger Email extension then sends it. Every red flag is covered, whoever raises it: the phone's crisis tool, Finish Check-in's backstop, the phone's daily job, and the hourly silence check (#28). They only have to create the flag.

| Sent when | Not sent when |
|---|---|
| The flag is red, uncleared and stamped `sharedWithClinician: true`; the Patient's `sharingConsent` is `granted` now; the Patient is not a Demo Patient; `clinicianEmail` is an address | Amber or green; already cleared; stamped `false`; the Patient declined or withdrew sharing; `synthetic: true` (the seed recreates the Demo Patients' red flags on every run); no Clinician address |

- **Subject:** `[CRISIS] Red flag for <name>: crisis in a Check-in`, or `[RED] Red flag for <name>: quiet phone` (or `sleep collapse`, `inactive`).
- **Body:** the flag's reason, a fixed line for the kind, the time in Helsinki and a link to the Patient's dashboard page. It never includes a transcript, quote, Summary or Intake.
- **Sent once per flag:** the mail document id is derived from the Patient and flag ids and written with `create()`, so a retried trigger never sends a second email.
- **Logs:** ids, the kind and the outcome only.
- **The link:** uses the `DASHBOARD_URL` parameter, which is not a secret. When it is empty (the default), the link goes to `https://<project-id>.web.app`. To set it, add `DASHBOARD_URL=https://...` to `firebase/functions/.env.<project-id>` (gitignored) before deploying, or answer the deploy prompt.

The logic is in `firebase/functions/src/alerts.ts` (pure, `alertDecision`/`alertFor`) and `src/alertFunctions.ts` (the trigger).

**Installing the Trigger Email extension (needs a person).** Nobody has installed it yet. You need:

- an SMTP account that may send from your address, for example a Gmail app password, SendGrid, Mailgun or your organisation's relay;
- its connection URI, for example `smtps://<username>@smtp.example.com:465`;
- its password;
- the From address, for example `Depressify <alerts@your-domain>`.

None of these go into a commit.

```sh
cd firebase
firebase ext:install firebase/firestore-send-email --project prod
```

Answer the prompts:

| Prompt | Answer |
|---|---|
| Cloud Functions location | `europe-north1`, the database's region. If it isn't offered, pick the nearest EU region offered, and check the extension's docs that it still triggers on a database in `europe-north1`. |
| Firestore instance ID / location | `(default)` / `europe-north1` |
| Authentication type | Username and password |
| SMTP connection URI | Your provider's URI, without the password |
| SMTP password | Your provider's password. The extension stores it in Secret Manager. |
| Email documents collection | `mail` |
| Default FROM address | Your From address |
| Default reply-to, users and templates collections, TTL | Leave empty, or keep the defaults |

`ext:install` records the extension in `firebase.json` and writes `firebase/extensions/firestore-send-email.env`. That file can hold your SMTP username and is gitignored, so keep it out of commits. Then deploy:

```sh
firebase deploy --only extensions --project prod
firebase deploy --only functions:redFlagAlert --project prod   # if the functions were deployed before this function existed
```

On the first deploy of a Firestore trigger, Google Cloud may report that Eventarc permissions are still propagating. If it does, wait a few minutes and deploy again.

**To check it end to end:**

1. On a live, sharing Patient (`synthetic: false`) linked to your Clinician, create a red flag, for example with the app's crisis phrase.
2. Watch the `mail` document get a `delivery.state` of `SUCCESS` (the extension writes `delivery` back).
3. Confirm the email arrives.

### Silence check

A phone cannot report its own silence, so `silenceCheck` watches for it. It runs at the top of every hour (Europe/Helsinki) in `europe-west1`, because Cloud Scheduler has no `europe-north1` location. It raises a red `silent` flag for each Patient whose phone has shown no sign of life (`lastSeenAtMillis`) for over 24 hours. `redFlagAlert` then emails the Clinician and the dashboard shows the banner, as for any red flag. Nothing reaches the Patient's phone.

| Raised for | Skipped |
|---|---|
| A Patient who is sharing, is not synthetic, and was last seen more than 24 hours ago | Seen 24 hours ago or less (exactly 24 hours is not silent); never seen (`null`); last seen "in the future" (a clock ahead); not sharing; a Demo Patient (`synthetic: true`); a `silent` flag still open; this silence already flagged, even if the Clinician cleared it |

- **The flag:** `patients/{id}/flags/silent-<lastSeenAtMillis>`, red, stamped `sharedWithClinician: true`. The reason is "The phone has been quiet: it has not connected for over 24 hours." It says nothing about mood or self-harm. The email adds that a quiet phone is not by itself a sign of self-harm.
- **One flag per silence:** the id comes from the last sign of life, so every run during the same silence finds it, and a retried run never writes a second one. The flag and the Patient's raised `flagLevel` and `flagReasons` are written in one transaction, after the record is read again.
- **Logs:** Patient and flag ids and counts only.
- **In the emulator** the scheduled trigger does not run (it needs Cloud Scheduler and Pub/Sub). The emulator tests run its handler against Firestore, and with the Functions emulator they check that `redFlagAlert` writes exactly one email for the flag.

The logic is in `firebase/functions/src/silence.ts` (pure: `silenceDecision`, `silencePlan`) and `src/silenceFunctions.ts` (the scheduled function and its Firestore transaction).

**Silence test (demo).** To make the next check raise red for one live Patient, set that Patient's last sign of life to 25 hours ago:

```sh
cd firebase/seed
npm run silence-test -- --patient <patient-id>                            # emulator
npm run silence-test -- --patient <patient-id> --project <your-project-id> # a real project
```

The Patient id is the phone's auth uid; it is also in the dashboard's address bar (`#/patient/<id>`). The command changes only `lastSeenAtMillis`. It refuses a Demo Patient (synthetic Patients are never silent) and a Patient who isn't sharing, because the check would skip them. To run the deployed check now instead of waiting for the top of the hour, force-run its Cloud Scheduler job (the command prints it):

```sh
gcloud scheduler jobs run firebase-schedule-silenceCheck-europe-west1 --location=europe-west1 --project=<your-project-id>
```

The phone's daily job writes a new sign of life when it runs, which ends the silence, so run the check soon after the command. There is no callable or HTTP way to start the check: only someone with the project's credentials can run it early.

## Demo Patients

One command deletes every Demo Patient (Patients marked `synthetic`) and creates the three again, with six weeks of invented history ending today (Europe/Helsinki). With the emulators running:

```sh
cd firebase/seed && npm install
npm run seed                                  # emulator at $FIRESTORE_EMULATOR_HOST or 127.0.0.1:8080
npm run seed -- --today 2026-11-14            # a fixed day, for a rehearsal
npm run seed -- --clinician <clinician-email> # link them to another Clinician (or set CLINICIAN_EMAIL)
npm run seed -- --project <your-project-id> --clinician <clinician-email>
                                              # a real project (Application Default Credentials)
```

The Demo Patients are linked to the Clinician from `--clinician` or `CLINICIAN_EMAIL`, and the seed adds that Clinician to the `clinicians` allowlist. Only the emulator falls back to `clinician@example.com`; a real project must be given the email, and the placeholder is refused there. The same inputs (`--today`, `--seed`, the Clinician) give the same data. The Clinician sees `demo-declining` (red), `demo-sparse` (amber) and `demo-steady` (green), in that order. `demo-steady` stopped sharing for three days about four weeks ago, so its Signals and Summaries show a gap there: what was saved while not sharing stays hidden from the Clinician. Live Patients are never touched. Needs Node 22 or newer.
