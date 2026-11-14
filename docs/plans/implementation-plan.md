# Implementation plan

**Goal:** Build the demo described in [system-design.md](../context/system-design.md): a Kotlin Multiplatform Patient app (Android first, iOS for the Check-in), a Firebase backend, and a plain web Clinician dashboard.

**How to use this plan:** work task by task. Each task lists the files it owns, the interfaces it consumes and produces, the tests to write first, and how to verify it. Steps use checkboxes for tracking. Terms follow [GLOSSARY.md](../../GLOSSARY.md); use them in code names too.

This plan replaces the one in the closed [PR #2](https://github.com/hhoangphuoc/2am-depressify/pull/2). It keeps that plan's tested logic (baseline, rules, learning, tool dispatch, aggregation) and changes the stack, names and rules to match the merged design. "Changes from PR #2" at the end lists the differences.

## Architecture

| Part | Path | Contents |
|---|---|---|
| `core` | `core/` | Kotlin Multiplatform, common code only: models, Baseline, flag rules, Nudge rules, learning, Brief builder, tool catalog and dispatch, aggregation maths. Targets JVM, Android, iOS. Tests run on the JVM. |
| `shared` | `shared/` | Kotlin Multiplatform client code: Compose Multiplatform UI, Gemini Live client (Ktor WebSocket), Firebase access (GitLive SDK), and interfaces for audio, health, calendar, location, usage and notifications |
| `androidApp` | `androidApp/` | Android entry point and platform implementations |
| `iosApp` | `iosApp/` | Xcode project and Swift glue |
| Functions | `firebase/functions/` | TypeScript Cloud Functions (Node 20, vitest, `@google/genai`) |
| Dashboard | `firebase/hosting/` | HTML and JavaScript with the Firebase JS SDK and Chart.js, tested with `node --test` |
| Seed | `firebase/seed/` | Node script that creates the Demo Patients |

## Global constraints

- Package `app.depressify`. Versions are the latest stable at hour 0, pinned in `gradle/libs.versions.toml`. The research recorded Kotlin 2.4.21, Compose Multiplatform 1.12.2, Ktor 3.6.1 and GitLive `firebase-kotlin-sdk` 2.8.0 ([kmp research](../research/kmp-mobile-integration.md)).
- Use the current project layout: the Android app is its own module and shared modules use `com.android.kotlin.multiplatform.library`.
- `core` has no platform imports and no `java.*` imports. Use `kotlinx-datetime` and `kotlinx.serialization`. Run its tests with `./gradlew :core:jvmTest`.
- Ktor client engines: OkHttp on Android, Darwin on iOS. The `Android` engine has no WebSocket support.
- Firestore holds daily aggregates, Summaries, Suggestions and flags only. Raw sensor samples, audio and transcripts are never stored outside the phone ([ADR 0006](../adr/0006-transcripts-are-deleted-after-the-summary.md)).
- Cloud Functions never log a transcript, a Brief or a quote.
- Copy says "voice cues" and "suggestion". It never says "diagnosis", "treatment" or "therapy". The Companion never asks PHQ questions ([ADR 0001](../adr/0001-wellbeing-companion-not-clinical-treatment.md)).
- The app never places a call: dial intent only, no `CALL_PHONE` permission. Signals alone never show the Crisis notice.
- The crisis number in the demo is a mock: `CrisisNumbers.MOCK = "000 000 0000"`, labelled "Demo crisis line (mock)".
- Baseline window 14 days; a comparison needs at least 5 valid prior days. A missing value is `null`, never `0`.
- Ratings (mood, energy, sleep quality) are integers 1 to 5. Voice cue intensity is 1 to 5.
- At most one Nudge per calendar day. The phone checks about every 6 hours.
- Learning: the top 3 kinds go into the Brief; explore rate 0.2.
- Audio: microphone 16 kHz mono PCM16; Live output 24 kHz mono PCM16.
- Models, defined once in `core` and once in `firebase/functions/src/models.ts`:
  - `LIVE_MODEL = "gemini-3.8-live"` (confirmed in Task 2)
  - `TEXT_MODEL = "gemini-4-hydrogen"`, always with `store: false`
  - `DECISION_MODEL = "gemini-decision-1"` (needs API version `v1beta`)
- Timestamps in Firestore are epoch milliseconds in fields ending `AtMillis`. Dates are `yyyy-MM-dd` strings in the device time zone (`Europe/Helsinki` for the demo).
- Firestore region: an EU location, chosen at project creation and recorded in `docs/spike-results.md`.
- Secrets are never committed. `androidApp/google-services.json`, `iosApp/GoogleService-Info.plist` and `secrets.properties` are gitignored. Functions use `defineSecret` for `GEMINI_API_KEY` and `MAPS_API_KEY`.

## Review focus

1. **Watch not worn or a missing day:** the value is `null`. A missing night never raises a flag or counts toward a Nudge. (Tasks 3, 4, 5.)
2. **New Patient or a constant Signal:** the comparison is `null` or bounded. No drift flags and no division by zero. (Task 3.)
3. **Phone dead for 24 hours:** the phone cannot report its own silence, so the hourly function raises red. (Task 15.)
4. **Silent or very short Check-in:** a Summary is still produced. (Tasks 11, 13.)
5. **Crisis while offline, or a function fails:** the Crisis notice shows before any network call, and the flag write is queued. (Tasks 7, 12.)
6. **Transcript handling:** nothing in `finishCheckIn` writes or logs the transcript, including error paths. (Task 13.)

## Work tracks

| Track | Owner | Tasks | Can start |
|---|---|---|---|
| Foundation | all | 1, 2 | hour 0 |
| Core logic | Dev 2 (Dev 1 helps with 7, 8) | 3 to 8 | after 1 |
| Android Check-in | Dev 1 | 9 to 12 | after 2 |
| Firebase and dashboard | Dev 3 | 13 to 18 | after 1 |
| Signals and Nudges | Dev 2 | 19, 20 | after 3 to 5 |
| iOS | Dev 1 | 21 | after 11 |
| Demo | all | 22 | hour 30 |
| Stretch | whoever is free | 23 | after 22 is rehearsed |

With two developers, Dev 2 takes the Firebase track after the core logic, and Task 21 is cut to the Check-in only.

---

### Task 1: Project scaffold and shared data contract

**Files:**
- Create: `settings.gradle.kts`, `build.gradle.kts`, `gradle/libs.versions.toml`, `core/build.gradle.kts`, `shared/build.gradle.kts`, `androidApp/build.gradle.kts`, `androidApp/src/main/AndroidManifest.xml`, `androidApp/src/main/kotlin/app/depressify/MainActivity.kt`, `iosApp/` (from the Kotlin Multiplatform wizard)
- Create: `core/src/commonMain/kotlin/app/depressify/core/model/Models.kt`, `.../core/model/FirestoreJson.kt`
- Create: `firebase/firebase.json`, `firebase/.firebaserc`, `firebase/functions/src/types.ts`, `docs/firestore-schema.md`
- Modify: `.gitignore` (secrets files above, `.gradle/`, `**/build/`, `firebase/functions/node_modules/`, `firebase/functions/lib/`, `iosApp/Pods/`)
- Test: `core/src/commonTest/kotlin/app/depressify/core/model/ModelsSerializationTest.kt`

**Interfaces:**
- Produces (in `app.depressify.core.model`, all `@Serializable`; `types.ts` mirrors them by hand):
  - `enum class Signal(val key: String, val higherIsBetter: Boolean)`: `SLEEP_MINUTES("sleepMinutes", true)`, `STEPS("steps", true)`, `RESTING_HR("restingHr", false)`, `HRV("hrv", true)`, `TIME_AT_HOME_MIN("timeAtHomeMinutes", false)`, `RADIUS_KM("movementRadiusKm", true)`, `LATE_SCREEN_MIN("lateNightScreenMinutes", false)`
  - `enum class FlagLevel { green, amber, red }`
  - `enum class FlagKind { drift, low_mood, poor_sleep, decline, unassessed, sleep_collapse, inactive, silent, crisis }`
  - `enum class SuggestionKind { walk, nature, music, social_call, breathing, class_activity, daylight }`
  - `enum class HealthSource { device, synthetic }`
  - `data class DailyDoc(val date: String, val values: Map<String, Double?>, val vsBaseline: Map<String, Double?>, val composite: Double?, val demoOverride: Boolean = false)`
  - `data class PatientDoc(val displayName: String, val clinicianEmail: String, val intakeHighlights: String = "", val tmsEndDate: String? = null, val flagLevel: FlagLevel = FlagLevel.green, val flagReasons: List<String> = emptyList(), val quietHoursStart: Int = 22, val quietHoursEnd: Int = 8, val lastSeenAtMillis: Long? = null, val lastCheckInAtMillis: Long? = null, val healthSource: HealthSource = HealthSource.device, val synthetic: Boolean = false)`
  - `data class VoiceCue(val label: String, val intensity: Int, val heard: String)`
  - `data class CheckIn(val id: String, val startedAtMillis: Long, val endedAtMillis: Long?, val mood: Int?, val energy: Int?, val sleepQuality: Int?, val voiceCues: List<VoiceCue> = emptyList(), val crisis: Boolean = false)`
  - `data class Suggestion(val id: String, val kind: SuggestionKind, val details: String, val suggestedAtMillis: Long, val booked: Boolean = false, val tried: Boolean? = null, val felt: Int? = null, val objectiveChange: Double? = null, val outcomeScore: Double? = null)`
  - `data class Summary(val checkInId: String, val atMillis: Long, val mood: Int?, val sleepLine: String, val themes: List<String>, val voiceCues: List<VoiceCue>, val suggestion: String?, val previousOutcome: String?, val quotes: List<String>)`
  - `data class Flag(val level: FlagLevel, val kind: FlagKind, val reason: String, val raisedAtMillis: Long, val clearedAtMillis: Long? = null)`
  - `data class Visit(val date: String, val questionnaire: String? = null /* "PHQ-2" or "PHQ-9" */, val score: Int? = null)`
  - `data class Consent(val signal: String, val granted: Boolean, val changedAtMillis: Long)`
  - `object FirestoreJson { val json: Json; fun <T> encode(serializer: KSerializer<T>, value: T): Map<String, Any?> }`
- Collections, all under `patients/{patientId}`: `daily/{date}`, `consents/{signal}`, `checkIns/{id}`, `summaries/{checkInId}`, `suggestions/{id}`, `flags/{id}`, `visits/{id}`, `digests/{isoWeek}`. Top level: `mail/{auto}` (Trigger Email extension). Write this list and the fields above into `docs/firestore-schema.md`.

- [ ] **Step 1: Create the project** with the Kotlin Multiplatform wizard (Android, iOS, shared UI), then add the `core` module with JVM, Android and iOS targets. `shared` depends on `core`. `MainActivity` shows the shared "Companion" screen.
- [ ] **Step 2: Write the failing test** `ModelsSerializationTest`:
```kotlin
@Test fun dailyDocKeepsNulls() {
    val m = FirestoreJson.encode(DailyDoc.serializer(), DailyDoc("2026-11-13",
        mapOf("sleepMinutes" to 420.0, "steps" to null), mapOf("sleepMinutes" to -1.2), -0.4))
    assertEquals(setOf("date", "values", "vsBaseline", "composite", "demoOverride"), m.keys)
    assertTrue((m["values"] as Map<*, *>).containsKey("steps"))   // nulls are kept, not dropped
}
@Test fun flagEnumsSerializeLowercase() {
    val m = FirestoreJson.encode(Flag.serializer(), Flag(FlagLevel.red, FlagKind.sleep_collapse, "r", 1L))
    assertEquals("red", m["level"]); assertEquals("sleep_collapse", m["kind"])
}
@Test fun signalKeysAreUnique() = assertEquals(Signal.entries.size, Signal.entries.map { it.key }.toSet().size)
```
- [ ] **Step 3: Run** `./gradlew :core:jvmTest --tests "*ModelsSerializationTest"`. Expected: FAIL (unresolved references).
- [ ] **Step 4: Implement** `Models.kt` and `FirestoreJson.kt` (`Json { encodeDefaults = true; explicitNulls = true }`), then `types.ts` with the same fields.
- [ ] **Step 5: Run the tests**, `./gradlew :androidApp:assembleDebug`, and build `iosApp` once in Xcode. Expected: PASS and both build.
- [ ] **Step 6: `firebase init`** in `firebase/` (Firestore, Functions TypeScript, Hosting public dir `hosting`, Emulators: firestore, functions, auth). Commit `feat: scaffold KMP app and firebase with shared data contract`.

---

### Task 2: Hour-0 spikes (throwaway)

**Files:**
- Create: `docs/spike-results.md`, and fixtures under `core/src/commonTest/resources/fixtures/`. Spike code stays on branch `spike/h0`.

**Interfaces:**
- Produces `docs/spike-results.md` recording:
  1. Whether `gemini-3.8-live` answers over the raw WebSocket, and the exact JSON messages used: setup, audio in, audio out, transcripts, tool call, tool response, interruption.
  2. The ephemeral token request body that locks model, system instruction and tools, and the token's lifetime.
  3. Which Health Connect record types hold Samsung data, especially `HeartRateVariabilityRmssdRecord`.
  4. The request and response of `lookupWeather`, `searchText` and `computeRoutes` on `mapstools.googleapis.com`.
  5. The narrowest Calendar scope that allows `freeBusy`, `events.list` and `events.insert` through `Identity.getAuthorizationClient`.
  6. Whether usage statistics give usable screen-on spans on the S24+.
  7. Whether Live audio in and out works on an iPhone.
  8. The Firestore region.

- [ ] **Step 1: Live spike on the S24+.** Deploy a throwaway callable that calls `POST /v1beta/auth_tokens`. From shared Kotlin, open `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained` with the token, stream `AudioRecord` frames, play replies through `AudioTrack`, and register one dummy tool. Pass: a 30-second natural conversation and one tool round trip. Endpoints and limits are in [gemini research](../research/gemini-api.md).
- [ ] **Step 2: Fallback check.** If Step 1 fails after two hours, repeat it with the Firebase AI Logic SDK on Android and record which path works. The rest of the plan talks to a `LiveClient` interface, so only Task 10 changes.
- [ ] **Step 3: Health Connect spike.** Enable Samsung Health sync to Health Connect. Read 14 days of steps, sleep sessions, heart rate, resting heart rate and HRV. Record what is present.
- [ ] **Step 4: Maps and Calendar spike.** Call each endpoint once and save the raw JSON as `fixtures/{weather,places,route,calendar_freebusy,calendar_events}.json` for Tasks 9 and 14.
- [ ] **Step 5: iOS audio spike.** Run the Step 1 conversation on an iPhone with `AVAudioEngine`. Record pass or fail; a fail narrows Task 21 to typed Check-ins.
- [ ] **Step 6: Write `docs/spike-results.md`.** If HRV is absent write "HRV: seeded". Commit `docs: record hour-0 spike results and API fixtures`.

---

### Task 3: Baseline

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/baseline/Baseline.kt`
- Test: `core/src/commonTest/kotlin/app/depressify/core/baseline/BaselineTest.kt`

**Interfaces:**
- Consumes: `Signal`.
- Produces:
  - `data class Day(val date: String, val values: Map<String, Double?>)`
  - `object Baseline { const val WINDOW_DAYS = 14; const val MIN_DAYS = 5`
  - `fun compare(history: List<Day>, today: Day): Map<Signal, Double?>` (how far today is from the Patient's usual, in standard deviations, sign as measured)
  - `fun oriented(c: Map<Signal, Double?>): Map<Signal, Double?>` (negated where `!higherIsBetter`, so negative means worse)
  - `fun composite(oriented: Map<Signal, Double?>): Double?` (mean of non-null values; null if none) `}`
- Rule: use only the `WINDOW_DAYS` days strictly before `today.date` with a non-null value for that Signal. Fewer than `MIN_DAYS` gives null. `std = max(sampleStd, 0.05 * |mean|, 1e-3)`.

- [ ] **Step 1: Write failing tests:** `nullWithFewerThanFiveValidDays`, `missingTodayGivesNullNotZero`, `constantHistoryUsesStdFloor` (five days of 420, today 399 gives −1.0), `onlyLast14PriorDaysCount`, `orientedFlipsHighIsBadSignals`, `compositeIgnoresNulls`.
- [ ] **Step 2: Run** `./gradlew :core:jvmTest --tests "*BaselineTest"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): personal 14-day baseline`.

---

### Task 4: Attention flag rules

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/flag/FlagRules.kt`, `.../flag/FlagPolicy.kt`
- Test: `core/src/commonTest/kotlin/app/depressify/core/flag/FlagRulesTest.kt`, `.../flag/FlagPolicyTest.kt`

**Interfaces:**
- Consumes: `Baseline.composite`, `Signal`, `CheckIn`, `Flag`, `FlagLevel`, `FlagKind`.
- Produces:
  - `data class FlagInput(val todayValues: Map<Signal, Double?>, val orientedHistory: List<Map<Signal, Double?>> /* oldest to newest, last is today */, val stepsLast24h: Double?, val screenMinutesLast24h: Double?, val recentMoods: List<Int?> /* newest last */, val crisisActive: Boolean)`
  - `data class FlagDraft(val level: FlagLevel, val kind: FlagKind, val reason: String)`
  - `data class FlagAssessment(val level: FlagLevel, val reasons: List<String>, val drafts: List<FlagDraft>)`
  - `object FlagRules { fun assess(input: FlagInput): FlagAssessment }`
  - `object FlagPolicy { fun filterNew(drafts: List<FlagDraft>, openFlags: List<Flag>): List<FlagDraft> }` (drops a draft whose `kind` already has an uncleared flag)
- Rules on the phone (thresholds marked * are starting values, kept in `FlagThresholds`):
  - **red `sleep_collapse`**: today's sleep under 180 minutes*, or oriented sleep at or below −2.5*. Only when sleep is non-null.
  - **red `inactive`**: `stepsLast24h == 0.0` and `screenMinutesLast24h == 0.0`, both non-null.
  - **red `crisis`**: `crisisActive`. No new draft here; Task 7 writes that flag.
  - **amber `poor_sleep`**: oriented sleep at or below −1.0* on each of the last 3 nights, all non-null.
  - **amber `low_mood`**: the last 3 entries of `recentMoods` are all non-null and at or below 2.
  - **amber `drift`**: composite at or below −1.0* on each of the last 3* days.
  - Otherwise green. Any red draft makes the level red. Reasons are plain sentences such as "Slept under 3 hours". No number that reads as a score is ever included.
- Raised elsewhere: `decline`, `unassessed` and the Decisions backstop for `crisis` (Task 13); `silent` (Task 15).

- [ ] **Step 1: Write failing tests**, one per rule plus the review-focus cases: `missingSleepNeverRaisesSleepCollapse`, `sleepUnder180IsRed`, `zeroStepsAndZeroScreenIsRed`, `nullStepsIsNotInactive`, `threeLowMoodsIsAmber`, `twoLowMoodsIsGreen`, `missingMoodBreaksTheRun`, `poorSleepNeedsThreeNights`, `driftNeedsThreeConsecutiveDays`, `crisisForcesRed`, `reasonsContainNoDecimalNumbers`, `FlagPolicyTest.dropsKindWithOpenFlag`, `FlagPolicyTest.keepsDifferentKind`.
- [ ] **Step 2: Run** `./gradlew :core:jvmTest --tests "*flag*"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): attention flag rules with reasons`.

---

### Task 5: Nudge rules

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/nudge/NudgeRules.kt`
- Test: `.../core/nudge/NudgeRulesTest.kt`

**Interfaces:**
- Produces:
  - `enum class NudgeReason { no_check_in_today, free_hour_good_weather, rough_nights }`
  - `data class NudgeInput(val now: LocalDateTime, val lastNudgeDate: LocalDate?, val checkedInToday: Boolean, val quietHoursStart: Int, val quietHoursEnd: Int, val busyNow: Boolean, val freeHourAhead: Boolean, val goodWeather: Boolean?, val lastTwoNightsSleepOriented: List<Double?>, val timeAtHomeVsBaseline: Double?, val lateScreenVsBaseline: Double?)`
  - `object NudgeRules { fun decide(input: NudgeInput): NudgeReason? }`
- Rule: return null if a Nudge was already sent today, if `now` is inside quiet hours (the window may cross midnight), or if `busyNow`. Otherwise the first that applies:
  1. `rough_nights`: both nights at or below −1 and (time at home above 1* or late screen above 1*).
  2. `free_hour_good_weather`: `freeHourAhead && goodWeather == true`.
  3. `no_check_in_today`: `!checkedInToday` and the hour is 17 or later*.

- [ ] **Step 1: Write failing tests:** `noNudgeTwiceSameDay`, `nudgesAgainNextDay`, `noNudgeInQuietHoursAcrossMidnight`, `noNudgeWhileBusy`, `roughNightsNeedBothNights` (`listOf(-1.5, null)` gives null for that reason), `roughNightsNeedHomeOrScreen`, `freeHourNeedsKnownGoodWeather` (null weather does not count), `eveningReminderOnlyAfterFive`, `roughNightsWinsOverReminder`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): once-a-day nudge rules`.

---

### Task 6: Learning what helps

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/learn/SuggestionRanker.kt`
- Test: `.../core/learn/SuggestionRankerTest.kt`

**Interfaces:**
- Consumes: `Suggestion`, `SuggestionKind`.
- Produces:
  - `object Outcomes { fun score(tried: Boolean?, felt: Int?, objectiveChange: Double?): Double? }`. Null if `tried` is null. `tried == false` gives −0.2*. Otherwise `0.7 * (((felt ?: 3) - 3) / 2.0) + 0.3 * (objectiveChange ?: 0.0).coerceIn(-1.0, 1.0)`. `objectiveChange` is that day's oriented steps comparison.
  - `data class KindScore(val kind: SuggestionKind, val mean: Double, val n: Int)`
  - `data class Guidance(val preferred: List<KindScore>, val tryNew: SuggestionKind?)`
  - `class SuggestionRanker(private val rand: () -> Double) { fun rank(history: List<Suggestion>): List<KindScore>; fun guidance(history: List<Suggestion>): Guidance }`
- `rank` uses only non-null `outcomeScore`, sorted by mean then count, both descending. `guidance`: preferred is the top 3. If `rand() < 0.2`, `tryNew` is an untried kind in enum order, or else the least-tried; otherwise null.

- [ ] **Step 1: Write failing tests:** `scoreNullUntilAnswered`, `notTriedIsSlightlyNegative`, `felt5NoChangeIs0_7`, `scoreClampsObjectiveChange`, `rankIgnoresUnscored`, `rankTieBreaksByCount`, `guidanceTop3Only`, `triesNewWhenRandBelowPoint2`, `noNewWhenRandAbovePoint2`, `emptyHistoryGivesEmptyPreferred`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): learn which suggestions help`.

---

### Task 7: Tool catalog, dispatcher and Check-in recorder

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/companion/ToolCatalog.kt`, `.../companion/ToolBackend.kt`, `.../companion/ToolDispatcher.kt`, `.../companion/CheckInRecorder.kt`
- Test: `.../core/companion/ToolDispatcherTest.kt`

**Interfaces:**
- Consumes: `VoiceCue`, `SuggestionKind`.
- Produces:
  - `enum class ParamType { STRING, INTEGER, NUMBER }`, `data class ParamSpec(name, type, description, required = true, enumValues: List<String>? = null)`, `data class ToolSpec(name, description, params)`
  - `object ToolCatalog { val all: List<ToolSpec> }` with exactly these ten:
    - `get_weather()`
    - `find_places(query: STRING)`
    - `get_walking_route(place_id: STRING)`
    - `get_free_time(date: STRING yyyy-MM-dd)`
    - `book_calendar_event(title: STRING, start: STRING ISO, end: STRING ISO, location: STRING optional)`. Its description says: call only after the Patient has agreed aloud.
    - `get_health_summary(days: INTEGER)`
    - `play_music(query: STRING)`
    - `note_voice_cue(label: STRING, intensity: INTEGER 1–5, heard: STRING)`
    - `record_suggestion(kind: STRING enum[SuggestionKind names], details: STRING)`
    - `raise_crisis(reason: STRING)`
  - `interface ToolBackend` with suspend functions: `weather(): JsonObject`, `places(query: String): JsonObject`, `walkingRoute(placeId: String): JsonObject`, `freeTime(date: LocalDate): JsonObject`, `bookEvent(title: String, start: String, end: String, location: String?): JsonObject`, `healthSummary(days: Int): JsonObject`, `playMusic(query: String): JsonObject`, `saveSuggestion(kind: SuggestionKind, details: String): String`, `markBooked(suggestionId: String)`, `raiseCrisisFlag(reason: String)`
  - `class CheckInRecorder(val checkInId: String, private val clock: () -> Long) { fun addTranscript(speaker: String, text: String); fun addVoiceCue(c: VoiceCue); fun addSuggestion(id: String, kind: SuggestionKind, details: String); fun markCrisis(); fun toDraft(): CheckInDraft }`
  - `data class CheckInDraft(val checkInId: String, val startedAtMillis: Long, val transcript: List<Pair<String, String>>, val voiceCues: List<VoiceCue>, val suggestions: List<Triple<String, SuggestionKind, String>>, val crisis: Boolean)`
  - `class ToolDispatcher(backend: ToolBackend, recorder: CheckInRecorder, onCrisis: () -> Unit) { suspend fun dispatch(name: String, args: JsonObject): JsonObject }`
- Behaviour:
  - Never throws. Unknown name gives `{"error":"unknown_tool"}`. Missing or out-of-range arguments give `{"error":"invalid_args"}` and leave the recorder unchanged. A backend exception gives `{"error":"backend_failed"}`.
  - `raise_crisis` calls `onCrisis()` first, marks the recorder, then `backend.raiseCrisisFlag`. It returns `{"ok":true,"crisis_notice_shown":true}` even if the backend throws.
  - `book_calendar_event` marks the most recent Suggestion in the recorder as booked when the backend succeeds.
  - A JVM test writes `ToolCatalog.all` to `firebase/functions/test/fixtures/tool-catalog.json`, which Task 14 uses to keep the function's tool declarations in step.

- [ ] **Step 1: Write failing tests** with a `FakeBackend` that records call order: `crisisShowsNoticeBeforeBackendEvenIfBackendThrows`, `intensityOutOfRangeIsRejected`, `unknownToolReturnsError`, `voiceCueIsRecorded`, `recordSuggestionReturnsIdAndRecords`, `bookingMarksLastSuggestionBooked`, `backendFailureDoesNotThrow`, `catalogHasTenUniqueTools`, `catalogHasNoQuestionnaireTool` (no tool name or parameter contains "phq").
- [ ] **Step 2: Run** `./gradlew :core:jvmTest --tests "*ToolDispatcherTest"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): companion tools with crisis-first dispatch`.

---

### Task 8: Brief builder

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/companion/BriefBuilder.kt`
- Test: `.../core/companion/BriefBuilderTest.kt`

**Interfaces:**
- Consumes: `Signal`, `Guidance` (Task 6).
- Produces:
  - `data class BriefContext(val intakeHighlights: String, val recentSummaryLines: List<String>, val todayOriented: Map<Signal, Double?>, val weatherLine: String?, val calendarLine: String?, val guidance: Guidance, val lastSuggestion: Pair<SuggestionKind, String>?, val firstCheckIn: Boolean, val localTime: LocalDateTime)`
  - `object BriefBuilder { fun build(ctx: BriefContext): String; fun describe(signal: Signal, oriented: Double?): String? }`
- `describe`: at or below −1 gives "<phrase> worse than usual"; at or above 1 gives "better than usual"; otherwise null. The Brief never contains comparison numbers.
- The Brief must contain:
  - the shape: greet with something from the context, ask how the last Suggestion went, listen, offer one Suggestion and get a commitment, ask for mood, energy and sleep quality from 1 to 5, close
  - "about 3 minutes", and an instruction to wrap up gently before 8 minutes
  - tone: calm, warm, short sentences, one question at a time, never nag
  - call `note_voice_cue` when the voice shows something, and adapt
  - call `record_suggestion` for the Suggestion made; call `book_calendar_event` only after the Patient agrees aloud
  - the preferred kinds, plus a try-something-new line only when `tryNew != null`
  - safety: "If the person expresses thoughts of harming themselves, call raise_crisis immediately, stay calm and present, and point them to the call buttons on screen. Do not counsel."
  - "You are a wellbeing companion, not a clinician. Never diagnose and never advise on treatment or medication. Do not ask clinical questionnaire questions."
  - when `firstCheckIn`: an instruction to say it is an AI and not a clinician
  - when place results are used: say that they come from Google Maps
  - the Intake highlights, weather line and calendar line

- [ ] **Step 1: Write failing tests:** `includesSafetyInstruction`, `includesNotAClinicianRule`, `includesIntake`, `describesBadSleepWithoutNumbers`, `omitsNullSignals`, `tryNewLineOnlyWhenSet`, `asksAboutLastSuggestion`, `disclosureOnlyOnFirstCheckIn`, `asksForThreeRatings`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): brief builder`.

---

### Task 9: Map and calendar tool clients

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/tools/{TimeWindows.kt, MapToolParsers.kt, CalendarClient.kt}`
- Create: `shared/src/commonMain/kotlin/app/depressify/tools/{MapToolClient.kt, CalendarAuth.kt}`, `shared/src/androidMain/.../tools/AndroidCalendarAuth.kt`
- Test: `core/src/commonTest/kotlin/app/depressify/core/tools/{TimeWindowsTest.kt, ParsersTest.kt}` (fixtures from Task 2)

**Interfaces:**
- Produces:
  - `data class TimeWindow(val start: Instant, val end: Instant)`
  - `object TimeWindows { fun free(busy: List<TimeWindow>, dayStart: Instant, dayEnd: Instant, minMinutes: Long = 30): List<TimeWindow> }`
  - `object MapToolParsers { fun weather(json: JsonObject): JsonObject /* conditions, temperatureC, goodForWalk, daylight */; fun places(json: JsonObject): JsonObject /* up to 5 of {placeId, name, mapsUrl} plus the summary text */; fun route(json: JsonObject): JsonObject /* durationMin, distanceM */ }`
  - `class MapToolClient(functions: FirebaseFunctions)` calling the `mapTool` callable (Task 14) with `{tool, args, lat, lng}`. The Maps key never reaches the phone.
  - `class CalendarClient(http: HttpClient, token: suspend () -> String)`:
    - `suspend fun freeTime(date: LocalDate, zone: TimeZone): JsonObject` (`POST https://www.googleapis.com/calendar/v3/freeBusy` on `primary`, day 08:00–21:00*, then `TimeWindows.free`)
    - `suspend fun bookEvent(title: String, start: String, end: String, location: String?): JsonObject` (`POST /calendars/primary/events`; returns `id`, `htmlLink`)
    - `suspend fun busyNow(now: Instant): Boolean`
  - `interface CalendarAuth { suspend fun token(): String? }`. Android uses `Identity.getAuthorizationClient` with the scope recorded in the spike. iOS returns null for the demo, and calendar tools then answer `{"error":"calendar_not_connected"}`.

- [ ] **Step 1: Write failing tests:** `freeFindsGapsAndDropsShortOnes`, `freeEmptyWhenFullyBusy`, `weatherParsesFixture`, `placesParsesUpToFiveWithLinks`, `routeParsesDurationMinutes`, and with Ktor `MockEngine`: `freeTimeCallsFreeBusyWithBearerToken`, `bookEventReturnsLink`.
- [ ] **Step 2: Run** `./gradlew :core:jvmTest --tests "*tools*"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: map and calendar tool clients`.

---

### Task 10: Gemini Live client and audio

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/live/{LiveClient.kt, LiveProtocol.kt}`
- Create: `shared/src/commonMain/kotlin/app/depressify/live/{KtorLiveClient.kt, AudioIO.kt}`, `shared/src/androidMain/.../live/AndroidAudioIO.kt`, `shared/src/iosMain/.../live/IosAudioIO.kt` (stub until Task 21)
- Test: `core/src/commonTest/kotlin/app/depressify/core/live/LiveProtocolTest.kt`

**Interfaces:**
- Consumes: `ToolSpec`, `docs/spike-results.md` (the exact messages).
- Produces:
  - `sealed interface LiveEvent { AudioOut(pcm24k: ByteArray); InputText(text: String); OutputText(text: String); ToolCall(id: String, name: String, args: JsonObject); Interrupted; TurnComplete; Closed(reason: String?) }`
  - `interface LiveClient { suspend fun connect(token: String); suspend fun sendAudio(pcm16k: ByteArray); suspend fun sendText(text: String); val events: Flow<LiveEvent>; suspend fun sendToolResponse(id: String, name: String, result: JsonObject); suspend fun close() }`
  - `object LiveProtocol { fun audioMessage(pcm16k: ByteArray): String; fun textMessage(text: String): String; fun toolResponseMessage(id: String, name: String, result: JsonObject): String; fun parse(serverMessage: String): List<LiveEvent> }`. One server message can carry several parts; `parse` returns all of them.
  - `class KtorLiveClient(http: HttpClient) : LiveClient`. The model, Brief and tools are locked into the token by Task 14, so `connect` sends no system instruction.
  - `interface AudioIO { val frames: Flow<ShortArray>; fun play(pcm24k: ByteArray); fun stopPlayback(); val companionSpeaking: Boolean; fun close() }`
  - `AndroidAudioIO`: `AudioRecord(VOICE_COMMUNICATION, 16000, MONO, PCM_16BIT)` with `AcousticEchoCanceler` when available, `AudioTrack` at 24 kHz, audio focus, and a microphone foreground service while a Check-in runs.

- [ ] **Step 1: Write failing tests** against the messages saved in the spike: `parsesAudioAndTranscriptInOneMessage`, `parsesToolCall`, `parsesInterruption`, `unknownMessageGivesNoEvents`, `audioMessageIsBase64Pcm16k`, `toolResponseCarriesCallId`.
- [ ] **Step 2: Run** `./gradlew :core:jvmTest --tests "*LiveProtocolTest"`. Expected: FAIL.
- [ ] **Step 3: Implement** `LiveProtocol`, `KtorLiveClient` and `AndroidAudioIO`. If the spike chose the fallback, implement `FirebaseLiveClient` in `androidMain` behind the same interface.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: gemini live client and android audio`.

---

### Task 11: The Check-in

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/checkin/CheckInRunner.kt`
- Create: `shared/src/commonMain/kotlin/app/depressify/checkin/{AppToolBackend.kt, CheckInViewModel.kt, CheckInScreen.kt, SuggestionCard.kt}`, `shared/src/commonMain/.../data/{PatientRepo.kt, PatientSession.kt}`
- Test: `core/src/commonTest/kotlin/app/depressify/core/checkin/CheckInRunnerTest.kt`

**Interfaces:**
- Consumes: `LiveClient`, `AudioIO`, `ToolDispatcher`, `CheckInRecorder`, `BriefBuilder`, `SuggestionRanker`, Task 9 clients, `startCheckIn` and `finishCheckIn` callables (Tasks 13, 14).
- Produces:
  - `class CheckInRunner(live: LiveClient, audio: AudioIO, dispatcher: ToolDispatcher, recorder: CheckInRecorder) { suspend fun run(token: String); suspend fun sendTyped(text: String); suspend fun end(): CheckInDraft }`
  - Behaviour: each microphone frame goes to `live.sendAudio`. `AudioOut` goes to `audio.play`; `Interrupted` calls `audio.stopPlayback()`. Transcripts go to the recorder as "patient" or "companion". A `ToolCall` goes through the dispatcher and back with `sendToolResponse`. `Closed` before `end()` surfaces a retry state and keeps the draft.
  - `class PatientRepo(db: FirebaseFirestore, patientId: String)` (GitLive SDK) with: `patient()`, `heartbeat(nowMillis)`, `writeDaily(d)`, `days(n)`, `saveCheckIn(c)`, `saveSuggestion(s)`, `updateSuggestion(id, fields)`, `suggestions()`, `recentSummaries(n)`, `summaries(): Flow<List<Summary>>`, `addFlag(f)`, `openFlags()`, `setFlagOnPatient(level, reasons)`, `consents()`, `setConsent(c)`, `deleteSignal(signal)`.
  - `PatientSession`: anonymous sign-in; `patientId = uid`. First run creates `PatientDoc(displayName = "Live patient", clinicianEmail = <demo Clinician>)`. In a demo build a picker lets the tester act as a Demo Patient instead.
  - `AppToolBackend` implements `ToolBackend`: map tools through `MapToolClient` with the last known location, calendar through `CalendarClient`, `healthSummary` from `PatientRepo.days` and `BriefBuilder.describe`, `playMusic` through a platform deep link, `saveSuggestion` and `raiseCrisisFlag` through `PatientRepo`.
  - `CheckInViewModel`: builds `BriefContext`, calls `startCheckIn` with the Brief, runs `CheckInRunner`, enforces the 8-minute cap, and on end calls `finishCheckIn` with the draft, then clears the draft from memory.
  - `CheckInScreen`: a "Talk" and "I'm done" button, a text field for typing, the live transcript, Suggestion cards (a place card opens its Google Maps link), a standing line "Place results come from Google Maps", and the Crisis notice overlay (Task 12).

- [ ] **Step 1: Write failing tests** with `FakeLiveClient` and `FakeAudioIO`: `micFramesGoToLive`, `toolCallIsDispatchedAndAnswered`, `interruptStopsPlayback`, `transcriptsRecordedBySpeaker`, `typedTextIsSentAndRecorded`, `droppedConnectionKeepsDraft`, `silentCheckInStillReturnsDraft`.
- [ ] **Step 2: Run** `./gradlew :core:jvmTest --tests "*CheckInRunnerTest"`. Expected: FAIL.
- [ ] **Step 3: Implement** the runner, then the shared classes.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify on the S24+.** A 3-minute Check-in in which the Companion mentions sleep from real data, calls `get_weather` and `find_places`, shows a Suggestion card, and books a calendar event that appears in Google Calendar.
- [ ] **Step 6: Commit** `feat: live voice check-in with tools and suggestion cards`.

---

### Task 12: Crisis notice

**Files:**
- Create: `shared/src/commonMain/kotlin/app/depressify/crisis/{CrisisNumbers.kt, CrisisController.kt, CrisisNotice.kt, Dialler.kt}`, `shared/src/androidMain/.../crisis/AndroidDialler.kt`, `shared/src/iosMain/.../crisis/IosDialler.kt`
- Test: `shared/src/commonTest/kotlin/app/depressify/crisis/CrisisControllerTest.kt`

**Interfaces:**
- Consumes: `PatientRepo.addFlag`, `PatientRepo.setFlagOnPatient`.
- Produces:
  - `object CrisisNumbers { const val MOCK = "000 000 0000"; const val LABEL = "Demo crisis line (mock)" }`
  - `interface Dialler { fun openDialler(number: String) }`. Android uses `Intent.ACTION_DIAL`; iOS opens a `tel:` URL. Neither places the call.
  - `class CrisisController(repo: PatientRepo, clock: () -> Long, scope: CoroutineScope) { val visible: StateFlow<Boolean>; fun onCrisis(reason: String) }`. Sets `visible = true` synchronously, then launches the flag write (`Flag(red, crisis, ...)` and the level on the Patient). Firestore's offline queue carries the write when the phone is offline.
  - `CrisisNotice`: full screen over the Check-in with two large buttons, both dialling the mock number ("Call crisis line" and "Call emergency number"), and "Back to conversation".

- [ ] **Step 1: Write failing tests:** `noticeVisibleBeforeFlagWriteCompletes` (a repo fake that suspends forever), `flagWrittenAsRedCrisis`, `secondCrisisDoesNotDuplicateOpenFlag`.
- [ ] **Step 2: Run** `./gradlew :shared:testDebugUnitTest --tests "*CrisisControllerTest"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Also run `grep -c CALL_PHONE androidApp/src/main/AndroidManifest.xml`. Expected: `0`.
- [ ] **Step 5: Commit** `feat: one-tap crisis notice with instant red flag`.

---

### Task 13: Finish Check-in function

**Files:**
- Create: `firebase/functions/src/{finishCheckIn.ts, summary.ts, decisions.ts, models.ts}`
- Test: `firebase/functions/test/{summary.test.ts, decisions.test.ts}`

**Interfaces:**
- Consumes: `types.ts`, `CheckInDraft` as JSON, `@google/genai` 3.2.0 or newer.
- Produces:
  - `summary.ts`:
    - `buildSummaryPrompt(draft, todayLines: string[], lastSuggestion): string` and `summarySchema` (fields: `mood`, `energy`, `sleepQuality` as integers 1–5 or null; `sleepLine`; `themes`; `suggestion`; `previousOutcome`; `felt` 1–5 or null; `quotes`)
    - `parseSummary(json: string | null, draft): Extracted`, which takes Voice cues from the draft and not from the model, caps `quotes` at 3 of at most 200 characters, rejects ratings outside 1–5 as null, and falls back to empty themes when the JSON is missing or malformed
  - `decisions.ts`:
    - `QUESTIONS`: three `noul` questions with keys `crisis`, `decline`, `tried_last_suggestion`
    - `route(answers | "refused" | "failed", draftCrisis: boolean): { flags: FlagDraft[]; tried: boolean | null }`:
      - `crisis` at or above 0.5*, or `draftCrisis`: red `crisis`
      - `decline` at or above 0.6*: amber `decline`
      - `"refused"` (HTTP 400 with a safety reason): amber `unassessed`, reason "could not be assessed automatically"
      - `"failed"` (timeout or other error): no flag from this path
      - `tried` is true at or above 0.6*, false at or below 0.4*, otherwise null
  - `finishCheckIn` = `onCall` (the caller's uid must equal `patientId`, or the Patient must be `synthetic` in a demo project). Input `{patientId, draft, todayLines, lastSuggestionId}`. It:
    1. Calls `TEXT_MODEL` with `store: false` and the schema, 15-second timeout.
    2. Calls `POST /v1beta/decisions` with `DECISION_MODEL` and the transcript serialised as text.
    3. Writes `summaries/{checkInId}`, updates `checkIns/{checkInId}` with the ratings, updates the last Suggestion with `tried` and `felt`, writes new flags (skipping kinds already open), and sets the level and reasons on the Patient.
    4. Returns `{ok: true}`. The draft is never written or logged.

- [ ] **Step 1: Write failing tests:** `promptForbidsDiagnosisAndQuestionnaires`, `parseValidJson`, `malformedJsonFallsBack`, `nullJsonFallsBack`, `ratingOutOfRangeBecomesNull`, `quotesCappedTo3x200`, `voiceCuesComeFromDraftNotModel`, `crisisAnswerGivesRed`, `draftCrisisGivesRedEvenIfModelSaysNo`, `declineGivesAmber`, `refusalGivesAmberUnassessed`, `failureGivesNoFlag`, `triedIsNullInTheMiddle`, `noConsoleCallMentionsTranscript` (spy on `console` and `logger` through a full run with fakes; assert no argument contains transcript text).
- [ ] **Step 2: Run** `cd firebase/functions && npx vitest run test/summary.test.ts test/decisions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Confirm the Decisions request shape against [gemini research](../research/gemini-api.md) before writing the call.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify.** After a Check-in on the phone, `summaries/{checkInId}` appears within about 10 seconds, and the function logs contain no transcript text.
- [ ] **Step 6: Commit** `feat(functions): summary, ratings, outcome and flag judgment`.

---

### Task 14: Start Check-in, map tool and Intake functions

**Files:**
- Create: `firebase/functions/src/{startCheckIn.ts, mapTool.ts, extractIntake.ts}`
- Modify: `firebase/functions/src/index.ts`
- Test: `firebase/functions/test/{startCheckIn.test.ts, mapTool.test.ts}`

**Interfaces:**
- Produces:
  - `startCheckIn` = `onCall`. Input `{patientId, brief}`. Calls `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens` locking `LIVE_MODEL`, the Brief as system instruction, the tool declarations, audio output, and input and output transcription. Returns `{token, checkInId}`. The tool declarations live in `functions/src/tools.ts` and must match `ToolCatalog` (a test compares names and parameters against a JSON export from Task 7).
  - `buildTokenRequest(brief: string): object` (pure, tested)
  - `mapTool` = `onCall`. Input `{tool: "weather" | "places" | "route", args, lat, lng}`. Calls `https://mapstools.googleapis.com/v1:lookupWeather`, `:searchText` or `:computeRoutes` with `X-Goog-Api-Key`, and returns the raw JSON. Rejects unknown tools and signed-out callers.
  - `buildMapRequest(tool, args, lat, lng): { url: string; body: object }` (pure, tested against the spike fixtures)
  - `extractIntake` = `onCall` (Clinician only). Input `{patientId, reportText}`. Calls `TEXT_MODEL` with `store: false` for highlights of at most 120 words, and writes `patients/{id}.intakeHighlights`.

- [ ] **Step 1: Write failing tests:** `tokenRequestLocksModelBriefAndTools`, `tokenToolsMatchCatalogExport`, `mapRequestForPlacesUsesSearchText`, `mapRequestForRouteIsWalking`, `unknownMapToolRejected`.
- [ ] **Step 2: Run** `npx vitest run test/startCheckIn.test.ts test/mapTool.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Deploy** `firebase deploy --only functions` and call each from the emulator shell.
- [ ] **Step 6: Commit** `feat(functions): live token, map tools and intake`.

---

### Task 15: Security rules, red flag email, silence check, Digest

**Files:**
- Create: `firebase/firestore.rules`, `firebase/functions/src/{alerting.ts, digest.ts}`
- Modify: `firebase/functions/src/index.ts`
- Test: `firebase/functions/test/{alerting.test.ts, digest.test.ts, rules.test.ts}`

**Interfaces:**
- Produces:
  - `alerting.ts`:
    - `buildFlagEmail(flag, patient, patientId): { subject: string; text: string } | null` (null unless red; subject `[RED]` or `[CRISIS]` plus the display name; text is the reason and the dashboard link)
    - `shouldFlagSilent(p: PatientDoc, hasOpenSilentFlag: boolean, nowMs: number): boolean` (true only when not synthetic, `lastSeenAtMillis` is set and older than 24 hours, and no silent flag is open)
  - `onFlagCreated` = `onDocumentCreated("patients/{pid}/flags/{id}")`: writes `mail/{auto}` when the email is not null.
  - `checkSilence` = `onSchedule("every 60 minutes")`: adds a red `silent` flag with reason "No data from phone for over 24 hours" and sets the level on the Patient.
  - `digest.ts`: `isoWeekKey(d: Date): string`, `buildDigestPrompt(patient, summaries, days): string`, `weeklyDigest` = `onSchedule({schedule: "every monday 07:00", timeZone: "Europe/Helsinki"})`, `generateDigestNow` = `onCall` (Clinician only). Both write `patients/{id}/digests/{week}` using `TEXT_MODEL` with `store: false`.
  - Rules:
    - A Patient (`request.auth.uid == patientId`) reads and writes their own document and subcollections, except `visits` and `digests`, which they may only read.
    - A Clinician (`request.auth.token.email == patient.clinicianEmail`) reads everything for their Patients, writes `visits`, `tmsEndDate` and `displayName`, and may set only `clearedAtMillis` on a flag and reset `flagLevel` and `flagReasons`.
    - Any signed-in user may read and write a Patient whose `synthetic` is true. This is the demo shortcut that lets a tester act as a Demo Patient.
    - `mail` is written by functions only.

- [ ] **Step 1: Write failing tests:** `amberFlagSendsNoEmail`, `crisisSubjectStartsWithCRISIS`, `silent23hFalse`, `silent25hTrue`, `syntheticNeverSilent`, `openSilentFlagNotDuplicated`, `neverSeenNotSilent`, `weekKeyForNov13_2026IsW46`, `digestPromptForbidsDiagnosis`, `emptyWeekSaysNoCheckIns`; rules: `patientCannotReadOtherPatient`, `patientCannotWriteVisits`, `clinicianReadsOwnPatient`, `clinicianCannotWriteDaily`, `clinicianCanOnlyClearFlag`, `anyoneSignedInCanActAsSyntheticPatient`, `signedOutReadsNothing`.
- [ ] **Step 2: Run** `npx vitest run test/alerting.test.ts test/digest.test.ts` and `cd firebase && firebase emulators:exec --only firestore "cd functions && npx vitest run test/rules.test.ts"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Install the "Trigger Email from Firestore" extension on the `mail` collection with team SMTP credentials.
- [ ] **Step 4: Run both commands.** Expected: PASS.
- [ ] **Step 5: Deploy** rules and functions. Create a red flag in the console. Expected: an email arrives at the Clinician address.
- [ ] **Step 6: Commit** `feat(firebase): rules, red flag email, silence check, digest`.

---

### Task 16: Demo Patient seed

**Files:**
- Create: `firebase/seed/{synth.mjs, seed.mjs, package.json}`
- Test: `firebase/seed/test/synth.test.mjs`

**Interfaces:**
- Produces:
  - `makePatient(profile: "steady" | "declining" | "rarely_checks_in", name, clinicianEmail, today): { patient, daily[42], checkIns, summaries, suggestions, flags, visits[1] }`. Deterministic, `synthetic: true`, `healthSource: "synthetic"`.
  - Each Patient has `tmsEndDate` 42 days before `today`, one Visit 21 days before `today` with a Questionnaire score, and Intake highlights that begin "Synthetic demo data."
  - `steady`: stable Signals, Check-ins most days, moods 3 to 5, green.
  - `declining`: Signals and moods worsen over the last 10 days; amber `poor_sleep` and `low_mood` flags, then a red `sleep_collapse` flag in the last two days.
  - `rarely_checks_in`: about one Check-in a week, a few missing Signal days, green or amber.
  - Daily documents include HRV, which covers the "HRV: seeded" case. Suggestions carry `outcomeScore` so "what works" has data.
  - `seed.mjs` writes the three with firebase-admin, deleting their previous documents first, and honours `FIRESTORE_EMULATOR_HOST`. `CLINICIAN_EMAIL` comes from the environment.
- All values are invented. No open dataset is used.

- [ ] **Step 1: Write failing tests:** `each profile has 42 consecutive daily docs ending today`, `each profile has one visit at day 21 with a questionnaire score`, `declining profile ends red`, `steady profile is green`, `rarely_checks_in has at most 7 check-ins`, `all docs are synthetic`, `suggestions have outcomeScore`, `same inputs give the same output`.
- [ ] **Step 2: Run** `cd firebase/seed && node --test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `CLINICIAN_EMAIL=... node seed.mjs`: three Patients appear in the console.
- [ ] **Step 5: Commit** `feat(seed): three synthetic demo patients`.

---

### Task 17: Dashboard Patient list

**Files:**
- Create: `firebase/hosting/{index.html, styles.css}`, `firebase/hosting/js/{firebase.js, list.js}`, `firebase/hosting/js/lib/{sort.js, banner.js}`, `firebase/hosting/assets/alert.mp3`
- Test: `firebase/hosting/test/{sort.test.mjs, banner.test.mjs}`

**Interfaces:**
- Produces:
  - `sort.js`: `sortPatients(patients, latestFlagAtById)`: red, then amber, then green; then latest flag time descending; then display name.
  - `banner.js`: `newFlagIds(prevIds, flags)` (empty on the first load) and `bannerFlags(flags)` (uncleared red, newest first).
  - `firebase.js`: initialisation and an email and password sign-in form.
  - `list.js`: live listeners on the Clinician's Patients (`where clinicianEmail == auth email`) and a collection-group listener on `flags`. Renders a level chip with reasons, a red banner with a "Clear" button (sets `clearedAtMillis` and resets the Patient's level), and plays `alert.mp3` for each new red flag.

- [ ] **Step 1: Write failing tests:** `redBeforeAmberBeforeGreen`, `sameLevelNewerFlagFirst`, `initialLoadPlaysNoSound`, `newFlagDetected`, `bannerExcludesAmberAndCleared`.
- [ ] **Step 2: Run** `cd firebase/hosting && node --test test/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify.** `firebase serve --only hosting`, sign in, see the three Demo Patients with the declining one first. A red flag created in the console shows the banner and plays the sound within seconds.
- [ ] **Step 6: Commit** `feat(dashboard): patient list sorted by attention flag`.

---

### Task 18: Dashboard Patient page

**Files:**
- Create: `firebase/hosting/patient.html`, `firebase/hosting/js/{detail.js, visit.js, intake.js}`, `firebase/hosting/js/lib/{series.js, timeline.js, whatWorks.js}`
- Test: `firebase/hosting/test/{series.test.mjs, timeline.test.mjs, whatWorks.test.mjs}`

**Interfaces:**
- Produces:
  - `series.js`: `toSeries(dailyDocs, key, field = "values")` returning `{labels, values}` sorted by date with nulls kept as gaps.
  - `timeline.js`:
    - `weekOf(date, tmsEndDate): number` (week 1 starts the day after TMS ended)
    - `phases(tmsEndDate, visits, today): [{start, end, label}]` (from the end of TMS to the first Visit, then Visit to Visit, then the last Visit to today)
    - `moodByWeek(checkIns, tmsEndDate): [{week, mean, n}]`
    - `questionnairePoints(visits, tmsEndDate): [{week, questionnaire, score}]`
  - `whatWorks.js`: `whatWorks(suggestions)` returning `[{kind, mean, n}]` from non-null `outcomeScore`.
  - `detail.js` (`patient.html?id=`), with these sections:
    - header: level and reasons, "Clear flag"
    - Phase timeline: weeks since TMS on the x axis, Visits as vertical markers, weekly Mood rating as a line and Questionnaire scores as labelled points on a second axis
    - Signal trends against Baseline for the selected Phase: sleep, steps, resting heart rate or HRV, time at home, late-night screen time
    - this week's Digest with "Generate now"
    - Summary cards: mood, themes, Voice cues, Suggestion, previous Outcome, quotes
    - "What works for this Patient"
    - flag history
    - Intake highlights
  - `visit.js`: a form to record a Visit (date, optional questionnaire and score) and to set the TMS end date.
  - `intake.js`: paste the report text and call `extractIntake`.

- [ ] **Step 1: Write failing tests:** `seriesSortedByDate`, `seriesKeepsNullGaps`, `weekOneStartsDayAfterTms`, `phasesSplitAtVisits`, `noVisitsGivesOnePhase`, `moodByWeekSkipsNullMoods`, `questionnairePointsCarryTheirKind`, `whatWorksSkipsUnscored`, `whatWorksSortedByMeanThenCount`.
- [ ] **Step 2: Run** `node --test test/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify.** The declining Demo Patient's page shows two Phases split at week 3, the questionnaire point beside the mood line, gaps where data is missing, and a Digest after "Generate now". Run `grep -ri "diagnos\|treatment\|risk score" firebase/hosting/*.html firebase/hosting/js`. Expected: no UI copy matches.
- [ ] **Step 6: Deploy** `firebase deploy --only hosting` and commit `feat(dashboard): patient page with phase timeline`.

---

### Task 19: Signals and Consent on Android

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/sensing/Aggregators.kt`
- Create: `shared/src/commonMain/kotlin/app/depressify/sensing/{HealthReader.kt, LocationSamples.kt, UsageReader.kt, DayBuilder.kt}`, `shared/src/androidMain/.../sensing/{AndroidHealthReader.kt, AndroidHrvReader.kt, LocationSampleWorker.kt, AndroidUsageReader.kt}`, `shared/src/commonMain/.../settings/{SettingsScreen.kt, ConsentController.kt}`
- Modify: `androidApp/src/main/AndroidManifest.xml` (Health Connect read permissions and rationale activity, `ACCESS_FINE_LOCATION`, `PACKAGE_USAGE_STATS`, `POST_NOTIFICATIONS`, `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE`)
- Test: `core/src/commonTest/kotlin/app/depressify/core/sensing/AggregatorsTest.kt`, `shared/src/commonTest/.../settings/ConsentControllerTest.kt`

**Interfaces:**
- Produces (core) `object Aggregators`:
  - `fun sleepMinutesByWakeDate(sessions: List<TimeWindow>, zone: TimeZone): Map<LocalDate, Double>` (each session is credited to its end date)
  - `fun movementRadiusKm(points: List<GeoPoint>): Double?` (null under 2 points)
  - `fun home(nightPoints: List<GeoPoint>): GeoPoint?`
  - `fun timeAtHomeMinutes(samples: List<TimedPoint>, home: GeoPoint, radiusM: Double = 150.0, sampleMinutes: Double = 15.0): Double?`
  - `fun lateNightScreenMinutes(screenOn: List<TimeWindow>, date: LocalDate, zone: TimeZone): Double` (overlap with 00:00–05:00*)
- Produces (shared):
  - `interface HealthReader { suspend fun day(date: LocalDate): Map<Signal, Double?> }`. Android uses HealthKMP for steps, sleep and heart rate, and `AndroidHrvReader` (Health Connect RMSSD) for HRV, as the spike allows.
  - `LocationSampleWorker`: samples every 15 minutes while location Consent is granted and appends to a local store pruned to 14 days. Samples never leave the phone.
  - `interface UsageReader { suspend fun screenOn(date: LocalDate): List<TimeWindow>? }` (null without the special permission)
  - `class DayBuilder(health, samples, usage, consents) { suspend fun build(date: LocalDate): Day; suspend fun bootstrap(days: Int = 14): List<Day> }`. A Signal without Consent or without data is `null`. A Patient whose `healthSource` is `synthetic` skips device reads.
  - `class ConsentController(repo: PatientRepo, localStores) { suspend fun grant(signal: String); suspend fun withdraw(signal: String) }`. `withdraw` stops collection, deletes local samples for that Signal, and removes its key from every `daily` document.
  - `SettingsScreen`: one switch per Signal with a one-line explanation, quiet hours, and the standing notice that place results come from Google Maps. Calendar permission is requested when that switch is turned on.

- [ ] **Step 1: Write failing tests:** `sleepCrossingMidnightCreditsWakeDate`, `radiusNullForSinglePoint`, `radiusOfTwoPoints1kmApartIsHalfKm`, `timeAtHomeCountsSamplesWithin150m`, `timeAtHomeNullWithoutSamples`, `lateScreenOnlyCountsMidnightToFive`, `withdrawDeletesLocalAndRemoteValues`, `signalWithoutConsentIsNull`.
- [ ] **Step 2: Run** `./gradlew :core:jvmTest --tests "*AggregatorsTest" :shared:testDebugUnitTest --tests "*ConsentControllerTest"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify on the S24+.** A debug screen lists `bootstrap(14)` with sleep and steps from the watch. Turning a Signal off empties its column and removes it from Firestore.
- [ ] **Step 6: Commit** `feat: signals with per-signal consent on android`.

---

### Task 20: Daily job, heartbeat and Nudges

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/daily/DailyPipeline.kt`
- Create: `shared/src/commonMain/kotlin/app/depressify/daily/{DailyJob.kt, Notifier.kt}`, `shared/src/androidMain/.../daily/{DailyWorker.kt, AndroidNotifier.kt}`
- Test: `core/src/commonTest/kotlin/app/depressify/core/daily/DailyPipelineTest.kt`

**Interfaces:**
- Consumes: `Baseline`, `FlagRules`, `FlagPolicy`, `NudgeRules`, `Outcomes`, `DayBuilder`, `PatientRepo`, `CalendarClient`, `MapToolClient`.
- Produces:
  - `object DailyPipeline { fun run(history: List<Day>, today: Day, last24h: Pair<Double?, Double?>, recentMoods: List<Int?>, openFlags: List<Flag>, nudge: NudgeInput, crisisActive: Boolean): DailyResult }`
  - `data class DailyResult(val doc: DailyDoc, val newFlags: List<FlagDraft>, val nudge: NudgeReason?, val level: FlagLevel, val reasons: List<String>)`
  - `class DailyJob`: builds today and yesterday, runs the pipeline, writes the daily document, new flags and the heartbeat, fills `objectiveChange` and `outcomeScore` on yesterday's answered Suggestions, and posts a Nudge through `Notifier`.
  - `interface Notifier { fun nudge(reason: NudgeReason) }`. Tapping the notification opens the Check-in. The wording per reason is gentle and never mentions a flag.
  - `DailyWorker`: WorkManager periodic work every 6 hours, plus `runNow()`.
- The phone never lowers a level that a function or the Clinician set: it only raises, and only the Clinician clears.

- [ ] **Step 1: Write failing tests:** `pipelineWritesNullForMissingSignals`, `pipelineNudgesOnlyOncePerDay`, `pipelineDropsFlagKindAlreadyOpen`, `pipelineLevelMatchesFlagRules`, `pipelineDoesNotLowerAnOpenRed`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the pipeline, then the shared and Android classes.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify on device.** `runNow()` creates `patients/{uid}/daily/{today}` and updates `lastSeenAtMillis`. A forced rough-nights input posts one notification, and a second run the same day posts none.
- [ ] **Step 6: Commit** `feat: daily job, heartbeat and nudges`.

---

### Task 21: iOS

**Files:**
- Create: `shared/src/iosMain/kotlin/app/depressify/live/IosAudioIO.kt`, `shared/src/iosMain/.../daily/{IosNotifier.kt, IosDailyTask.kt}`, `shared/src/iosMain/.../sensing/IosHealthReader.kt` (returns nulls)
- Modify: `iosApp/` (Firebase iOS SDK through Swift Package Manager, `GoogleService-Info.plist`, microphone usage description, background task identifier)

**Interfaces:**
- Consumes: everything in `shared`; the Task 2 iOS audio result.
- Produces:
  - `IosAudioIO`: `AVAudioEngine` input converted to 16 kHz mono PCM16 with voice processing enabled, and a player node at 24 kHz.
  - `IosNotifier`: local notifications. `IosDailyTask`: a background app refresh task that runs `DailyJob`. iOS decides when it runs, so Nudges on iOS are best effort.
  - Scope for the demo: Check-in (spoken or typed), Summaries in History, Crisis notice, Nudges. Health, location, usage and calendar return null or "not connected".

- [ ] **Step 1: Implement `IosAudioIO`** from the spike code.
- [ ] **Step 2: Verify on an iPhone.** A 3-minute Check-in with a weather tool call and a Suggestion card; the Summary appears in History and on the dashboard.
- [ ] **Step 3: Implement notifications and the background task.** Verify a Nudge by triggering the task from Xcode.
- [ ] **Step 4: If the audio spike failed,** ship typed Check-ins on iOS and record that in `docs/spike-results.md`.
- [ ] **Step 5: Commit** `feat(ios): check-in, summaries and nudges`.

---

### Task 22: Demo controls, script and rehearsal

**Files:**
- Create: `shared/src/commonMain/kotlin/app/depressify/demo/{DemoOverrides.kt, DebugPanel.kt, DemoPatientPicker.kt}`, `docs/demo-script.md`, `docs/demo/fictional-intake.md`
- Modify: `DayBuilder` (apply overrides), `DailyJob` (mark `demoOverride: true`)

**Interfaces:**
- Produces `DebugPanel`, opened by tapping the title five times in a demo build:
  - "Run daily job now"
  - "Simulate two rough nights" (sleep 240 minutes on the last two nights and late-night screen 90 minutes, giving a Nudge). Two nights are the Nudge's rule (#27); amber `poor_sleep` needs three, and against a usual 7 hours 240 minutes is far enough below Baseline to raise red `sleep_collapse`. For amber, simulate three nights a little below usual instead.
  - "Simulate next day" (clock offset of one day, so the Companion asks about yesterday's Suggestion)
  - "Silence test" (sets `lastSeenAtMillis` to 25 hours ago once; `checkSilence` then raises red)
  - "Act as Demo Patient" (the picker)
- Overrides only ever affect documents flagged `demoOverride`.

- [ ] **Step 1: Implement** the panel, overrides and picker.
- [ ] **Step 2: Write `docs/demo-script.md`** with the exact taps and lines:
  1. The dashboard shows four Patients, the live one in amber.
  2. The phone gets a Nudge.
  3. A spoken Check-in: the Companion notes a flat tone, mentions the poor sleep, finds daylight and a park, and books the walk.
  4. The Summary appears on the dashboard; the Phase timeline shows mood beside the Questionnaire score.
  5. Simulated next day: "did the walk help?" updates "what works".
  6. A scripted crisis line: the Crisis notice on the phone with the mock number, and a red flag email and banner for the Clinician.

  Add a checklist: phone charged, hotspot ready, dashboard signed in, seed fresh, mock crisis number showing.
- [ ] **Step 3: Run the full demo on the S24+** and check each line of "What a finished demo shows" in the design:
  - Summary on the dashboard within about 10 seconds
  - silence test gives a red flag and email, and no Crisis notice on the phone
  - crisis line gives the Crisis notice and a red flag, and no call is placed
- [ ] **Step 4: Record the backup video** and store its link in `docs/demo-script.md`.
- [ ] **Step 5: Commit** `feat: demo controls and rehearsed demo script`.

---

### Task 23 (stretch): Voice analysis on the phone

Only after Task 22 is rehearsed. If it is not stable, drop it; never send recorded audio anywhere as a substitute.

**Files:**
- Create: `core/src/commonMain/kotlin/app/depressify/core/voice/{VoiceAnalyzer.kt, PitchDetector.kt}`
- Modify: `Signal` (add `PITCH_VARIATION`, `SPEECH_RATE`, `PAUSE_RATIO`), `CheckInRunner` (feed frames with `gated = audio.companionSpeaking`), `CheckIn` (optional `voice` map), dashboard Signal trends
- Test: `core/src/commonTest/kotlin/app/depressify/core/voice/VoiceAnalyzerTest.kt`

**Interfaces:**
- Produces: `fun interface PitchDetector { fun pitchHz(frame: FloatArray, sampleRate: Int): Float? }` with a YIN implementation written in common Kotlin (range 60–400 Hz), and `class VoiceAnalyzer(sampleRate: Int = 16_000, detector: PitchDetector) { fun accept(frame: ShortArray, gated: Boolean); fun finish(): VoiceFeatures? }`.
- Algorithm: frames of 1024 samples with hop 512; a speech frame is more than 10 dB above the 10th-percentile frame level; a pause is at least 250 ms of non-speech between the first and last speech frame; speech rate counts energy peaks at least 120 ms apart; `finish()` returns null under 5 seconds of speech. Gated frames are dropped.

- [ ] **Step 1: Write failing tests** on synthetic signals: `steadyToneGivesPitchNear200`, `chirpHasHighPitchVariation`, `silenceGivesNull`, `shortSpeechGivesNull`, `halfOnHalfOffGivesPauseRatioNearHalf`, `gatedFramesAreIgnored`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify on device.** Reading a passage flatly and then with expression gives visibly lower pitch variation for the flat reading.
- [ ] **Step 6: Commit** `feat(core): voice analysis on the phone`.

---

## Changes from the plan in PR #2

| Area | PR #2 | This plan |
|---|---|---|
| App | Android only, Jetpack Compose | Kotlin Multiplatform with Compose Multiplatform; Android first, iOS for the Check-in (Task 21) |
| `core` | JVM module using `java.time` | Multiplatform common code using `kotlinx-datetime` |
| Gemini Live | Firebase AI Logic SDK | Raw Ktor WebSocket with a token from a function; Firebase AI Logic is the fallback (Tasks 2, 10) |
| Models | `gemini-2.5-flash` for reports | `gemini-4-hydrogen`, plus `gemini-decision-1` for the flag judgment |
| Where Gemini text calls run | On the phone | In Cloud Functions; the transcript passes through in memory (Task 13) |
| Map tools | Weather, Places and Routes APIs with a key in the app | Maps agent tools behind a function (Task 14) |
| Questionnaires | PHQ-2 asked by the agent; a sum of 3 or more is red | Never asked by the Companion; the Clinician records PHQ-2 or PHQ-9 at a Visit (Task 18) |
| Ratings | Mood and energy 1–10, sleep quality 1–5, recorded by a tool | All three 1–5, extracted when the Check-in ends |
| Outcome | `rate_intervention` tool | Extracted when the Check-in ends, with the Decisions answer for "tried" |
| Flag | Risk level plus separate alerts, with a `phq2` kind | One Attention flag with green, amber or red and reasons; new kinds `low_mood`, `poor_sleep`, `decline`, `unassessed` |
| Voice | On-phone prosody in the main path, with a fallback that uploads audio | Voice cues in the main path; on-phone analysis is a stretch task with no upload fallback (Task 23) |
| Crisis numbers | A real helpline and 112 | A mock number |
| Nudges | One sleep rule | Three triggers, quiet hours, and not while busy |
| Consent | None | Per Signal, with deletion on withdrawal (Task 19) |
| Dashboard | 14-day trends | Phase timeline in weeks since TMS with Visits and Questionnaire scores (Task 18) |
| Seed | Three patients, 21 days, scores from ds003478 | Three Demo Patients, 42 days, one Visit, invented values |
| Names | session, intervention, report, alert, risk | Check-in, Suggestion, Summary, Attention flag |

## Not in this plan

- Sign-in with Google for Patients and the Invite. The demo uses anonymous sign-in.
- Push messaging from the server. Nudges are decided and shown on the phone.
- HealthKit, calendar and extra Signals on iOS.
- Session resumption, camera input, booking classes.
