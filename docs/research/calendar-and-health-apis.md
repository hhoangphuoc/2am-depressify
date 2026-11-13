# Calendar, health and music data sources, plus sign-in and consent

Researched 2026-11-13 by fetching the owning pages directly. Every claim links to the page it was read from. Anything I could not confirm on a primary page is listed under "Not verified" at the end and tagged **[unverified]** inline.

## Summary of what changes the plan

- "Health API" in the idea doc maps to three different things: on-device stores (Health Connect, HealthKit), which only the mobile app can read; cloud APIs (Google Health API, Oura), which the backend can read; and Cloud Healthcare API, which is a clinical data store and unrelated to wearables.
- The Fitbit Web API was switched off on 2 November 2026. The Google Health API (`health.googleapis.com`, v4) replaces it and is the only Google cloud route to wearable data.
- Google Fit REST is closed to new developers since May 2024.
- Spotify audio features (mood from valence/energy) are closed to new apps, and a new Spotify app is limited to 5 users.
- Google OAuth in Testing mode: 100 test users and refresh tokens that die after 7 days.

## 1. Google Calendar API v3

Use here: read the patient's schedule to find free gaps and treatment sessions, and book a suggested activity as an event. Call it from the backend with the patient's stored refresh token (section 4).

Base URL: `https://www.googleapis.com/calendar/v3`

| Need | Method and path | Source |
|---|---|---|
| List the user's calendars | `GET /users/me/calendarList` | [calendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list) |
| List events (supports `syncToken`) | `GET /calendars/{calendarId}/events` | [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) |
| Busy intervals | `POST /freeBusy` | [freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) |
| Create an event | `POST /calendars/{calendarId}/events` | [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) |
| Watch events (push) | `POST /calendars/{calendarId}/events/watch` | [events.watch](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch) |
| Stop a push channel | `POST /channels/stop` | [channels.stop](https://developers.google.com/workspace/calendar/api/v3/reference/channels/stop) |

**Sync tokens.** Do one full `events.list`, store `nextSyncToken` from the last page, and pass it as `syncToken` next time to get only changes, including deletions. If the server answers `410`, wipe the local copy and do a full sync again. ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list))

**Push notifications.** The receiver must be an HTTPS URL with a valid certificate; self-signed and untrusted certificates are rejected. The first message has `X-Goog-Resource-State: sync` and can be ignored; later ones say `exists` and carry no change details, so you still call `events.list`. Channels expire, there is no automatic renewal, and "notifications are not 100% reliable", so a periodic sync is needed anyway. ([push guide](https://developers.google.com/workspace/calendar/api/guides/push)) For the hackathon, polling with a sync token is enough and avoids needing a public webhook.

**Scopes** (prefix `https://www.googleapis.com/auth/`, wording from [Choose Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)):

| Scope | Consent text | Fit |
|---|---|---|
| `calendar.freebusy` | View your availability in your calendars | Free gaps only, no titles |
| `calendar.events.freebusy` | See the availability on Google calendars you have access to | Same, narrower family |
| `calendar.calendarlist.readonly` | See the list of Google calendars you're subscribed to | Calendar picker |
| `calendar.events.readonly` | View events on all your calendars | Read titles and times |
| `calendar.events.owned` | See, create, change, and delete events on Google calendars you own | Read plus booking, own calendars only |
| `calendar.events` | View and edit events on all your calendars | Read plus booking, all calendars |
| `calendar.app.created` | Make secondary Google calendars, and see, create, change, and delete events on them | Booking into our own "wellbeing" calendar without reading anything else |
| `calendar.readonly` / `calendar` | Full read / full control | Broader than we need |

The scopes page no longer shows which scopes are sensitive or restricted. **[unverified]** My understanding is that event-reading Calendar scopes are sensitive and none are restricted; the Cloud Console "Data access" page shows the classification when you add a scope.

**Verification and hackathon limits.**

- Testing status: up to 100 test users, who must be listed by email. Authorizations expire seven days after consent, including the refresh token. Requests for only name, email and profile are exempt from all of this. ([Manage app audience](https://support.google.com/cloud/answer/15549945?hl=en))
- In production without verification: users see the unverified app screen, and the cap is 100 new users over the lifetime of the project; it cannot be reset. ([Manage app audience](https://support.google.com/cloud/answer/15549945?hl=en), [Unverified apps](https://support.google.com/cloud/answer/7454865?hl=en))
- Google also caps refresh tokens at 100 per Google Account per OAuth client ID. ([Using OAuth 2.0](https://developers.google.com/identity/protocols/oauth2))

Practical reading for a demo: stay in Testing, add the judges' and team's Google accounts as test users, and re-consent if the demo is more than 7 days after the first login.

**Quota and price** ([quota page](https://developers.google.com/workspace/calendar/api/guides/quota)): 10,000 requests per minute per project and 600 per minute per user for projects created on or after 1 May 2026. Standard use is "at no additional cost". The page adds a daily threshold of 1,000,000 requests per project and says exceeding quota "is planned to incur charges" later in 2026. Over-quota calls return 403 or 429.

## 2. Health data

### Where each source can be read

| Source | Type | Read by | Status |
|---|---|---|---|
| Health Connect | On-device store, Android | Mobile app only | Stable |
| Apple HealthKit | On-device store, iOS | Mobile app only | Stable |
| Google Health API | Cloud REST, Google OAuth | Backend | v4 live; replaces Fitbit Web API |
| Fitbit Web API | Cloud REST | n/a | Turned off 2 Nov 2026 |
| Google Fit REST | Cloud REST | n/a | No new sign-ups; ends 2026 |
| Oura API v2 | Cloud REST, Oura OAuth | Backend | Live; 10-user limit until approved |
| Samsung Health Data SDK | On-device SDK, Android | Mobile app only | Developer mode only without partnership |
| Wear OS Health Services | On-watch sensor API | Watch app | Only if we ship a watch app |
| Cloud Healthcare API | FHIR/HL7v2/DICOM store | Backend | GA, available in Finland |

Health Connect and HealthKit have no server API. The phone app must read the records and POST them to our backend.

### Health Connect (Android)

- Artifact: `androidx.health.connect:connect-client`, stable 1.1.0, alpha 1.2.0-alpha06 ([release page](https://developer.android.com/jetpack/androidx/releases/health-connect)). Entry class `HealthConnectClient`.
- Part of the Android framework from Android 14 (API 34). On Android 13 and lower the user must install the Health Connect app from Play. The SDK supports API 26+, the app API 28+. ([get started](https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started))
- Record types that matter here, all listed on the [data types page](https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types): `HeartRateRecord`, `RestingHeartRateRecord`, `HeartRateVariabilityRmssdRecord`, `SleepSessionRecord`, `StepsRecord`, `ExerciseSessionRecord`, `OxygenSaturationRecord`, `SkinTemperatureRecord`, `MindfulnessSessionRecord` (session types include meditation, breathing, music). There is no sleep score type on that page; we would compute one from sleep sessions.
- Reads work in the foreground by default. Background reads need the extra permission `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND` and a feature check (`FEATURE_READ_HEALTH_DATA_IN_BACKGROUND`). By default an app can read only 30 days back from the first grant; older data needs `PERMISSION_READ_HEALTH_DATA_HISTORY`. ([read data](https://developer.android.com/health-and-fitness/guides/health-connect/develop/read-data))
- Play: fill in the Health Apps declaration form in Play Console, justify every data type, and link the same privacy policy that Health Connect shows. A published app that skipped this gets an "unable to access" dialog for its users. ([declare access](https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access)) The page describes this for published apps; whether a debug build on a demo phone is affected is **[unverified]**.
- Gotcha: Health Connect only holds what other apps write into it (Fitbit, Samsung Health, Oura and so on). An empty store on the demo phone means no data.

### Apple HealthKit (iOS)

- Access through `HKHealthStore`. Add the HealthKit capability, set `NSHealthShareUsageDescription`, check availability on the device, then request authorization per data type. ([Authorizing access to health data](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data))
- HRV on iOS is `HKQuantityTypeIdentifierHeartRateVariabilitySDNN`, "the standard deviation of heartbeat intervals" ([Apple docs](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn)). Health Connect gives RMSSD. The two are different statistics, so do not chart Android and iOS HRV on one axis.
- Background delivery and sleep type details were not checked.

### Google Health API (cloud, successor to Fitbit Web API)

- "The next generation of the Fitbit Web API", covering "Fitbit, Pixel Watch, and other third-party devices and apps", on Google OAuth 2.0. Legacy Fitbit Web API support ended 30 September 2026 and the endpoints were turned off 2 November 2026. ([Google Health API home](https://developers.google.com/health))
- Base URL `https://health.googleapis.com`, version `v4` in the live [discovery document](https://health.googleapis.com/$discovery/rest?version=v4). The [REST reference](https://developers.google.com/health/reference/rest) still labels resources `v4beta`, so GA status is unclear.

| Need | Method and path (from the discovery document) |
|---|---|
| List data points | `GET /v4/users/me/dataTypes/{dataType}/dataPoints` (`filter`, `pageSize`, `pageToken`) |
| One merged stream across sources | `GET /v4/users/me/dataTypes/{dataType}/dataPoints:reconcile` |
| Daily aggregates | `POST /v4/users/me/dataTypes/{dataType}/dataPoints:dailyRollUp` |
| Aggregates over time windows | `POST /v4/users/me/dataTypes/{dataType}/dataPoints:rollUp` |
| Map user identity | `GET /v4/users/me/identity` |
| Paired devices | `GET /v4/users/me/pairedDevices` |
| Webhook subscribers | `POST /v4/projects/{project}/subscribers`, then `.../subscribers/{id}/subscriptions` |

- Data type ids on the [data types page](https://developers.google.com/health/data-types) include `heart-rate`, `heart-rate-variability`, `daily-heart-rate-variability`, `daily-resting-heart-rate`, `sleep`, `steps`.
- Scopes (prefix `https://www.googleapis.com/auth/googlehealth.`): `sleep.readonly`, `health_metrics_and_measurements.readonly`, `activity_and_fitness.readonly`, `mindfulness.readonly`, plus write-only twins. Google asks apps to handle partial consent, since users can grant some scopes and refuse others. ([scopes](https://developers.google.com/health/scopes))
- Backend-readable: yes, it is a normal Google OAuth API, so it can ride on the same consent and refresh token as Calendar.
- Not found on the pages read: quota, price, sensitive/restricted classification, verification or security assessment requirements, country limits. **[unverified]**
- Gotcha: it only has data for people who use Fitbit or Pixel Watch (or apps that write into Google Health).

### Google Fit REST API

"Will be deprecated in 2026. As of May 1, 2024, developers cannot sign up to use these APIs." Google points cloud integrations to the Google Health API and Android apps to Health Connect. ([Fit REST](https://developers.google.com/fit/rest), [migration FAQ](https://developer.android.com/health-and-fitness/guides/health-connect/migrate/migration-faq)) Not usable for us.

### Oura API v2 (smart ring, cloud)

- Base `https://api.ouraring.com`, all `GET` under `/v2/usercollection/`: `daily_sleep`, `sleep`, `daily_readiness`, `daily_stress`, `daily_resilience`, `daily_activity`, `heartrate`, `daily_spo2`, `session`, `workout`. Webhooks at `/v2/webhook/subscription`. ([Oura API v2 docs](https://cloud.ouraring.com/v2/docs), read from its OpenAPI file)
- OAuth 2.0 authorization code: authorize at `https://cloud.ouraring.com/oauth/authorize`, token at `https://api.ouraring.com/oauth/token`, scopes such as `daily` and `heartrate`. ([authentication](https://cloud.ouraring.com/docs/authentication))
- Personal access tokens were deprecated in December 2025, so even a one-person demo needs the OAuth flow. Apps are limited to ten users until Oura approves them. ([v2 docs](https://cloud.ouraring.com/v2/docs), [getting started](https://cloud.ouraring.com/docs/))
- This is the only source here that returns ready-made sleep, readiness and stress scores. It is also the closest match to the challenge's "smart rings" hint.

### Samsung Health Data SDK and Wear OS Health Services

- Samsung Health Data SDK v1.1.0 is an Android SDK. Without an approved partnership the app "works only with the developer mode turned on", which Samsung says is for testing only. ([process](https://developer.samsung.com/health/data/process.html)) Fine for a demo on a team member's Galaxy phone, not for distribution. Samsung Health can also sync into Health Connect **[unverified]**, which would make this SDK unnecessary.
- Health Services on Wear OS 3+ gives a watch app `MeasureClient`, `ExerciseClient` and `PassiveMonitoringClient`. ([Health Services](https://developer.android.com/health-and-fitness/guides/health-services)) Only relevant if we build a watch app. Skip.

### Cloud Healthcare API (FHIR store)

- Managed FHIR, HL7v2 and DICOM stores. Available in `europe-north1` (Finland) and other EU regions. ([regions](https://cloud.google.com/healthcare-api/docs/regions))
- Pricing has a free tier: first 1 GiB of structured storage and first 25,000 requests per month. ([pricing](https://cloud.google.com/healthcare-api/pricing))
- Judgement: overkill for the hackathon. The clinical intake is one document per patient; a table or JSON column in the backend database is enough. A FHIR store earns its place only if the product must exchange records with hospital systems. Worth one line in the pitch as the later path.

### Kotlin Multiplatform wrapper

[HealthKMP](https://github.com/vitoksmile/HealthKMP) (`com.viktormykhailiv:health-kmp:1.7.0`) wraps HealthKit on iOS/watchOS and Health Connect (or Google Fit) on Android. Its README lists heart rate, sleep with stages, steps, exercise and about a dozen body measurements. HRV, resting heart rate and SpO2 are missing. It is a single-maintainer project with 93 GitHub stars, built against Kotlin 2.3.20, last released August 2026.

Judgement: usable for heart rate, sleep and steps in a demo. HRV, which the challenge text calls out, needs our own `expect/actual` code: `HeartRateVariabilityRmssdRecord` on Android and the SDNN type on iOS. I found no JetBrains or Google first-party KMP health library.

## 3. Music signal

| Source | What is possible | Limits |
|---|---|---|
| Spotify Web API | `GET https://api.spotify.com/v1/me/player/recently-played` with scope `user-read-recently-played` ([reference](https://developer.spotify.com/documentation/web-api/reference/get-recently-played)) | Audio Features, Audio Analysis, Recommendations and Related Artists are closed to new apps since 27 Nov 2024 ([Spotify blog](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)); the Audio Features reference is marked Deprecated ([reference](https://developer.spotify.com/documentation/web-api/reference/get-audio-features)). Development mode allows up to 5 allowlisted users and the app owner needs Spotify Premium; extended quota is only for registered organisations ([quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)). |
| YouTube Data API v3 | `GET https://www.googleapis.com/youtube/v3/playlistItems`, 1 quota unit per call ([playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list)) | Default quota 10,000 units per day ([getting started](https://developers.google.com/youtube/v3/getting-started)). Returns titles and channels, no mood or audio data. I found no official YouTube Music API and no official statement that there is none. **[unverified]** |

Consequence: no API gives us "mood of the playlist". The workable version is recently played track and artist names from Spotify, with Gemini judging the mood, for at most 5 demo users. Suggesting music is easier than sensing it.

## 4. Identity and consent

Goal: the client signs the user in and gets a one-time authorization code; the backend exchanges it, keeps the refresh token, and calls Calendar (and Google Health API if used).

| Platform | Sign-in (who is this) | Authorization (server auth code for Calendar) |
|---|---|---|
| Android | Credential Manager with Sign in with Google ([guide](https://developer.android.com/identity/sign-in/credential-manager-siwg)). The guide itself says to use `AuthorizationClient` for access to account data. | `Identity.getAuthorizationClient(activity).authorize(AuthorizationRequest)` with `setRequestedScopes(...)` and `requestOfflineAccess(serverClientId)`; if consent is needed, launch the returned `pendingIntent`; then read `getServerAuthCode()`. Needs `com.google.android.gms:play-services-auth`. ([Authorize access](https://developer.android.com/identity/authorization)) |
| iOS | Google Sign-In SDK | Set `GIDServerClientID` in Info.plist and read `serverAuthCode` from `GIDSignInResult` ([offline access](https://developers.google.com/identity/sign-in/ios/offline-access)). Add scopes later with `addScopes(_:presenting:)` ([API access](https://developers.google.com/identity/sign-in/ios/api-access)). |
| Web | Google Identity Services | `google.accounts.oauth2.initCodeClient()` in popup or redirect mode; the backend receives the code ([code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)). |
| Backend | Verify the ID token | Authorization endpoint `https://accounts.google.com/o/oauth2/v2/auth`, token endpoint `https://oauth2.googleapis.com/token`. Set `access_type=offline` to receive a refresh token and `include_granted_scopes=true` for incremental authorization, which Google recommends. ([web server apps](https://developers.google.com/identity/protocols/oauth2/web-server)) |

Notes:

- The Android and iOS apps pass the **web/server** client ID so the code they receive is redeemable by the backend. Three OAuth clients are needed in one Cloud project: Android, iOS, web.
- Incremental authorization fits the product: sign in with basic profile only (no warning screen, no 7-day expiry, no test user list), and ask for Calendar when the patient switches the calendar feature on.
- Store refresh tokens encrypted on the server; Google's Android guide carries the same caution.
- None of these SDKs is multiplatform. In KMP this is an `expect/actual` "get server auth code" function per platform. I did not find a first-party KMP sign-in library.

**Firebase Auth.** Official SDKs exist for Android, iOS, web, Flutter, Unity and C++; Kotlin Multiplatform is not on the list ([Firebase Auth docs](https://firebase.google.com/docs/auth)). The community [GitLive firebase-kotlin-sdk](https://github.com/GitLiveApp/firebase-kotlin-sdk) publishes `dev.gitlive:firebase-auth:2.8.0` and reports about half of the Auth API covered. Firebase Auth gives us a user identity and session; it does not give the backend a Google refresh token for Calendar, so the code flow above is needed either way. For a hackathon, verifying the Google ID token on our own backend is fewer moving parts.

## 5. Regulatory notes

- **Google API Services User Data Policy, Limited Use** ([policy](https://developers.google.com/terms/api-services-user-data-policy)). For sensitive and restricted scopes: use the data only for user-facing features that are prominent in the app; no transfers except to provide those features with the user's consent, for security, or to comply with law; no human reading without the user's affirmative agreement for specific data; no selling or advertising use. Two consequences for us. Showing a patient's calendar or Google Health data to a clinician is a human reading it, so it needs an explicit, specific opt-in from the patient. Sending that data to Gemini is a transfer, so it must be disclosed and consented. Whether the policy places further limits on AI model use was not confirmed. **[unverified]**
- **Health Connect** ([declare access](https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access)): Play declaration per data type and a privacy policy. The declaration categories include medical apps and "human subjects research". The full Play Health Connect policy text was not read. **[unverified]**
- **GDPR** **[unverified, EUR-Lex could not be fetched]**: health data is a special category under Article 9 and needs a condition such as explicit consent; transfers outside the EEA fall under Chapter V ([GDPR text](https://eur-lex.europa.eu/eli/reg/2016/679/oj)). Practical reading, not legal advice: keep the database and file storage in an EU region (Cloud Healthcare API and other Google Cloud services offer `europe-north1`, Finland), take separate explicit consent for health data and for sharing with the clinician, and find out where Gemini requests are processed before sending health data in prompts.

## Open questions

1. Demo phone: Android (Health Connect) or iPhone (HealthKit)? Supporting both doubles the health work and HRV is not comparable across them.
2. Does anyone on the team have an Oura ring, Fitbit or Pixel Watch with real history? Oura gives ready-made sleep, readiness and stress scores through a backend-only integration, which may be the cheapest path to real data. Otherwise we seed demo data.
3. Calendar: is free/busy enough, or does the agent need event titles? Should bookings go into the patient's main calendar (`calendar.events.owned`) or a separate app calendar (`calendar.app.created`)?
4. Sleep score: use Oura's, compute our own from sleep sessions, or show duration and stages only?
5. Music: keep Spotify listening as an input (5 users, no audio features, Gemini infers mood), or use music only as a suggestion?
6. Clinical intake: plain database now with FHIR as roadmap (my recommendation), or FHIR store from the start?
7. Auth: own backend session from a verified Google ID token, or Firebase Auth through the GitLive SDK?
8. May calendar and health data be included in Gemini prompts, and what does the patient consent screen say about the clinician seeing it?
9. Is the demo within 7 days of the first test logins? If not, plan a re-consent.

## Not verified

- Which Calendar scopes are classed sensitive or restricted. The scopes page does not say.
- Whether an unverified app in production with Calendar scopes behaves differently from the 100-user cap described; I read the help pages only.
- Google Health API: GA versus beta status (discovery says v4, reference says v4beta), quotas, price, scope classification, verification or security assessment requirements, availability in Finland, and whether data from non-Fitbit wearables really appears.
- Health Connect: whether an undeclared debug build on a demo phone can read data; the full Play policy text; which wearable apps write HRV into Health Connect.
- HealthKit: background delivery, sleep type names, and any App Store review rules for health data.
- Samsung Health syncing into Health Connect; Samsung data type list.
- HealthKMP was judged from its README and release list only; I did not build it or read its source.
- Spotify: I read the reference and policy pages, not the current developer terms on using Spotify data with AI models.
- YouTube Music having no official API: I found no page stating this either way.
- Android Credential Manager class names for the sign-in step (`GetGoogleIdOption` and the `googleid` artifact) did not appear in the page text I extracted, so they are omitted above.
- Firebase Auth KMP: the GitLive coverage figure comes from its own README badge.
- GDPR articles: EUR-Lex could not be fetched in this session; the statement is from general knowledge.
- Cloud Healthcare API compliance claims (for example HIPAA or EU certifications) were not looked up.

