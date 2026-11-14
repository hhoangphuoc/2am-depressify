# Depressify

A wellbeing companion for the time between Visits: a Kotlin Multiplatform Patient app (Android and iOS), a Firebase backend, and a plain web Clinician dashboard. The design is in [docs/context/system-design.md](docs/context/system-design.md), terms are in [GLOSSARY.md](GLOSSARY.md), and the Firestore data contract is in [docs/firestore-schema.md](docs/firestore-schema.md).

## Layout

| Path | What it is |
|---|---|
| `core/` | Pure Kotlin Multiplatform common code (JVM, iOS): the rules the Patient screens and the phone's daily job use (`core/daily`) and, in `core/model`, the Firestore data contract. No platform code. |
| `shared/` | Kotlin Multiplatform client code: the Compose Multiplatform Patient UI, its view model, and Firebase through the GitLive SDK (`shared/data`). |
| `androidApp/` | Android application entry point. |
| `iosApp/` | XcodeGen spec (`project.yml`) and Swift glue. |
| `design/` | The Patient and Clinician design prototypes and the screen deck. |
| `firebase/` | `firebase.json`, Firestore rules, `functions/` (TypeScript, vitest), `hosting/` (the dashboard) and `seed/` (the Demo Patients and the live demo Patient's seeded history). |
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
| Allowlist and Clinician role | `npm run allow-clinician -- --email <clinician-email> [--uid <uid>] [--project <project-id>]` in `firebase/seed`. Also gives the Clinician's sign-in account the `role: "clinician"` claim and a verified email ([ADR 0010](docs/adr/0010-patients-sign-in-with-their-own-account.md)); an account not yet verified needs `--uid` | a new Patient cannot create their record, and the Clinician's account reads nothing |
| Seed | `--clinician <clinician-email>` or `CLINICIAN_EMAIL` (the option wins); the seed also allows that email | `clinician@example.com` in the emulator; a real project (`--project`) refuses to seed |
| Live demo Patient | `--clinician <clinician-email>` or `CLINICIAN_EMAIL`; it must already be allowed (a warning if not) | `clinician@example.com` in the emulator; a real project refuses to seed |

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

## Patient sign-in

Patients sign in with an account of their own, email and password or Google, instead of anonymously ([ADR 0010](docs/adr/0010-patients-sign-in-with-their-own-account.md)). The backend half is built; the app's `PatientSession` still signs in anonymously. This is the contract for the app team.

**What the backend accepts.** A *verified account* is one whose ID token has `firebase.sign_in_provider` other than `anonymous` and `email_verified: true`. Google accounts are verified at once; email and password accounts once the Patient opens the verification link and the app refreshes the ID token.

| Action | Needs |
|---|---|
| Create `patients/{uid}` | A verified account whose uid is the document id, linked to an allowlisted Clinician (as before) |
| Read and write an existing `patients/{uid}` and its collections | The owner (`auth.uid == patientId`), whatever the account, so Patients who signed in anonymously before keep their records |
| `startCheckIn`, `finishCheckIn`, `suggestToday`, `mapTool`, `generateMusic`, `generateMusicCover` | A verified account. Otherwise `failed-precondition` with "Verify your account to continue." |
| Act as a Demo Patient (`demo.patientId`) | A verified account. An anonymous one reads nothing |

**Flow**, with the GitLive SDK the app already uses (`dev.gitlive.firebase.auth`):

1. **Sign up:** `Firebase.auth.createUserWithEmailAndPassword(email, password)`, then `user.sendEmailVerification()`.
2. **"Verify your email" gate:** show the address, a "Resend" button (`sendEmailVerification()` again) and "I've verified it", which calls `user.reload()` and then `user.getIdToken(forceRefresh = true)` and goes on only when `user.isEmailVerified` is true. The refresh matters: without it the token keeps `email_verified: false` for up to an hour and the record is refused.
3. **Sign in:** `signInWithEmailAndPassword(email, password)`; an account that is still unverified goes to the gate. Show one message for a wrong password and an unknown email.
4. **Google:**
   - Android: Credential Manager (`androidx.credentials` with `com.google.android.libraries.identity.googleid`), `GetSignInWithGoogleOption` or `GetGoogleIdOption` with `setServerClientId(<web client id>)`. The web client id is the OAuth client Firebase creates when the Google provider is enabled (client type 3 in a downloaded `google-services.json`; this app has no Google Services plugin, so put it in `secrets.properties` next to the other Firebase values). Pass the returned ID token to `Firebase.auth.signInWithCredential(GoogleAuthProvider.credential(idToken, null))`. Google sign-in needs the build's SHA-1 on `app.depressify.patient`; the main development Mac's debug key is registered, every other machine adds its own.
   - iOS: the GoogleSignIn SDK with `CLIENT_ID` from `GoogleService-Info.plist` (download it again after enabling Google so it has `CLIENT_ID` and `REVERSED_CLIENT_ID`), and `REVERSED_CLIENT_ID` added as a URL scheme (`CFBundleURLTypes`) in `iosApp/project.yml`. Then the same `signInWithCredential`.
5. **Password reset:** `Firebase.auth.sendPasswordResetEmail(email)`, with the same confirmation whether or not the address has an account.
6. **Sign out:** `Firebase.auth.signOut()`. The Patient record stays and comes back at the next sign-in.

**How `PatientSession` changes:**
- `start()` no longer calls `signInAnonymously()`. With nobody signed in, or an unverified account, it reports that (for the sign-in screen or the gate) instead of failing like a lost connection.
- It still reads `patients/{uid}` first. An existing record is used as it is, whatever the account.
- It creates the record only after verification and the forced token refresh above.
- `AuthGateway` loses `signInAnonymously()` and gains sign-up, sign-in, Google, `sendEmailVerification`, a reload-and-refresh, `isEmailVerified` and password reset; `currentUserId()` stays.
- The Check-in screens show the gate on `failed-precondition` from `startCheckIn` or `finishCheckIn`, not a generic error.

**Optional: keeping an anonymous Patient's record.** If `Firebase.auth.currentUser?.isAnonymous` is true, link instead of signing in: `currentUser.linkWithCredential(EmailAuthProvider.credential(email, password))` and then `sendEmailVerification()`, or `linkWithCredential(GoogleAuthProvider.credential(idToken, null))`. The uid stays, so `patients/{uid}` and its history stay. If the email or Google account already has a Firebase user, linking fails (`credential-already-in-use` or `email-already-in-use`); sign in to that account instead, and the anonymous record is left behind.

**Console steps (a person with access to the project):**
1. Authentication → Sign-in method → **Google** → Enable, with a support email. Download `google-services.json` and `GoogleService-Info.plist` again for the client ids.
2. **Email/Password** stays enabled. Optionally, Authentication → Settings → User actions → **Email enumeration protection** on, so sign-in and password reset don't reveal which emails have accounts.
3. Before deploying the new rules or functions: run `npm run allow-clinician -- --email <clinician-email> --project <project-id>` for every Clinician, or the dashboard, Intake and the Digest lose access (they now need the claim), and ship the app's new sign-in, or new Patients cannot create their record, the demo phone's Demo Patient reads nothing, and no Check-in starts or finishes (`startCheckIn` and `finishCheckIn` refuse anonymous accounts).
4. Later, once every tester has upgraded or signed up: **Anonymous** → Disable. That stops new anonymous sign-ins; records already made stay their owners'.

## Build

```sh
./gradlew :androidApp:assembleDebug        # Android APK
./gradlew :androidApp:installDebug         # install on a connected phone
```

iOS: run `cd iosApp && xcodegen generate`, open `iosApp/Depressify.xcodeproj` in Xcode and run. The build phase calls `./gradlew :shared:embedAndSignAppleFrameworkForXcode`; Xcode resolves the Firebase iOS SDK through Swift Package Manager.

The Patient app runs on local demo data until Firebase answers. With a backend it signs in anonymously, creates the Patient record and saves the sharing choice; when the backend cannot be reached it stays on demo data. Patients are moving to accounts of their own ([ADR 0010](docs/adr/0010-patients-sign-in-with-their-own-account.md)): the rules on this branch refuse a new anonymous Patient record, so until the app follows the [Patient sign-in](#patient-sign-in) contract a fresh install stays on demo data against them.

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
2. **In the Firebase console:** enable the Email/Password and Google sign-in providers (and Anonymous only until the app ships [Patient sign-in](#patient-sign-in)), add the Clinician as a user (Authentication, Users, Add user), and register the apps: Android package name `app.depressify.patient`, iOS bundle ID `app.depressify.patient`. Put the apps' values in `secrets.properties` (with `demo.clinicianEmail`) and `iosApp/Depressify/GoogleService-Info.plist` plus `Secrets.plist`, as above.
3. **Deploy the rules and indexes.** Run the rules tests first. The dashboard's latest-Digest query needs the composite index in `firestore.indexes.json` (the emulator does not check indexes). The rules require verified accounts and the Clinician claim (ADR 0010), so run step 4 first.
   ```sh
   firebase deploy --only firestore:rules,firestore:indexes --project prod
   ```
4. **Allow the Clinician.** This adds the email to the allowlist and gives the Clinician's account (added in step 2) the `role: "clinician"` claim and a verified email; without an account it says so and writes only the allowlist, so run it again after adding the user. An account added in the console starts unverified, and anyone could have signed up with that address first, so pass its User UID from Authentication → Users with `--uid`; a verified account (the Clinician opened the verification link, or signs in with Google) needs none. The Clinician signs out and in again, or reloads the dashboard, to pick up the claim. The seed commands use the Admin SDK with Application Default Credentials and take the project ID, not the alias:
   ```sh
   gcloud auth application-default login
   cd seed && npm install
   npm run allow-clinician -- --email <clinician-email> --uid <user-uid> --project <your-project-id>
   ```
5. **Seed the Demo Patients** (optional; they are readable by any verified account, by design of the demo):
   ```sh
   npm run seed -- --project <your-project-id> --clinician <clinician-email>
   ```
6. **Set the Gemini key** for Intake and the Digest (it prompts for the value). The key must belong to a paid-tier project, and AI Studio logging should be off for it; see [API keys](#api-keys):
   ```sh
   cd .. && firebase functions:secrets:set GEMINI_API_KEY --project prod
   ```
7. **Deploy the functions** (the predeploy step builds them). The Patient's callables (`startCheckIn`, `finishCheckIn`, `suggestToday`, `mapTool`, `generateMusic`, `generateMusicCover`) refuse anonymous accounts (ADR 0010), and the app still signs in anonymously, so until the app ships the [Patient sign-in](#patient-sign-in) deploy the other functions by name (`--only functions:<name>`) and leave those as they are:
   ```sh
   firebase deploy --only functions --project prod
   ```

8. **The red flag email (needs a person with SMTP credentials).** `redFlagAlert` deploys with the functions in step 7 and writes emails to the `mail` collection, but nothing is sent until the Firebase **Trigger Email** extension is installed. It needs an SMTP account, which only a person can provide. See [Red flag email](#red-flag-email) for the steps.

The dashboard can then be deployed with `firebase deploy --only hosting --project prod`.

## API keys

Where each key or credential lives, following [ADR 0002](docs/adr/0002-phone-connects-directly-to-gemini-live.md) and the [Gemini](docs/research/gemini-api.md) and [Maps](docs/research/google-maps-platform.md) research notes. The Gemini and Maps keys never reach the phone or the repository.

| Credential | Where it goes | Used by | State |
|---|---|---|---|
| `GEMINI_API_KEY` | Function secret: `firebase functions:secrets:set GEMINI_API_KEY --project prod`. Locally: `firebase/functions/.secret.local` (copy `.secret.local.example`). | Interactions API (`gemini-4-hydrogen`, `store: false`) for Intake, the Digest and Finish Check-in; Start Check-in, which mints the single-use Gemini Live token (`gemini-3.8-live`) the phone connects with; and the Decisions API (`gemini-decision-1`) in Finish Check-in. | Wired |
| `MAPS_API_KEY` | Function secret, same two places. `mapstools.googleapis.com` is enabled on the project and the key allows it. | Places API (New) for `suggestToday`, and Maps agent tools (`lookupWeather`, `searchText`, `computeRoutes`) from the `mapTool` callable. | Wired; `mapstools.googleapis.com` verified (HTTP 200 for all three on 14 November), real calls recorded as fixtures, `suggestToday` is deployed; `mapTool` is not deployed yet |
| Maps SDK for Android key | `maps.apiKey` in `secrets.properties`. A separate key, restricted to the Maps SDK for Android and to the app (package and SHA-1). It ships in the app, as every Maps SDK key does, so it must not be the server key. | The map of places on Today. | Optional; without it Today lists the places with no map |
| Google Calendar | No key. The Patient grants access on the phone. | Free time and booking, on the phone. | Not built (#19) |
| Firebase app config | `secrets.properties` (Android), `GoogleService-Info.plist` (iOS). These identify the project and are not secrets, but stay out of the repository. | The Patient app. | Wired |

Before the first real Gemini call:

- Use a paid-tier Gemini project. The terms require it for users in the EEA, and paid-tier prompts are not used for training.
- Turn off AI Studio logging for that project. It is on by default for Interactions calls.
- The SDK calls `/v1/interactions`. Live tokens (`/v1beta/auth_tokens`) and Decisions (`/v1beta/decisions`) exist only on `v1beta`; both are called with `fetch` on `v1beta` (`src/live.ts`, `src/decisionsApi.ts`).
## The spoken Check-in

A Check-in is a Gemini Live session the phone opens itself (ADR 0002):

1. The app builds the Brief (`CheckInBrief`) and calls `startCheckIn {patientId, brief, mode}`. The function mints a single-use token locked to `gemini-3.8-live`, the Brief plus the fixed safety rules, and the Companion's tools.
2. The app opens the Live WebSocket with the token (`KtorLiveClient`), streams the microphone at 16 kHz and plays the Companion's speech at 24 kHz. Typing uses the same connection.
3. The Companion's tool calls run on the phone (`CompanionTools`): it reads the Patient's background, recent daily Signals against their Baseline, recent Summaries and the last Suggestion from Firestore, records the Suggestion it offers, and can show a music or Google Maps search card. Each call shows on screen as a short status line and, where there is something to show, a card.
4. When the Patient ends the Check-in the app calls `finishCheckIn` with the transcript draft and shows the Summary it returns.
5. A lost connection offers a retry and keeps what was said. Without a signed-in Patient the app plays the scripted demo instead.

To give the Companion history to draw on, seed the Demo Patients and set `demo.patientId` in `secrets.properties` (Android) or `DemoPatientId` in `Secrets.plist` (iOS) to `demo-steady`, `demo-declining` or `demo-sparse`. Locally, put `GEMINI_API_KEY` in `firebase/functions/.secret.local` and restart the emulators.

Finish Check-in also judges the transcript with the Decisions API and raises the Attention flag (#20); the Patient never sees it. A crisis found only by that judgment does not yet show the Crisis notice on the phone (the response carries no flag). Not built yet: weather, place results and walking routes from the Maps agent tools, and calendar booking. The place card only opens a Google Maps search.

## Run the walking skeleton locally

```sh
cd firebase/functions && npm install && npm run build && cd ..
firebase emulators:start --project demo-twoam
```

This starts Auth (9099), Firestore (8080), Functions (5001), Hosting (5002) and the Emulator UI (4000). Then:

1. Create the Clinician in the Auth emulator and allow them, with the `localId` from the sign-up reply as `<uid>`. `<clinician-email>` is the app's configured email: `clinician@example.com` unless `demo.clinicianEmail` is set.
   ```sh
   curl -s -X POST 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key' \
     -H 'Content-Type: application/json' \
     -d '{"email":"<clinician-email>","password":"demo-password-1","returnSecureToken":true}'
   cd seed && npm install && npm run allow-clinician -- --email <clinician-email> --uid <uid>
   ```
   `allow-clinician` also gives the account the `role: "clinician"` claim and marks its email verified, which the dashboard and the rules require ([ADR 0010](docs/adr/0010-patients-sign-in-with-their-own-account.md)); create the account first. (`npm run seed` adds its Clinician to the allowlist too, but sets no claim.)
2. Open http://localhost:5002 and sign in as that Clinician. The Patient list is empty.
3. Run the Android debug build (after `adb reverse`, above). Until the app implements [Patient sign-in](#patient-sign-in), it signs in anonymously, the rules refuse its new record and it stays on demo data; `test/emulator/walking-skeleton.test.ts` runs the same flow with a verified account. With the new sign-in, the app signs the Patient up and creates the Patient record once the email is verified, then shows the welcome and the sharing choice. Choose **Share my progress**: the app lands on Today and "Live patient" appears on the dashboard without a reload. **Continue without sharing** also lands on Today, and the Patient stays off the dashboard (the security rules allow the Clinician to see a Patient only while sharing is granted). Stopping in Settings → Sharing & privacy removes them from the open dashboard at once. Sharing again shows what is saved from then on and what was shared before, never what was saved in between: every shared record is stamped `sharedWithClinician` when it is saved (see [the sharing stamp](docs/firestore-schema.md#the-sharing-stamp)).

Use only the `demo-twoam` project with the emulators. Do not run `firebase deploy` against it.

### Patient page

The dashboard is laid out and styled as the design prototype in `design/clinician` (see [Dashboard UI](#dashboard-ui)). A Patient's page (`#/patient/{id}`) has a header (name, week since TMS, **Record a Visit**), the Attention band, and four sections as tabs: **Overview** (the Phase timeline in two thirds of the width; the latest Summary, what seems to help and the weekly Digest in a one-third column), **Summaries**, **Signals**, and **Intake & Visits**. At phone width everything is one column. `firebase/hosting/js/views/patient.js` lists the slots each section has and what a block mounted into one receives.

- **Phase timeline.** Week 1 starts the day after TMS ended. Phases run from the end of TMS to the first Visit, Visit to Visit, and the last Visit to today, shown as a strip above the lanes. The weekly Mood rating (1 to 5, gaps where there is none) and each Questionnaire kind have their own chart lanes on the same dates; Visits are dashed lines; "View timeline data table" gives the same data as a table. Without a TMS end date the timeline uses calendar dates, shows no Phases and asks for the date. The arithmetic is in `js/lib/timeline.js` and `js/lib/design-view.js`.
- **Visits.** Under Intake & Visits (or from the header's **Record a Visit**) the Clinician records or edits a Visit with an optional PHQ-2 (0 to 6) or PHQ-9 (0 to 27) score, and sets the TMS end date, each in a dialog. The date cannot be in the future, before the TMS end date, or the date of another Visit; the TMS end date cannot be after a Visit. Both are written straight to Firestore within the rules; a Visit never changes an Attention flag. A failed save keeps what was typed.
- **Signals.** A Phase selector (the current Phase by default, or all days) and one trend card for each of the nine Signals, in two columns, against the Patient's own Baseline, with its unit, date range, number of days with a value and whether the data is synthetic or from the device. A missing day is a gap with a hatched column, never zero; fewer than 5 valid days shows "insufficient Baseline" instead of a comparison. A Signal without Consent shows nothing but that; there are also no-data and stale states (latest value more than 2 days old). Each chart has a table with the same data. The comparison stored on the daily record is used; the Baseline line is computed with `js/lib/baseline.js`, the one JavaScript copy of the rule (the seed re-exports it) and pinned by the shared fixture. The arithmetic is in `js/lib/signals.js`.
- **Summaries.** Every Summary, newest first; the selected one shows the ratings, sleep line, themes, the Suggestion, the previous Outcome, Voice cues as observations and at most three quotes. The latest also appears on the Overview. There is no transcript or audio. Helpers: `js/lib/summaries.js`.
- **What seems to help.** On the Overview: each kind of Suggestion answered about in the last 28 days, how many times, and how the Patient said it felt (counts of "felt better", "about the same" and so on). Only Suggestions with an Outcome score count; kinds are ordered by mean Outcome score, then count, but no score, mean feeling or percentage is shown. Helpers: `js/lib/what-helps.js`.
- **Intake.** The saved highlights as a list; **Add Intake** / **Replace Intake** opens a dialog to paste the report or choose a `.txt` / `.md` file up to 100 KB, extract, review and save (see [Intake](#intake)).
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

### Check-in (Start and Finish)

Two callables in `europe-north1` serve a Check-in (#14). The caller must have a verified account ([Patient sign-in](#patient-sign-in)) and be the Patient (`auth.uid == patientId`), or any verified account when the Patient is a Demo Patient (`synthetic: true`), as in the rules. Signed out: `unauthenticated`; anonymous or not yet verified: `failed-precondition`, "Verify your account to continue."; anyone else, or a missing Patient: `permission-denied`. On a Demo Patient only the caller who started a Check-in may finish it, so the seeded Summaries cannot be overwritten. One Patient record starts at most 10 Check-ins an hour; past that `startCheckIn` answers `resource-exhausted` without minting a token.

| Callable | Request | Response |
|---|---|---|
| `startCheckIn` | `{patientId, brief, mode?}`. `brief` is the Brief built on the phone (1 to 12,000 characters); `mode` is `"typed"` or `"spoken"` (default). | `{checkInId, token, model, endpoint, mode, connectByMillis, expiresAtMillis}` |
| `finishCheckIn` | `{patientId, checkInId, draft, todayLines?, lastSuggestionId?}` | `{checkInId, summary, minimal}` |
| `mapTool` | `{patientId, tool, latitude, longitude, query?}`. `tool` is `find_places` (needs `query`) or `get_weather`; anything else is `invalid-argument`. The Companion's tools of the same names call it. The location is used for the lookup only and never stored or logged. Needs the `MAPS_API_KEY` secret and Maps agent tools. After the first deploy, add `allUsers` as Cloud Run Invoker on it, as for the other callables, or the app gets a 403. | `{places: [{name, mapsUrl, distanceMeters, walkMinutes}]}`: up to five within 10 km, nearest first, `walkMinutes` null when the route lookup fails. Or `{weather: {conditions, temperatureC, feelsLikeC, precipitationPercent, windKmh, goodForAWalk, sourceTitle, sourceUrl}}` |
| `generateMusic` | `{patientId, mood}`, the mood in at most 200 characters. The Companion's `suggest_music` tool starts it and answers at once; the card fills in when it returns (about 25 s). Only the mood goes to the model, inside fixed wording for calm instrumental music, with storage off. Needs the `GEMINI_API_KEY` secret; add `allUsers` as Cloud Run Invoker after the first deploy. | `{mimeType: "audio/mpeg", audioBase64}`: about a minute of `lyria-3.5` MP3 (about 1.5 MB), played from memory and never saved |

**Start.** The function mints a single-use ephemeral Live token (`POST /v1beta/auth_tokens`, the shape recorded in [spike-results.md](docs/spike-results.md#1-ephemeral-token-for-gemini-live)) that locks `models/gemini-3.8-live`, the system instruction (the Brief, then fixed rules: not a clinician, no diagnosis, treatment or questionnaires, the crisis instruction, the AI disclosure while `lastCheckInAtMillis` is `null`, and short replies when typed), the tool declarations (`firebase/functions/src/tools.ts`, the nine tools the phone runs in `CompanionTools`), AUDIO output and both transcriptions. Then it creates `checkIns/{checkInId}` with empty ratings, Voice cues, crisis marker, `assessment` and `previousTried`, stamped with `sharingStamp`. The phone:
- opens `endpoint + "?access_token=" + token` before `connectByMillis` (60 s), sends `{"setup":{"model":"<model>"}}` (or `{"setup":{}}`) and waits for `setupComplete`. The token expires at `expiresAtMillis` (10 minutes: the 8-minute cap plus margin). A reused or late token is refused as a WebSocket close 1011 with a reason, never as an HTTP error.
- reads every server frame as binary UTF-8 JSON.
- in a typed Check-in sends `{"realtimeInput":{"text":"..."}}` and shows `serverContent.outputTranscription.text` as the Companion's words. The reply is still audio (the only modality verified with `gemini-3.8-live`); playing it is the app's choice.

**Finish.** `draft` is what the phone recorded, never stored anywhere:

```json
{
  "turns": [{"speaker": "patient" | "companion", "text": "..."}],
  "voiceCues": [{"label": "...", "intensity": 1, "heard": "..."}],
  "suggestions": [{"id": "...", "kind": "walk", "details": "...", "status": "proposed" | "accepted" | "declined"}],
  "crisis": false
}
```

`todayLines` are today's Signals against Baseline as words (at most 12), and `lastSuggestionId` the previous Suggestion the Companion asked about (`Outcomes.openSuggestion` in `core` finds it: the most recent accepted Suggestion with no Outcome yet). Malformed items inside the lists are dropped and long text is cut (turns 2,000 characters, at most 400 turns); a wrong overall shape is `invalid-argument`. The function calls `gemini-4-hydrogen` with storage off and structured output (one attempt, 40-second timeout) and, at the same time, the Decisions API (`gemini-decision-1`, below), then writes `summaries/{checkInId}`, the ratings, Voice cues, crisis marker, `assessment`, `previousTried` and end time on the Check-in, any new Attention flags, `lastCheckInAtMillis` / `lastSeenAtMillis` and the raised flag level on the Patient, and the Outcome on the previous Suggestion (below), in one transaction. A text model timeout, rate limit or server error is `unavailable` and saves nothing but the flags the judgment raised: retry with the same `checkInId` while the phone still holds the draft. A silent Check-in, a request the model refuses or malformed output still succeeds with the minimal Summary (`minimal: true`). The Summary is shared with the Clinician only when the Check-in was started while sharing and the Patient still shares at the end. A Check-in that Start Check-in never created is `not-found`. A failed write is `unavailable`: retry with the same `checkInId`, which overwrites the one Summary and never makes a second. A retry without usable model output keeps what the model wrote before. The returned `summary` is exactly what the Patient and the Clinician read. The response never says anything about a flag, a level or the assessment: the Patient never sees one.

**The flag judgment (#20).** Finish Check-in sends the same transcript to `POST /v1beta/decisions` (key in `x-goog-api-key`, one attempt, 15-second timeout, the shape recorded in [spike-results.md](docs/spike-results.md#4-decisions-api-20)) with three `noul` questions: is there a crisis, is there marked hopelessness or decline, and (only when `lastSuggestionId` names a Suggestion) did the Patient try it. A silent Check-in is not sent. Routing, with the spec's starting thresholds in `firebase/functions/src/decisions.ts`:

| Answer | Result |
|---|---|
| crisis ≥ 0.5, or the draft's `crisis: true` (whatever the answer, even when the call fails) | red `crisis` flag; `redFlagAlert` emails the Clinician |
| decline ≥ 0.6 | amber `decline` flag |
| HTTP 400 with a safety code (`safety`, `prohibited_content`, `blocklist`, `image_safety`, `content_blocked`) | amber `unassessed` flag, "A Check-in could not be assessed automatically."; `assessment: "unassessed"` |
| a timeout, any other error, or a reply without usable crisis and decline answers | no flag from the review, `assessment: "unavailable"`; the Summary is saved as usual |
| triedLast ≥ 0.6 / ≤ 0.4 / in between or not asked | `previousTried` `true` / `false` / `null` on the Check-in; the Outcome (#21) uses it only when the text model is unsure |

Flag ids are `<kind>-<checkInId>`, so a retry never raises a flag twice; a kind with an uncleared flag of the same stamp (such as the phone's own crisis flag) is not raised again; flags are stamped like the Summary, and only a flag stamped `true` raises the Patient's `flagLevel` (never lowers it) and adds its reason. The transcript sent for judgment is never stored or logged; `test/checkin-logging.test.ts` covers the success, refusal, timeout and error paths.

**The Outcome (#21).** The function finds the Suggestion the answer belongs to: the most recent accepted Suggestion made before the Check-in started, not one of the draft's, with no Outcome yet. It writes the Outcome only when `lastSuggestionId` is absent or names that Suggestion, so a declined Suggestion never gets one. The text model's answer counts first (tried with an optional 1 to 5 feeling, not this time, or prefer not to say); the Decisions answer only when the text model is unsure; with neither, the Outcome stays open. It sets `tried`, `felt`, `objectiveChange` (the steps against Baseline on the day the Suggestion was made), `outcomeScore` (`null` until answered and for prefer not to say, `-0.1` not tried, otherwise `0.7 x (felt - 3) / 2 + 0.3 x` the step change clamped to ±1, all clamped to ±1) and `outcomeCheckInId`, once: a retry or a later Check-in never rewrites it. The rules are in [firestore-schema.md](docs/firestore-schema.md#suggestionssuggestionid-suggestion) and pinned by `fixtures/outcomes/outcome-cases.json`; the phone ranks kinds for its Brief with `SuggestionRanker` in `core` (`app.depressify.core.learning`).

Both need the `GEMINI_API_KEY` secret. In the emulator there is no secret, so `startCheckIn` fails with `unavailable` after its checks and creates nothing, and `finishCheckIn` works only for a silent Check-in (no model or Decisions call). The emulator suite exercises exactly those paths. With `CHECKIN_REAL_GEMINI=1` and `GEMINI_API_KEY` in the environment, `test/emulator/checkin.test.ts` also runs the handlers against the real API with fictional text, writing only to the Firestore emulator; it never runs by default.

### Suggest today

One callable in `europe-north1` makes Suggestions for the Today screen, outside a Check-in. The caller rule is the same as for a Check-in: the Patient, or any verified account on a Demo Patient.

| Callable | Request | Response |
|---|---|---|
| `suggestToday` | `{patientId}` | `{location, suggestions: [{kind, details, reason, placeQuery, music: [{title, artist}], places: [{id, name, address, latitude, longitude, mapsUrl}]}]}` |

The function reads the Patient's Context (Intake highlights, the last 5 Summaries, the last 7 days of Signals against Baseline in words, the last 10 Suggestions with their Outcomes) and calls `gemini-4-hydrogen` once, with storage off and structured output. The model proposes up to three Suggestions of different kinds. For one that means going somewhere it writes a Google Maps search (`placeQuery`); for music it names two or three albums or tracks. The function then runs one Places API (New) text search per `placeQuery`, biased to 2.5 km around the Patient's `location`, and returns up to three places each. Place results go to the phone only, never to the model, and nothing is stored. A Patient without a `location` (every live Patient today) gets the Suggestions without places, and a failed place search leaves that Suggestion without places. Names, ids, the Clinician and coordinates never go to the model, and the Context is never logged.

It needs the `GEMINI_API_KEY` and `MAPS_API_KEY` secrets, with `places.googleapis.com` enabled. A call takes about 15 seconds (over 30 on a cold start). Every call asks the model and Places again; Text Search is billed per call, so cache the day's answer before this serves more than a demo. Logic in `src/suggest.ts`, wiring in `src/suggestFunctions.ts`, tests in `test/suggest.test.ts`.

On the phone, Today shows the Suggestions in a "For you today" card once a Patient is signed in: a chip per Suggestion, its reason, the places with links to Google Maps, and the music with links that open a search in the Patient's music app. On Android the places are also pins on a Google map (Maps SDK for Android through Maps Compose) when `maps.apiKey` is set in `secrets.properties`; that key is a separate one, restricted to the Maps SDK for Android and to the app's package and signing certificate. iOS shows the list without a map.

### Attention work queue

The Patient list shows a red banner for every uncleared red flag of the Clinician's Patients, with one reason and a "Review Patient" link. It stays until the flag is cleared; search by name and the level filter never hide it. A red flag that arrives while the dashboard is open is announced, and plays a short chime (WebAudio, no file) only after the Clinician ticks "Sound for red flags" under the list; the choice is kept in this browser.

On the Patient page, the Attention band shows the level word (`DESIGN_LEVELS`: "Red · Needs attention", "Amber · Worth a look", "Green · No current flag"), each open reason with its source and time, and "View history" (raised and cleared flags, in a dialog). "Clear after follow-up" asks the Clinician to confirm they followed up, then clears one flag in a transaction: it sets the flag's `clearedAtMillis` and resets the Patient's `flagLevel` and `flagReasons` to the flags still open, or green. If anything new was raised since the dialog opened, it asks for a new review instead. The logic is in `firebase/hosting/js/lib/{banner,list-filter,sound-pref,flag-detail,clear}.js`; `firebase/seed/test/emulator/attention.test.js` runs the clearing helper as the Clinician under the rules.
### Dashboard UI

`firebase/hosting` is plain HTML, CSS and ES modules with the Firebase JS SDK from the gstatic CDN: no build step and no framework (ADR 0008). It is laid out and styled as the design prototype in `design/clinician`: the design tokens (palette, type, spacing, radii, focus) are CSS custom properties at the top of `styles.css`; a 220 px sidebar on desktop folds into a top bar below 1000 px and one column on phones with 24 px gutters and 44 px touch targets; dialogs are native `<dialog>` modals (`js/views/dialog.js`); charts are hand-made SVG with HTML data tables. The roster uses the design data layer (`subscribeRoster` and `rosterView`, below); the Attention band uses `subscribeAttention`; the other blocks keep their own sharing-filtered queries. To preview a branch against the running emulators, serve the folder on any port, for example `python3 -m http.server 5010 --bind 127.0.0.1` from `firebase/hosting`, and open http://127.0.0.1:5010: on localhost it talks to the emulators.

### Dashboard data layer

For the Clinician dashboard UI built from the design prototype in `design/clinician`. Three files give it live data in the prototype's own shapes (`design/clinician/src/data.mjs`); the item-by-item map, the gaps and the open conflicts are in [`docs/design/dashboard-backend-sync.md`](docs/design/dashboard-backend-sync.md).

| File | What it is |
|---|---|
| `firebase/hosting/js/lib/design-model.js` | Pure. Firestore documents → the design's patient object (`designPatient`), the light roster row (`designRosterPatient`), roster view (`rosterView`, `orderRoster`), level words (`DESIGN_LEVELS`), Signals (`DESIGN_SIGNALS`, `designSignals`), Summaries, timeline, Digest with sources, what helps, and the design's form checks (`validateDesignVisit`, `validateDesignTms`, `intakeFileProblem`) |
| `firebase/hosting/js/lib/design-live.js` | Live subscriptions and actions; takes the Firestore functions as its first argument. `subscribeRoster`, `subscribePatient` (and `subscribeAttention`, `subscribeOverview`, `subscribeSummaries`, `subscribeSignals`, `subscribeIntakeVisits`, `subscribeDigest`), `recordVisit`, `setTmsEndDate`, `clearAttention`, `generateDigestNow`, `extractIntake`, `saveIntake` |
| `firebase/hosting/js/data/design-data.js` | The same bound to this dashboard's browser SDK: `designData({ db, app })` |

From a React or Vite port, pass the npm SDK:

```js
import * as fs from "firebase/firestore";
import { subscribeRoster, subscribePatient, clearAttention, recordVisit } from "../../firebase/hosting/js/lib/design-live.js";
import { rosterView } from "../../firebase/hosting/js/lib/design-model.js";

// The roster: status is "loading" | "ok" | "denied" | "expired" | "error"; fromCache means offline or stale.
const stopRoster = subscribeRoster(fs, db, { clinicianEmail: user.email, keepWithdrawn: true }, (roster) => {
  const view = rosterView(roster, { search, filter });   // view.patients, view.counts, view.banner, view.filters, view.message
  if (roster.newRed.length && soundOn) chime();           // red flags that arrived since the last update
});

// One Patient: status is "loading" | "ok" | "withdrawn" | "error"; state.patient has the shape createPatients() makes.
// state.loaded, state.errors ("denied" | "error") and state.docs are per collection; a failed collection is null, never empty.
const stopPatient = subscribePatient(fs, db, patientId, { sections: "all" }, (state) => setPatient(state));

// Actions return { ok: true, ... } or { ok: false, message } with copy safe to show.
await recordVisit(fs, db, patientId, { date, type: "PHQ-9", score: "12" }, { today, tms: patient.tms, visits: patient.visits });
await clearAttention(fs, db, { patientId, raw: state.raw, nowMillis: Date.now() });   // { ok: false, changed: true } asks for a new review; notOpen: nothing to clear
```

In this plain-JS dashboard, `designData({ db, app: auth.app })` from `js/data/design-data.js` returns the same functions with `fs` and `db` already bound (`data.subscribeRoster(options, onChange)`), plus the callables (`data.generateDigestNow(patientId)`, `data.extractIntake(patientId, text)`, `data.saveIntake(patientId, highlights)`). Every query keeps the sharing filters the rules require; a Patient who stops sharing becomes `status: "withdrawn"` with an anonymous placeholder, and their listeners stop; the record is checked again after 5 s, 15 s and then every minute, so a Patient who shares again comes back. The roster's sleep sparkline shows only while the Patient's sleep Consent is granted. The tests are `firebase/hosting/test/design-{model,live}.test.mjs` and, against the emulators under the rules, `firebase/seed/test/emulator/design-live.test.js`.

### Weekly Digest

The Patient page shows the latest weekly Digest: the dates it covers, how many Summaries it drew on, when it was generated, and a short account written from that week's Summaries and Signals. Two functions write it to `patients/{id}/digests/{isoWeek}` (for example `2026-W46`):

| Function | Trigger | Covers |
|---|---|---|
| `weeklyDigest` | Mondays 07:00 Europe/Helsinki | The previous ISO week, Monday to Sunday, for every Patient who is sharing |
| `generateDigest` | "Generate now" on the dashboard, Clinician only: `{patientId}` → `{digest}` | The current ISO week from Monday to today; pressing it again overwrites that week |

Both call the text model with storage off and need the `GEMINI_API_KEY` secret. A week with no Check-ins is written from fixed copy without calling the model, so it works in the emulator; a week with Check-ins fails there with a retry, and nothing is sent to Gemini. Patients who are not sharing get no Digest. The scheduled job does not run in the emulator (it needs Pub/Sub); the emulator tests run its handler against Firestore with a fake model instead. Week semantics are in [`docs/firestore-schema.md`](docs/firestore-schema.md#digestsisoweek-digest).

### Red flag email

When a red flag is created (`patients/{id}/flags/{flagId}`), the `redFlagAlert` function writes one email for the Patient's Clinician to the top-level `mail` collection. The Firebase Trigger Email extension then sends it. Every red flag is covered, whoever raises it: the phone's crisis tool, Finish Check-in's backstop, the phone's daily job, and the hourly silence check (#28). They only have to create the flag. One Patient record causes at most 5 emails an hour; a flag past that is still recorded and shown on the dashboard.

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

Each Demo Patient has their own invented life in Helsinki, so the Companion has something specific to suggest from: `demo-steady` (Aino, Lauttasaari, choir and the shore path, mood improving since treatment), `demo-declining` (Mikko, Kallio, guitar and walks by the sea, sleep and mood falling over the last ten days) and `demo-sparse` (Sara, Vallila, a tram driver on shifts who wants short ideas and daylight). The Intake highlights name their places, people and music; the Summaries' themes and quotes and the Suggestions' details follow from them (`story` in `firebase/seed/src/profiles.js`).

Each Demo Patient also has a `location`: an example apartment address in their neighbourhood (a public landmark's coordinates), which `suggestToday` searches around.

The Demo Patients are linked to the Clinician from `--clinician` or `CLINICIAN_EMAIL`, and the seed adds that Clinician to the `clinicians` allowlist. Only the emulator falls back to `clinician@example.com`; a real project must be given the email, and the placeholder is refused there. The same inputs (`--today`, `--seed`, the Clinician) give the same data. The Clinician sees `demo-declining` (red), `demo-sparse` (amber) and `demo-steady` (green), in that order. `demo-steady` stopped sharing for three days about four weeks ago, so its Signals and Summaries show a gap there: what was saved while not sharing stays hidden from the Clinician. Live Patients are never touched. Needs Node 22 or newer.

## Live demo Patient

`npm run seed-live-patient` gives one real Patient account six weeks of invented history, so the Companion has context and "what seems to help" has something to learn from. Unlike the Demo Patients, the record is not synthetic: only the account itself and its Clinician can read it, and alerts apply as for any Patient.

```sh
cd firebase/seed && npm install
npm run seed-live-patient -- --email <patient-email>              # Auth and Firestore emulators
npm run seed-live-patient -- --email <patient-email> --reset      # delete the seeded history and write it again
npm run seed-live-patient -- --email <patient-email> --clinician <clinician-email> --project <your-project-id>
                                                                  # a real project (Application Default Credentials)
```

| Option | Meaning |
|---|---|
| `--email <email>` | The Patient's account (required). Printed only once, masked. Never commit it: the repository is public. |
| `--clinician <email>` | The Clinician, also `CLINICIAN_EMAIL`. Required for a real project; the emulator falls back to `clinician@example.com`. It should already be on the allowlist (`npm run allow-clinician`); the command warns if not. |
| `--display-name <name>` | Default `Alex`. |
| `--today <date>`, `--seed <n>` | The last day of history and the pseudo-random seed, as for the seed. `--today` is for the emulators: on a real project the history always ends today, since a past day would look silent and the silence check would flag the Patient red. A real project also refuses a seed whose history has a red flag. |
| `--reset` | Delete this Patient's seeded history and write it again. Without it, a Patient who already has seeded history is refused. |
| `--project <id>` | As for the seed: the emulators by default; a `demo-` project is refused outside them. The Auth emulator goes with the Firestore emulator (`$FIREBASE_AUTH_EMULATOR_HOST`, or `127.0.0.1:9099`); a real project with `FIREBASE_AUTH_EMULATOR_HOST` set is refused. |

**The account.** Found by email, or created with the email verified, the display name and no password. An existing account is reused and its email marked verified. No custom claims are set. The command refuses an account with the Clinician role and an email on the `clinicians` allowlist, and a Patient who declined sharing or withdrew a Consent in the app (it would undo their choice). It prints the uid, which is also the Patient id.

**What it writes** under `patients/<uid>`, in Europe/Helsinki dates:

- **The record:** `synthetic: false`, `healthSource: "synthetic"` (so the dashboard labels the data as synthetic), linked to the Clinician, `sharingConsent: "granted"`, invented Intake highlights that begin "Synthetic demo data" like the Demo Patients', a TMS end date 42 days ago, quiet hours 21 to 9, last seen now, last Check-in yesterday evening, and the level and reasons of the open flags.
- **42 daily records** with stored Baseline comparisons and composites (the shared Baseline rule). A stable month, then nine days of drift: shorter sleep, fewer steps, more time at home, more late-night screen time. Two days without any Signals and four with the watch off, stored as `null`.
- **24 Check-ins with Summaries**, more often in the first two weeks. Themes: work deadlines, sleep, missing friends, photography, cycling and the evening phone habit. Ratings dip in the last week.
- **24 Suggestions** of six kinds, most accepted, with Outcomes by the seed's Outcome rule: morning daylight, walks and time in nature felt better; music helped a little; calls with friends were mixed; the breathing exercise was mostly not tried. Yesterday's Suggestion (morning daylight) is accepted with no Outcome, so the next Check-in asks how it went.
- **Flags:** an amber `poor_sleep` flag from a deadline week, cleared by the Clinician after follow-up; an open amber `poor_sleep` flag from the last nights, and `drift` when the Signals hold low for three days. No red flag. All stamped `sharedWithClinician: true`. The Patient is amber on the dashboard.
- **Two Visits** with PHQ-9 scores (at the TMS end date and 21 days ago), and every Consent granted (each Signal, sharing, ratings, Voice cues). No Digests: the Digest function writes those.

**How reset finds the seeded history:** daily records carry `demoOverride: true`, and every other seeded id starts with `demo-` (`demo-checkin-<date>`, `demo-suggestion-<date>`, `demo-<kind>-<date>`, `demo-visit-<date>`). `--reset` deletes exactly those and writes them again. The functions' documents are never deleted: their ids are random, `<kind>-<checkInId>`, `crisis-…` or `silent-…`. The daily job writes `demoOverride: false`, so a date it already wrote keeps its record; a daily record a demo control wrote (`demoOverride: true`, demo values too) is deleted with the seeded history. Consents and the record are rewritten; the record's level and latest Check-in also count the app's own flags and Check-ins. Digests are left alone.

With your own Google account as Application Default Credentials, the Firebase Auth calls may need a quota project: `gcloud auth application-default set-quota-project <your-project-id>`.

**Signing in as this Patient.** The app on `main` signs in anonymously, so it gets a new uid and its own new record, not this one. To use this history the app has to sign in with this account (Google sign-in, or email and password after a password reset email from Firebase Auth), so that the auth uid is the Patient id. `demo.patientId` does not help: it only works for Demo Patients, which are synthetic.

**Keep it alive.** It is a real, sharing Patient: once `silenceCheck` is deployed, a day without the app connecting raises a red `silent` flag and emails the Clinician. Open the app, or run the command again with `--reset`, within a day of a demo.
