# Firebase and Google Cloud setup

A record of how the real backend project was set up on 14 November 2026, alongside the backend half of the hour-0 spikes (#6). It lists every console step, CLI step and deploy, what went wrong and how it was fixed, and what is still open. The spike results themselves are in `docs/spike-results.md`.

The repository is public. No key, token, password or personal email address appears here or anywhere in the repository. The Clinician's email is written as `<clinician-email>`.

## The project

| Item | Value |
|---|---|
| Firebase project | "Hack Junction 2026-7400", id `junction26hel-7400`, project number `723254396720` |
| Plan | Blaze (pay as you go). Needed for Cloud Functions and Secret Manager. |
| Firestore | Database `(default)`, Standard edition, Native mode, location `europe-north1` (Finland) |
| Functions region | `europe-north1`, apart from scheduled functions, which run in `europe-west1` (see [Cloud Scheduler](#cloud-scheduler-has-no-europe-north1)) |
| Local emulator project | `demo-twoam`: used by every test and by default in debug builds. It needs no credentials. |

## 1. Firebase console steps (done by the user)

1. **Created the project** and **upgraded it to Blaze**.
2. **Authentication → Sign-in method:** enabled **Anonymous** (Patients) and **Email/Password** (the Clinician). Google sign-in and SMS multi-factor were left off. Since [ADR 0010](../adr/0010-patients-sign-in-with-their-own-account.md) Patients sign in with email and password or Google, so Google is to be enabled and Anonymous disabled later (see [Still to do](#8-still-to-do)).
3. **Authentication → Users:** added the Clinician account (`<clinician-email>`).
4. **Firestore:**
   - Created the `(default)` database in `europe-north1` in production mode.
   - A first database had been created with the id `depressify`. The code only uses `(default)`, so it was deleted.
5. **Registered Android apps** (Project settings → General → Your apps):

| Nickname | Package | App ID | Status |
|---|---|---|---|
| Depressify Patient | `app.depressify.patient` | `1:723254396720:android:01ec7ae219e3f47a012af5` | **In use.** The frontend team's application id. |
| Depressify | `app.depressify` | `1:723254396720:android:6e4ec1708ea0f1ab012af5` | Not used. Registered before the frontend's id was known; can be removed. |

   Both carry the SHA-1 and SHA-256 fingerprints of the main development Mac's debug key. Every other developer machine that runs the app needs its own fingerprint added; Google sign-in for Calendar needs it.
   The app ID and API key aren't secret, but they live only in the gitignored `secrets.properties` (see below).
6. **Not done yet:** a **Web** app registration (for the dashboard on Firebase Hosting) and an **iOS** app registration (bundle id `app.depressify.patient`).

## 2. Local configuration (gitignored)

`secrets.properties` at the repository root is read by `androidApp/build.gradle.kts` into `BuildConfig`:

```properties
firebase.projectId=junction26hel-7400
firebase.applicationId=<App ID of app.depressify.patient>
firebase.apiKey=<the project's Android API key, from google-services.json>
firebase.emulatorHost=          # empty = the real project; 127.0.0.1 = the local emulators
demo.clinicianEmail=<clinician-email>
```

- The values were taken from the downloaded `google-services.json` without printing the key. The app doesn't use the Google Services plugin; Firebase is initialised in code.
- `google-services.json`, `GoogleService-Info.plist`, `Secrets.plist` and `local.properties` are also gitignored.

## 3. CLI access on the development Mac

| Tool | How it was set up |
|---|---|
| Firebase CLI | `npm i -g firebase-tools`, then `firebase login` with the project owner's account. Inside Claude Code's `!` prompt the CLI has no terminal, so it uses the code flow: `firebase login --no-localhost`, open the URL, then `firebase login <code>`. Each new attempt cancels the previous session, and a code works once. |
| Google Cloud CLI | `brew install --cask google-cloud-sdk` |
| Application Default Credentials (for the Admin SDK scripts) | Run in the Terminal app: `gcloud auth application-default login`, then `gcloud auth application-default set-quota-project junction26hel-7400` |
| Toolchain | JDK 21 (`brew install openjdk@21`), Gradle, Android command-line tools and SDK platforms 36 and 37 |

## 4. What was deployed and written to the project

All of these were run against `junction26hel-7400` with the user's approval.

1. **Security rules and indexes:** `firebase deploy --only firestore:rules,firestore:indexes`.
   - The rules include the sharing gate, the `sharedWithClinician` stamp, the function-only fields and the `clinicians/{email}` allowlist.
   - The index is `digests (sharedWithClinician, isoWeek desc)`.
   - Checked: a signed-out read of a Patient or of `clinicians` gets HTTP 403.
2. **Clinician allowlist:** `npm run allow-clinician -- --email <clinician-email> --project junction26hel-7400` in `firebase/seed`. It uses the Admin SDK through Application Default Credentials.
3. **Demo Patients:** `npm run seed -- --project junction26hel-7400 --clinician <clinician-email>` created `demo-steady` (green), `demo-declining` (red) and `demo-sparse` (amber): 401 synthetic documents. The data was read back and checked.
4. **Secrets in Secret Manager**, set from a file in the Terminal app so the value never appears in a chat:

   ```sh
   firebase functions:secrets:set GEMINI_API_KEY --data-file <file> --project junction26hel-7400
   firebase functions:secrets:set MAPS_API_KEY --data-file <file> --project junction26hel-7400
   ```

   - The deploy gave the functions' service account access to `GEMINI_API_KEY`.
   - `GEMINI_API_KEY` was checked with one fictional call to `gemini-4-hydrogen` (storage off), which answered in about 3 s.
5. **Functions:** `firebase deploy --only functions`. Deployed and active:

| Function | Type | Region | URL |
|---|---|---|---|
| `extractIntake` | callable | europe-north1 | `https://europe-north1-junction26hel-7400.cloudfunctions.net/extractIntake` |
| `saveIntake` | callable | europe-north1 | `https://europe-north1-junction26hel-7400.cloudfunctions.net/saveIntake` |
| `generateDigest` | callable | europe-north1 | `https://europe-north1-junction26hel-7400.cloudfunctions.net/generateDigest` |
| `health` | HTTP | europe-north1 | `https://europe-north1-junction26hel-7400.cloudfunctions.net/health` |
| `weeklyDigest` | scheduled, Mondays 07:00 Europe/Helsinki | europe-west1 | not publicly invokable |

   - Apps call the callables through the Firebase SDK by name and region, signed in.
   - Checked: `health` returns 200, and each callable answers a caller who isn't signed in with 401 "Sign in to continue."
6. **Container image cleanup policies:** `firebase functions:artifacts:setpolicy --location <region> --force` for `europe-north1` and `europe-west1`, so build images don't pile up on the bill.

**Not deployed yet:**
- Hosting, so `https://junction26hel-7400.web.app` returns 404.
- The functions built after this setup: `redFlagAlert` (#22), `silenceCheck` (#28), and Start / Finish Check-in (#14).
- The Trigger Email extension.

## 5. Problems met and how they were fixed

### Cloud Build rejected the lock file
- **Symptom:** the first functions deploy failed in Cloud Build's `npm ci` with "Missing: @emnapi/core … from lock file".
- **Cause:** Cloud Build runs Node 22's npm 10, which reads the lock file differently from the npm 11 on the Mac that wrote it.
- **Fix:** regenerate `firebase/functions/package-lock.json` with npm 10 (`npx npm@10 install`), and check it with `npx npm@10 ci --dry-run`.
- **Rule:** in `firebase/functions`, always install with npm 10; npm 11 rewrites the lock file into a shape Cloud Build rejects.

### Cloud Scheduler has no europe-north1
- **Symptom:** deploying `weeklyDigest` in europe-north1 failed with "Location 'europe-north1' is not a valid location".
- **Fix:** scheduled functions use `SCHEDULER_REGION = "europe-west1"` (Belgium, still in the EU). They read the same Firestore database in Finland.
- **Clean-up:** the failed deploy left a half-created `weeklyDigest` in europe-north1, which the Firebase CLI couldn't delete (it also tries to delete the missing scheduler job). It was deleted through the Cloud Functions API (`DELETE …/v2/projects/junction26hel-7400/locations/europe-north1/functions/weeklyDigest`).

### Callables returned 403 before reaching the code
- **Cause:** the deploy didn't grant public invoker access.
- **Fix:** the user added `allUsers` as **Cloud Run Invoker** on `extractintake`, `saveintake`, `generatedigest` and `health` only, then redeployed.
- **Why this is safe:** it's the standard setup for Firebase callables, which check the caller's Firebase sign-in in code. `weeklyDigest` stays private.
- **Repeat for new functions:** every new callable or HTTP function needs the same step, unless the deploy grants it.

### A second database id
- The first Firestore database was named `depressify`. It was replaced by `(default)`, because the Android SDK path, the Trigger Email extension and the deploy config all assume the default database.

## 6. Google Cloud APIs

| API | Enabled | Used for |
|---|---|---|
| Generative Language (Gemini) | yes | The text model (Intake, Digest, Finish Check-in), Live tokens and the Live session, Decisions |
| Firestore, Identity Toolkit (Auth), Cloud Functions, Cloud Run, Cloud Build, Artifact Registry, Eventarc, Cloud Scheduler, Secret Manager | yes | Turned on by Firebase and the deploys |
| Places API (New) | yes | Spike fixtures; fallback for #18 |
| Weather API | yes | Spike fixtures; fallback for #18 |
| **Maps Tools** (`mapstools.googleapis.com`) | **no** | #18, the recommended path: weather, place search and walking routes in one service. The Maps key already allows it; the user only has to enable it. |
| **Routes API** | **no** | Only needed if #18 falls back to the direct APIs |
| **Google Calendar API** (`calendar-json.googleapis.com`) | **no** | #19 (on the phone) |

## 7. What the #6 spikes confirmed about these APIs

Full details and fixtures: `docs/spike-results.md` and `fixtures/spike/`.

- **Live token:**
  - `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens` with `x-goog-api-key`, using `bidiGenerateContentSetup` plus a `fieldMask` that must include `model`. `liveConnectConstraints` is rejected.
  - The response is only `{name}`, and a token lasts at most 20 hours.
- **Live session:**
  - `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=<token>`
  - It works from shared Kotlin with Ktor (OkHttp and CIO engines). The first reply comes back in about 0.5 s.
- **Structured output:** `POST /v1/interactions` with `response_format` (a JSON schema), `store: false`. It takes about 7 s.
- **Decisions:** `POST /v1beta/decisions` with `gemini-decision-1` and yes/no (`noul`) questions.
- **Maps:** the direct Places and Weather calls work. The Maps agent tools and Routes return 403 until those APIs are enabled.

## 8. Still to do

| Who | What |
|---|---|
| User | Provide SMTP details (a connection URI, password and From address) to install the **Trigger Email** extension: `firebase ext:install firebase/firestore-send-email`, collection `mail`, location europe-north1. Steps are in the README. |
| User | Register the **Web** app (for Hosting) and the **iOS** app (`app.depressify.patient`); put `GoogleService-Info.plist` and `Secrets.plist` in `iosApp/Depressify/`. |
| User | Add each teammate's debug SHA-1/SHA-256 to `app.depressify.patient`. |
| User, for Calendar (#19) | A consent screen in Testing mode with test users, scope `calendar.events.owned`, enable the Calendar API, and Android/iOS OAuth clients. |
| Backend | Deploy `redFlagAlert`, `silenceCheck` and the Check-in functions after review. Grant Cloud Run Invoker to each new callable. |
| Done (14 November 2026) | **Google** sign-in enabled, with its web OAuth client and the Android OAuth client for `app.depressify.patient` (from the SHA-1). **Email enumeration protection** is on. The app's Google sign-in needs the web client id (`client_type: 3` in a freshly downloaded `google-services.json`) as its server client id. |
| Done (14 November 2026) | `allow-clinician` (the new script) ran against the real project: the Clinician's account has `role: "clinician"` and a verified email. A teammate's test Clinician email is also on the allowlist without an account yet; run `allow-clinician` again for it once its account exists. |
| Backend, after the app ships the new sign-in | Deploy the ADR 0010 rules. |
| User, after the app ships the new sign-in | Authentication → Sign-in method → **Anonymous** → Disable, once testers have upgraded their anonymous accounts or signed up. Existing records stay their owners'. |
| Optional | Remove the unused `app.depressify` Android app; restrict the Android API key to `app.depressify.patient` plus its fingerprints. |
