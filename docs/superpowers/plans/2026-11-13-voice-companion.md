# Voice Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android voice companion for post-TMS patients. It runs a 3-minute daily Gemini Live check-in grounded in real watch and phone data, learns which suggestions help, and feeds automatic reports, anomaly alerts and a crisis path to a clinician web dashboard.

**Architecture:**
- All decision logic (baseline, risk, nudges, prosody, learning, prompts, tool dispatch, session orchestration, Google API parsing) lives in a pure-Kotlin `:core` module that is unit-tested on the JVM.
- The Android `:app` module supplies thin adapters: Health Connect, location, UsageStats, audio, the Firebase AI Logic Live client, Firestore, WorkManager, and Compose UI.
- Firebase (Firestore, Cloud Functions in TypeScript, Hosting) carries aggregates to a vanilla-JS clinician dashboard.

**Tech Stack:** Kotlin 2.x, Jetpack Compose, Firebase AI Logic (`firebase-ai`), Health Connect, Play Services Location + Auth, WorkManager, Ktor client, kotlinx.serialization, TarsosDSP, JUnit5/kotlin.test, Robolectric; Firebase Functions v2 (Node 20, TypeScript, vitest, `@google/genai`, `@firebase/rules-unit-testing`); Firebase Hosting with Firebase JS SDK + Chart.js, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-13-voice-companion-design.md`

## Global Constraints

- Android package `com.twoam.companion`; `minSdk 28`, JDK 17, Compose; library versions = latest stable at H0, pinned in `android/gradle/libs.versions.toml`.
- `:core` has **no Android imports**. Test it with `cd android && ./gradlew :core:test`.
- Firestore stores **aggregates and reports only**. Never raw sensor samples, audio, or full transcripts.
- Audio is never written to disk or sent anywhere except the live stream to Gemini Live. The only exception is the H24 fallback in Task 14, which deletes the file after upload.
- UI and report copy says **"voice signals"**, never "diagnosis".
- The app never places a call: only `Intent.ACTION_DIAL`; no `CALL_PHONE` permission. Sensor anomalies never show patient-facing crisis UI.
- Baseline window **14 days**; z-scores need **≥ 5** valid prior days.
- Nudge **at most once per calendar day**; WorkManager daily job every **6 h**.
- Learning: **top 3** interventions in the prompt; **explore rate 0.2**.
- `note_emotion` intensity **1–5**.
- **PHQ-2 sum ≥ 3 → red**.
- Mic **16 kHz mono PCM16**; Live output played at **24 kHz mono PCM16**.
- Models:
  - `LIVE_MODEL` = the ID recorded in `docs/spike-results.md` (Task 2).
  - `REPORT_MODEL = "gemini-2.5-flash"` (verify it's available in Task 2).
- Timestamps in Firestore are epoch milliseconds in fields ending `AtMillis`. Dates are `yyyy-MM-dd` strings. The time zone is the device zone (`Europe/Helsinki` for the demo).
- Secrets are never committed:
  - `android/secrets.properties` (`MAPS_API_KEY`, `CLINICIAN_EMAIL`) and `android/app/google-services.json` are gitignored.
  - Functions use `defineSecret("GEMINI_API_KEY")`.

## Review Focus

1. **Watch not worn / missing day** → the metric is `null`, never `0`. A missing night must not raise `sleep_collapse` or count toward a nudge. (Tests in Tasks 3, 4, 5.)
2. **New patient (< 5 prior days) or constant metric (std ≈ 0)** → z is `null` or bounded. No drift alerts and no division blow-ups. (Task 3.)
3. **Phone dead or app killed for 24 h** → the phone can't report its own silence, so the server-side hourly check raises a red `silent` alert. (Task 16.)
4. **Silent or very short voice session, or agent audio leaking into the mic** → voice features are `null` (not "pause ratio 1.0"), and a session report is still produced. (Tasks 6, 14, 15.)
5. **Crisis while offline, or the backend throws** → the crisis screen shows locally *before* any network call. The alert write is queued by Firestore offline persistence. (Tasks 8, 13.)

---

## Work tracks (for a 3-dev team)

| Track | Owner | Tasks | Can start |
|---|---|---|---|
| Foundation | all | 1, 2 | H0 |
| Core logic (pure Kotlin) | Dev 2 (+Dev 1 for 8–9, 12, 15) | 3–9, 12, 15 | after 1 |
| Android integration | Dev 1 / Dev 2 | 10, 11, 13, 14 | after 2 |
| Firebase + dashboard | Dev 3 | 16–20 | after 1 |
| Demo | all | 21 | H30 |

---

### Task 1: Project scaffold and shared data contract

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle/libs.versions.toml`, `android/core/build.gradle.kts`, `android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/kotlin/com/twoam/companion/MainActivity.kt`
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/model/Models.kt`, `.../core/model/FirestoreJson.kt`
- Create: `firebase/firebase.json`, `firebase/.firebaserc`, `docs/firestore-schema.md`
- Modify: `.gitignore` (add `android/secrets.properties`, `android/app/google-services.json`, `android/.gradle/`, `**/build/`, `firebase/functions/node_modules/`, `firebase/functions/lib/`)
- Test: `android/core/src/test/kotlin/com/twoam/companion/core/model/ModelsSerializationTest.kt`

**Interfaces:**
- Produces (in `com.twoam.companion.core.model`, all `@Serializable`; this is the Firestore contract the TS side mirrors in Task 16):
  - `enum class Metric(val key: String, val higherIsBetter: Boolean)`:
    - `SLEEP_MINUTES("sleepMinutes", true)`, `STEPS("steps", true)`, `RESTING_HR("restingHr", false)`, `HRV_RMSSD("hrvRmssd", true)`
    - `TIME_AT_HOME_MIN("timeAtHomeMinutes", false)`, `RADIUS_KM("radiusOfGyrationKm", true)`, `LATE_SCREEN_MIN("lateNightScreenMinutes", false)`
    - `PITCH_STD_HZ("pitchStdHz", true)`, `SPEECH_RATE_SPS("speechRateSps", true)`, `PAUSE_RATIO("pauseRatio", false)`
  - `enum class RiskLevel { green, amber, red }`
  - `enum class AlertLevel { amber, red, crisis }`
  - `enum class AlertKind { drift, inactive, sleep_collapse, missed_checkins, phq2, silent, crisis }`
  - `enum class InterventionType { walk, nature, music, social_call, breathing, yoga_class, daylight }`
  - `data class DailySnapshot(val date: String, val metrics: Map<String, Double?>)`
  - `data class DailyDoc(val date: String, val metrics: Map<String, Double?>, val z: Map<String, Double?>, val composite: Double?, val risk: RiskLevel, val riskReasons: List<String>, val demoOverride: Boolean = false)`
  - `data class PatientDoc(val displayName: String, val clinicianEmail: String, val intakeSummary: String = "", val risk: RiskLevel = RiskLevel.green, val riskReasons: List<String> = emptyList(), val lastSeenAtMillis: Long? = null, val lastCheckinAtMillis: Long? = null, val synthetic: Boolean = false)`
  - `data class Checkin(val patientId: String, val sessionId: String, val atMillis: Long, val mood: Int, val energy: Int, val sleepQuality: Int, val phq2a: Int, val phq2b: Int)` (mood/energy 1–10, sleepQuality 1–5, phq2 items 0–3)
  - `data class EmotionNote(val label: String, val intensity: Int, val cue: String)`
  - `data class VoiceFeatures(val f0MeanHz: Double, val f0StdHz: Double, val speechRateSps: Double, val pauseRatio: Double, val meanPauseSec: Double, val loudnessDb: Double, val voicedSeconds: Double)`
  - `data class Intervention(val id: String, val patientId: String, val type: InterventionType, val details: String, val suggestedAtMillis: Long, val accepted: Boolean = false, val done: Boolean = false, val helped: Int? = null, val objectiveDelta: Double? = null, val outcomeScore: Double? = null)`
  - `data class SessionReport(val sessionId: String, val patientId: String, val atMillis: Long, val mood: Int?, val sleepSummary: String, val themes: List<String>, val emotions: List<EmotionNote>, val voiceSignals: Map<String, Double?>, val suggestion: String?, val previousOutcome: String?, val riskChange: String, val flaggedQuotes: List<String>)`
  - `data class Alert(val patientId: String, val level: AlertLevel, val kind: AlertKind, val reason: String, val atMillis: Long, val acknowledged: Boolean = false)`
  - `object FirestoreJson { val json: Json; fun toMap(value: JsonElement): Map<String, Any?>; inline fun <reified T> encode(value: T): Map<String, Any?> }`
- Collections (from the spec): `patients/{patientId}`, `patients/{patientId}/daily/{date}`, `checkins/{auto}`, `sessionReports/{sessionId}`, `voiceFeatures/{sessionId}` (VoiceFeatures + `patientId`, `atMillis`), `interventions/{id}`, `alerts/{auto}`, `digests/{patientId}_{isoWeek}`, `mail/{auto}` (Trigger Email extension). Write this list plus the field lists above into `docs/firestore-schema.md`.

- [ ] **Step 1: Create the Gradle project.** `:core` = `kotlin("jvm")` + serialization + ktor-client-core/cio/content-negotiation + ktor-client-mock (test) + kotlinx-coroutines-test (test) + JUnit5. `:app` = Android application + Compose + `google-services`, depends on `:core`. `MainActivity` shows "Companion" text.
- [ ] **Step 2: Write the failing test** `ModelsSerializationTest`:
```kotlin
@Test fun dailyDocUsesContractKeys() {
    val m = FirestoreJson.encode(DailyDoc("2026-11-13", mapOf("sleepMinutes" to 420.0, "steps" to null),
        mapOf("sleepMinutes" to -1.2), -0.4, RiskLevel.amber, listOf("Sleep lower than usual")))
    assertEquals(setOf("date","metrics","z","composite","risk","riskReasons","demoOverride"), m.keys)
    assertEquals("amber", m["risk"])
    assertTrue((m["metrics"] as Map<*, *>).containsKey("steps"))   // nulls are kept, not dropped
}
@Test fun alertEnumsSerializeLowercase() {
    val m = FirestoreJson.encode(Alert("p1", AlertLevel.crisis, AlertKind.sleep_collapse, "r", 1L))
    assertEquals("crisis", m["level"]); assertEquals("sleep_collapse", m["kind"])
}
@Test fun metricKeysAreUnique() = assertEquals(Metric.entries.size, Metric.entries.map { it.key }.toSet().size)
```
- [ ] **Step 3: Run** `cd android && ./gradlew :core:test --tests "*ModelsSerializationTest"`. Expected: FAIL (unresolved references).
- [ ] **Step 4: Implement `Models.kt` and `FirestoreJson.kt`.** `json = Json { encodeDefaults = true; explicitNulls = true }`. `toMap` converts JsonPrimitive to Long/Double/Boolean/String, recursively.
- [ ] **Step 5: Run the tests** and `./gradlew :app:assembleDebug`. Expected: PASS / BUILD SUCCESSFUL.
- [ ] **Step 6: `firebase init`** in `firebase/` (Firestore, Functions TypeScript, Hosting public dir `hosting`, Emulators: firestore, functions). Then commit:
```bash
git add android firebase docs/firestore-schema.md .gitignore
git commit -m "feat: scaffold android/core and firebase with shared data contract"
```

---

### Task 2: Hour-0 spikes (throwaway, on the S24+)

**Files:**
- Create: `docs/spike-results.md` (the only file merged; spike code stays on branch `spike/h0`)

**Interfaces:**
- Produces: `docs/spike-results.md` recording:
  1. `LIVE_MODEL` ID.
  2. The exact Firebase AI Logic Kotlin calls for: connect with system instruction + function declarations, send realtime PCM audio, receive audio/transcripts/tool calls/interruption, send function responses, enable input/output transcription.
  3. Whether `HeartRateVariabilityRmssdRecord` / `RestingHeartRateRecord` / `SleepSessionRecord` have Samsung data.
  4. Weather/Places/Routes REST calls returning 200 with an Android-restricted key (headers `X-Android-Package`, `X-Android-Cert`).
  5. A Calendar `freeBusy` call working via `Identity.getAuthorizationClient` with scope `https://www.googleapis.com/auth/calendar.events`.
  6. That `REPORT_MODEL` is available.

- [ ] **Step 1: Live spike.** Talk to the Live model from the S24+ using **self-managed `AudioRecord`** (16 kHz, `VOICE_COMMUNICATION`), feeding audio to the session and playing returned audio via `AudioTrack` at 24 kHz. Register one dummy tool and confirm the model calls it. Pass = a 30 s natural conversation + one tool round trip.
- [ ] **Step 2: Health Connect spike.** Enable Samsung Health → Settings → Health Connect sync. Read 14 days of the five record types. Record what's present.
- [ ] **Step 3: Google APIs spike.** Run each REST call once. **Save the raw JSON responses** to `android/core/src/test/resources/fixtures/{weather_current,weather_hours,weather_days,places_nearby,routes_walk,calendar_freebusy}.json` for Task 12.
- [ ] **Step 4: Write `docs/spike-results.md`.** If HRV is absent, write "HRV: seeded" (Task 18 and Task 21 then supply it). Commit:
```bash
git add docs/spike-results.md android/core/src/test/resources/fixtures
git commit -m "docs: record H0 spike results and API fixtures"
```

---

### Task 3: Baseline and z-scores

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/baseline/Baseline.kt`
- Test: `android/core/src/test/kotlin/com/twoam/companion/core/baseline/BaselineTest.kt`

**Interfaces:**
- Consumes: `DailySnapshot`, `Metric` (Task 1).
- Produces:
  - `object Baseline { const val WINDOW_DAYS = 14; const val MIN_DAYS = 5`
  - `fun z(history: List<DailySnapshot>, today: DailySnapshot): Map<Metric, Double?>` (raw z, sign as measured)
  - `fun oriented(z: Map<Metric, Double?>): Map<Metric, Double?>` (negated where `!higherIsBetter`, so negative = worse)
  - `fun composite(oriented: Map<Metric, Double?>): Double?` (mean of non-null values; null if none) `}`
- Rule: use only the `WINDOW_DAYS` snapshots strictly before `today.date` with a non-null value for that metric. Fewer than `MIN_DAYS` → null. `std = max(sampleStd, 0.05 * |mean|, 1e-3)`.

- [ ] **Step 1: Write failing tests:**
```kotlin
private fun days(vararg sleep: Double?) = sleep.mapIndexed { i, v ->
    DailySnapshot(LocalDate.of(2026, 11, 1).plusDays(i.toLong()).toString(), mapOf("sleepMinutes" to v)) }
private fun today(v: Double?) = DailySnapshot("2026-11-20", mapOf("sleepMinutes" to v))

@Test fun zIsNullWithFewerThanFiveValidDays() =
    assertNull(Baseline.z(days(400.0, 410.0, null, 420.0, 430.0), today(300.0))[Metric.SLEEP_MINUTES])
@Test fun missingTodayGivesNullNotZero() =
    assertNull(Baseline.z(days(400.0,410.0,420.0,430.0,440.0,450.0), today(null))[Metric.SLEEP_MINUTES])
@Test fun constantHistoryUsesStdFloor() {
    val z = Baseline.z(days(420.0,420.0,420.0,420.0,420.0), today(399.0))[Metric.SLEEP_MINUTES]!!
    assertEquals(-1.0, z, 1e-9)                    // floor = 0.05 * 420 = 21
}
@Test fun onlyLast14PriorDaysCount() {
    val h = days(*Array(20) { if (it < 6) 100.0 else 420.0 })   // early outliers fall outside the window
    assertEquals(0.0, Baseline.z(h, today(420.0))[Metric.SLEEP_MINUTES]!!, 1e-9)
}
@Test fun orientedFlipsHighIsBadMetrics() {
    val o = Baseline.oriented(mapOf(Metric.LATE_SCREEN_MIN to 2.0, Metric.SLEEP_MINUTES to -1.0))
    assertEquals(-2.0, o[Metric.LATE_SCREEN_MIN]); assertEquals(-1.0, o[Metric.SLEEP_MINUTES])
}
@Test fun compositeIgnoresNulls() =
    assertEquals(-1.5, Baseline.composite(mapOf(Metric.STEPS to -1.0, Metric.SLEEP_MINUTES to -2.0, Metric.HRV_RMSSD to null)))
```
- [ ] **Step 2: Run** `./gradlew :core:test --tests "*BaselineTest"`. Expected: FAIL.
- [ ] **Step 3: Implement `Baseline`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): personal 14-day baseline z-scores`.

---

### Task 4: Risk engine, anomaly rules, alert de-duplication

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/risk/RiskEngine.kt`, `.../risk/AlertPolicy.kt`
- Test: `android/core/src/test/kotlin/com/twoam/companion/core/risk/RiskEngineTest.kt`, `.../risk/AlertPolicyTest.kt`

**Interfaces:**
- Consumes: `Baseline.composite`, `Metric`, `Checkin`, `RiskLevel`, `AlertLevel`, `AlertKind`, `Alert`.
- Produces:
  - `data class RiskInput(val todayRaw: Map<Metric, Double?>, val orientedHistory: List<Map<Metric, Double?>> /* oldest→newest, last item = today */, val stepsLast24h: Double?, val screenMinutesLast24h: Double?, val lastCheckin: Checkin?, val nowMillis: Long, val crisisActive: Boolean)`
  - `data class AlertDraft(val level: AlertLevel, val kind: AlertKind, val reason: String)`
  - `data class RiskAssessment(val level: RiskLevel, val reasons: List<String>, val alerts: List<AlertDraft>)`
  - `object RiskEngine { fun assess(input: RiskInput): RiskAssessment }`
  - `object AlertPolicy { fun filterNew(drafts: List<AlertDraft>, existingToday: List<Alert>): List<AlertDraft> }` (drop drafts whose `kind` already has an alert today)
- Rules (spec + my calls on thresholds, marked *):
  - **red `sleep_collapse`**: today's raw sleep < 180 min* **or** oriented sleep z ≤ −2.5*. Only when sleep is non-null.
  - **red `inactive`**: `stepsLast24h == 0.0 && screenMinutesLast24h == 0.0` (both non-null).
  - **red `missed_checkins`**: last check-in > 3 days* before `nowMillis` **and** its mood ≤ 3*.
  - **red `phq2`**: `phq2a + phq2b ≥ 3` on the last check-in, if it was within 24 h.
  - **crisis**: `crisisActive` → level red, reason "Crisis escalation in voice session". No new draft (Task 8 writes that alert).
  - **amber `drift`**: composite ≤ −1.0* on each of the last 3* entries of `orientedHistory`. Also amber (no alert) if the last check-in mood ≤ 3.
  - Else green. Any red draft → level red. `reasons` are human sentences, e.g. "Slept under 3 hours".

- [ ] **Step 1: Write failing tests**, one per rule plus the Review Focus cases:
  - `missingSleepNeverRaisesSleepCollapse` (sleep null → no `sleep_collapse`)
  - `sleepUnder180IsRed`
  - `zeroStepsAndZeroScreenIsInactiveRed`
  - `nullStepsIsNotInactive`
  - `phq2SumThreeIsRed`
  - `phq2SumTwoIsNotRed`
  - `driftNeedsThreeConsecutiveDays` (two bad days + one ok → green)
  - `driftThreeDaysIsAmberWithDriftAlert`
  - `missedCheckinsWithLowMoodIsRed` (4 days old, mood 3)
  - `missedCheckinsWithGoodMoodIsNotRed`
  - `crisisForcesRed`
  - `AlertPolicyTest.dropsKindAlreadyAlertedToday`
  - `AlertPolicyTest.keepsDifferentKind`

  Example:
```kotlin
@Test fun phq2SumThreeIsRed() {
    val c = Checkin("p","s", now - 3_600_000, mood = 5, energy = 5, sleepQuality = 3, phq2a = 2, phq2b = 1)
    val r = RiskEngine.assess(base.copy(lastCheckin = c))
    assertEquals(RiskLevel.red, r.level); assertTrue(r.alerts.any { it.kind == AlertKind.phq2 })
}
```
- [ ] **Step 2: Run** `./gradlew :core:test --tests "*risk*"`. Expected: FAIL.
- [ ] **Step 3: Implement `RiskEngine` and `AlertPolicy`.** Thresholds go in a `RiskThresholds` object with the starred values.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): transparent risk and anomaly rules`.

---

### Task 5: Nudge policy

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/nudge/NudgePolicy.kt`
- Test: `.../core/nudge/NudgePolicyTest.kt`

**Interfaces:**
- Produces: `object NudgePolicy { fun shouldNudge(lastTwoNightsSleepOrientedZ: List<Double?>, timeAtHomeRawZ: Double?, lateScreenRawZ: Double?, today: LocalDate, lastNudgeDate: LocalDate?): Boolean }`
- Rule (spec): both nights' sleep z < −1 **and** (time-at-home raw z > 1* **or** late-screen raw z > 1*), and `lastNudgeDate != today`.

- [ ] **Step 1: Write failing tests:**
  - `nudgesWhenTwoBadNightsAndHomebound`
  - `noNudgeWhenOneNightMissing` (`listOf(-1.5, null)`)
  - `noNudgeTwiceSameDay`
  - `nudgesAgainNextDay`
  - `noNudgeWhenSleepBadButActivityNormal`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): once-a-day nudge policy`.

---

### Task 6: Prosody analyzer

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/prosody/ProsodyAnalyzer.kt`, `.../prosody/PitchDetector.kt`
- Modify: `android/core/build.gradle.kts` (repo `https://mvn.0110.be/releases`, dep `be.tarsos.dsp:core:2.5`)
- Test: `.../core/prosody/ProsodyAnalyzerTest.kt`

**Interfaces:**
- Consumes: `VoiceFeatures` (Task 1).
- Produces:
  - `fun interface PitchDetector { fun pitchHz(frame: FloatArray, sampleRate: Int): Float? }` with `class YinPitchDetector : PitchDetector` (TarsosDSP `Yin`, threshold 0.15; returns null outside 60–400 Hz). If the TarsosDSP repo is unreachable, implement YIN directly behind the same interface.
  - `class ProsodyAnalyzer(sampleRate: Int = 16_000, detector: PitchDetector = YinPitchDetector()) { fun accept(frame: ShortArray, gated: Boolean); fun finish(): VoiceFeatures? }`
- Algorithm (spec values + my calls*):
  - Frames of 1024* samples, hop 512*. Gated frames are dropped entirely.
  - Speech frame = RMS dB > (10th-percentile frame dB + 10 dB)*.
  - Pause = run of non-speech ≥ 250 ms* between the first and last speech frame. `pauseRatio` = pause time / (speech + pause time).
  - Speech rate = peaks in the 3-frame-smoothed speech-frame energy envelope, at least 120 ms* apart, divided by speech seconds.
  - `voicedSeconds` = speech seconds. `finish()` returns **null if voicedSeconds < 5***.
  - `loudnessDb` = mean speech-frame dBFS.

- [ ] **Step 1: Write failing tests** (16 kHz synthetic signals built with a test helper `tone(hz, seconds, amp=0.5)` / `silence(seconds)`, fed in 512-sample chunks):
```kotlin
@Test fun steadyToneGivesPitchNear200() { val f = analyze(tone(200.0, 8.0))!!
    assertEquals(200.0, f.f0MeanHz, 5.0); assertTrue(f.f0StdHz < 5.0) }
@Test fun chirpHasHighPitchVariability() = assertTrue(analyze(chirp(150.0, 250.0, 8.0))!!.f0StdHz > 20.0)
@Test fun silenceGivesNull() = assertNull(analyze(silence(10.0)))
@Test fun shortSpeechGivesNull() = assertNull(analyze(tone(200.0, 3.0) + silence(5.0)))
@Test fun halfOnHalfOffGivesPauseRatioNearHalf() {
    val sig = (1..10).flatMap { tone(180.0, 0.6).toList() + silence(0.6).toList() }.toShortArray()
    assertEquals(0.5, analyze(sig)!!.pauseRatio, 0.1) }
@Test fun gatedFramesAreIgnored() = assertNull(analyze(tone(200.0, 8.0), gated = true))
```
- [ ] **Step 2: Run** `./gradlew :core:test --tests "*ProsodyAnalyzerTest"`. Expected: FAIL.
- [ ] **Step 3: Implement `PitchDetector` and `ProsodyAnalyzer`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): on-device prosody features`.

---

### Task 7: Learning (intervention outcomes and ranking)

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/learn/InterventionRanker.kt`
- Test: `.../core/learn/InterventionRankerTest.kt`

**Interfaces:**
- Consumes: `Intervention`, `InterventionType`.
- Produces:
  - `object Outcome { fun score(helped: Int?, objectiveDelta: Double?): Double? }`. Null if `helped` is null; else `0.7*((helped-3)/2.0) + 0.3*(objectiveDelta ?: 0.0).coerceIn(-1.0, 1.0)`. `objectiveDelta` = that day's oriented steps z.
  - `data class InterventionScore(val type: InterventionType, val mean: Double, val n: Int)`
  - `data class PromptGuidance(val preferred: List<InterventionScore>, val exploreType: InterventionType?)`
  - `class InterventionRanker(private val rand: () -> Double = { Random.nextDouble() }) { fun rank(history: List<Intervention>): List<InterventionScore>; fun guidance(history: List<Intervention>): PromptGuidance }`
- `rank` uses only non-null `outcomeScore`, sorted by mean desc, then n desc. `guidance`: preferred = top 3. If `rand() < 0.2` → exploreType = an untried type (enum order) else the least-tried; otherwise null.

- [ ] **Step 1: Write failing tests:**
  - `scoreNullUntilRated`
  - `scoreHelped5NoDeltaIs0_7`
  - `scoreClampsDelta`
  - `rankIgnoresUnscored`
  - `rankTieBreaksByCount`
  - `guidanceTop3Only`
  - `exploresUntriedWhenRandBelowPoint2` (`rand = { 0.1 }`)
  - `noExploreWhenRandAbovePoint2` (`rand = { 0.5 }`)
  - `emptyHistoryGivesEmptyPreferred`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): learn which interventions help`.

---

### Task 8: Tool catalog, dispatcher, session recorder

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/agent/ToolCatalog.kt`, `.../agent/ToolBackend.kt`, `.../agent/ToolDispatcher.kt`, `.../agent/SessionRecorder.kt`
- Test: `.../core/agent/ToolDispatcherTest.kt`

**Interfaces:**
- Consumes: `Checkin`, `EmotionNote`, `InterventionType`.
- Produces:
  - `enum class ParamType { STRING, INTEGER, NUMBER }`
  - `data class ParamSpec(val name: String, val type: ParamType, val description: String, val required: Boolean = true, val enumValues: List<String>? = null)`
  - `data class ToolSpec(val name: String, val description: String, val params: List<ParamSpec>)`
  - `object ToolCatalog { val all: List<ToolSpec> }` with exactly these names and params:
    - `get_health_summary(days:INTEGER)`
    - `get_weather()`
    - `find_nearby_places(kind:STRING enum[park,sea,yoga,meditation])`
    - `get_walking_route(place_id:STRING)`
    - `get_free_slots(date:STRING yyyy-MM-dd)`
    - `create_calendar_event(title:STRING, start:STRING ISO, end:STRING ISO, location:STRING optional)`
    - `play_music(query:STRING)`
    - `note_emotion(label:STRING, intensity:INTEGER 1–5, cue:STRING)`
    - `record_checkin(mood:INTEGER 1–10, energy:INTEGER 1–10, sleep_quality:INTEGER 1–5, phq2_a:INTEGER 0–3, phq2_b:INTEGER 0–3)`
    - `rate_intervention(intervention_id:STRING, helped:INTEGER 1–5)` *(my addition: carries the "did it help?" answer)*
    - `log_intervention(type:STRING enum[InterventionType names], details:STRING)`
    - `escalate_to_clinician(reason:STRING, severity:STRING enum[concern,crisis])`
  - `interface ToolBackend` with suspend functions:
    - `healthSummary(days: Int): JsonObject`, `weather(): JsonObject`
    - `nearbyPlaces(kind: String): JsonObject`, `walkingRoute(placeId: String): JsonObject`
    - `freeSlots(date: LocalDate): JsonObject`, `createEvent(title: String, start: String, end: String, location: String?): JsonObject`
    - `playMusic(query: String): JsonObject`
    - `saveCheckin(c: Checkin)`, `logIntervention(type: InterventionType, details: String): String`, `rateIntervention(id: String, helped: Int)`
    - `escalate(reason: String, severity: String)`
  - `class SessionRecorder(val patientId: String, val sessionId: String, private val clock: () -> Long)`:
    - `fun addTranscript(speaker: String, text: String)`, `fun addEmotion(e: EmotionNote)`, `fun setCheckin(c: Checkin)`
    - `fun addIntervention(id: String, type: InterventionType, details: String)`, `fun addRating(id: String, helped: Int)`
    - `fun toDraft(): SessionDraft`
  - `data class SessionDraft(val patientId: String, val sessionId: String, val startedAtMillis: Long, val transcript: List<Pair<String,String>>, val emotions: List<EmotionNote>, val checkin: Checkin?, val interventions: List<Triple<String, InterventionType, String>>, val ratings: Map<String, Int>, val crisis: Boolean)`
  - `class ToolDispatcher(private val backend: ToolBackend, private val recorder: SessionRecorder, private val onCrisis: () -> Unit) { suspend fun dispatch(name: String, args: JsonObject): JsonObject }`
- Behavior:
  - Never throws. Unknown name → `{"error":"unknown_tool"}`. Missing or out-of-range args → `{"error":"invalid_args","detail":...}` and the recorder is unchanged. Backend exception → `{"error":"backend_failed"}`.
  - **`escalate_to_clinician` with severity `crisis`**: calls `onCrisis()` *first*, marks `recorder` crisis, then `backend.escalate`. It returns `{"ok":true,"crisis_screen_shown":true}` even if the backend throws.

- [ ] **Step 1: Write failing tests** with a `FakeBackend` that records call order:
```kotlin
@Test fun crisisShowsScreenBeforeBackendEvenIfBackendThrows() = runTest {
    val order = mutableListOf<String>()
    val d = ToolDispatcher(FakeBackend(order, escalateThrows = true), recorder) { order += "screen" }
    val r = d.dispatch("escalate_to_clinician", json("reason" to "said goodbye", "severity" to "crisis"))
    assertEquals(listOf("screen", "escalate"), order); assertEquals(true, r["crisis_screen_shown"]?.jsonPrimitive?.boolean)
    assertTrue(recorder.toDraft().crisis)
}
@Test fun intensityOutOfRangeIsRejected() = runTest {
    val r = dispatcher.dispatch("note_emotion", json("label" to "sad", "intensity" to 7, "cue" to "sigh"))
    assertEquals("invalid_args", r["error"]?.jsonPrimitive?.content); assertTrue(recorder.toDraft().emotions.isEmpty())
}
```
  Also:
  - `unknownToolReturnsError`
  - `noteEmotionIsRecorded`
  - `recordCheckinSavesAndRecords`
  - `concernEscalationDoesNotShowCrisisScreen`
  - `logInterventionReturnsIdAndRecords`
  - `catalogHasTwelveUniqueTools`
- [ ] **Step 2: Run** `./gradlew :core:test --tests "*ToolDispatcherTest"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): agent tools with crisis-first dispatch`.

---

### Task 9: System prompt builder

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/agent/SystemPromptBuilder.kt`
- Test: `.../core/agent/SystemPromptBuilderTest.kt`

**Interfaces:**
- Consumes: `Metric`, `PromptGuidance` (Task 7).
- Produces:
  - `data class PromptContext(val intakeSummary: String, val todayOriented: Map<Metric, Double?>, val recentVoiceOriented: Map<Metric, Double?>, val weatherLine: String?, val guidance: PromptGuidance, val openInterventions: List<Pair<String, InterventionType>>, val localTime: LocalDateTime)`
  - `object SystemPromptBuilder { fun build(ctx: PromptContext): String; fun describe(metric: Metric, oriented: Double?): String? }`
- `describe`: oriented ≤ −1 → "<metric phrase> worse than usual"; ≥ 1 → "better than usual"; otherwise or null → null. Phrases are a fixed map, e.g. SLEEP_MINUTES → "sleep". **The prompt never contains raw z numbers.**
- The prompt must contain:
  - the fixed shape "how you slept → what I noticed → one suggestion → commit"
  - "about 3 minutes"
  - an instruction to call `note_emotion` when the voice shows emotion and to adapt
  - an instruction to call `record_checkin` once
  - for each open intervention: ask whether it helped and call `rate_intervention` with its id
  - the preferred types, plus an explore line only when `exploreType != null`
  - safety: "If the person expresses suicidal thoughts or intent, call escalate_to_clinician with severity crisis immediately, stay calm and present, and encourage them to use the call buttons on screen."
  - "Never diagnose; refer to voice signals, not diagnoses."
  - the intake summary and the weather line

- [ ] **Step 1: Write failing tests:**
  - `includesSafetyInstruction`
  - `includesIntake`
  - `describesBadSleepWithoutNumbers` (assert contains "sleep worse than usual"; assert `!Regex("-?\\d+\\.\\d+").containsMatchIn(prompt)` after removing the time line)
  - `omitsNullMetrics`
  - `exploreLineOnlyWhenSet`
  - `asksToRateOpenInterventionsById`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): grounded system prompt`.

---

### Task 10: Sensing (aggregation math + Android readers)

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/sensing/Aggregators.kt`
- Create: `android/app/src/main/kotlin/com/twoam/companion/sensing/{HealthConnectReader.kt, LocationSampleWorker.kt, LocalSampleStore.kt, UsageReader.kt, SnapshotBuilder.kt}`
- Modify: `AndroidManifest.xml` (Health Connect read permissions for Steps, SleepSession, HeartRate, RestingHeartRate, HeartRateVariabilityRmssd; `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `PACKAGE_USAGE_STATS`, `POST_NOTIFICATIONS`, `RECORD_AUDIO`; Health Connect rationale activity-alias)
- Test: `android/core/src/test/kotlin/com/twoam/companion/core/sensing/AggregatorsTest.kt`

**Interfaces:**
- Produces (core):
  - `data class Span(val start: Instant, val end: Instant)`, `data class GeoPoint(val lat: Double, val lng: Double)`, `data class TimedPoint(val at: Instant, val p: GeoPoint)`
  - `object Aggregators`:
    - `fun sleepMinutesByWakeDate(sessions: List<Span>, zone: ZoneId): Map<LocalDate, Double>`. Each session is credited to its end date.
    - `fun radiusOfGyrationKm(points: List<GeoPoint>): Double?`. Null if < 2 points.
    - `fun home(nightPoints: List<GeoPoint>): GeoPoint?`. Centroid of points sampled 00:00–06:00; the caller filters.
    - `fun timeAtHomeMinutes(samples: List<TimedPoint>, home: GeoPoint, radiusM: Double = 150.0, sampleMinutes: Double = 15.0): Double?`. Null if no samples.
    - `fun lateNightScreenMinutes(screenOn: List<Span>, date: LocalDate, zone: ZoneId): Double`. Overlap with `date` 00:00–05:00*.
- Produces (app):
  - `class SnapshotBuilder(hc: HealthConnectReader, store: LocalSampleStore, usage: UsageReader, voice: suspend (LocalDate) -> VoiceFeatures?) { suspend fun build(date: LocalDate): DailySnapshot; suspend fun bootstrap(days: Int = 14): List<DailySnapshot> }`
  - Rules: missing source → that metric is `null`, never 0.
  - Location: `LocationSampleWorker` runs every 15 min (WorkManager minimum) and appends `TimedPoint`s to `LocalSampleStore` (JSON lines in app storage, pruned to 14 days; never uploaded).
  - Voice metrics come from that day's `voiceFeatures`, saved locally in Task 14.

- [ ] **Step 1: Write failing core tests:**
  - `sleepCrossingMidnightCreditsWakeDate`
  - `radiusNullForSinglePoint`
  - `radiusOfTwoPoints1kmApartIsHalfKm` (tolerance 0.02)
  - `timeAtHomeCountsSamplesWithin150m`
  - `timeAtHomeNullWithoutSamples`
  - `lateScreenOnlyCountsMidnightToFive` (screen 23:00–01:30 → 90.0)
- [ ] **Step 2: Run** `./gradlew :core:test --tests "*AggregatorsTest"`. Expected: FAIL.
- [ ] **Step 3: Implement `Aggregators`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Implement the app readers and `SnapshotBuilder`.**
  - Health Connect: `aggregate` for steps and averages; read `SleepSessionRecord` spans.
  - `UsageReader` pairs `SCREEN_INTERACTIVE`/`SCREEN_NON_INTERACTIVE` events from `UsageStatsManager.queryEvents` into spans.
  - Add a debug screen listing `bootstrap(14)` output.
- [ ] **Step 6: Verify on the S24+.** The debug screen shows 14 rows with non-null sleep and steps from the Galaxy Watch history. HRV is non-null or null, matching `docs/spike-results.md`.
- [ ] **Step 7: Commit** `feat: sensing from Health Connect, location, and screen use`.

---

### Task 11: Daily job, Firestore sync, heartbeat, nudge

**Files:**
- Create: `android/app/src/main/kotlin/com/twoam/companion/data/{FirestoreRepo.kt, SnapshotStore.kt, PatientSession.kt}`, `.../work/{DailyWorker.kt, NudgeNotifier.kt}`
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/daily/DailyPipeline.kt`
- Test: `android/core/src/test/kotlin/com/twoam/companion/core/daily/DailyPipelineTest.kt`

**Interfaces:**
- Consumes: `Baseline`, `RiskEngine`, `AlertPolicy`, `NudgePolicy`, models.
- Produces:
  - core `object DailyPipeline { fun run(history: List<DailySnapshot>, today: DailySnapshot, last24h: Pair<Double?, Double?>, lastCheckin: Checkin?, alertsToday: List<Alert>, lastNudgeDate: LocalDate?, nowMillis: Long, zone: ZoneId, crisisActive: Boolean): DailyResult }`
  - `data class DailyResult(val doc: DailyDoc, val newAlerts: List<AlertDraft>, val nudge: Boolean, val patientRisk: RiskLevel, val patientReasons: List<String>)`
  - app `class FirestoreRepo(db: FirebaseFirestore, patientId: String)`:
    - `suspend fun upsertPatient(p: PatientDoc)`, `suspend fun writeDaily(d: DailyDoc)`, `suspend fun heartbeat(nowMillis: Long, risk: RiskLevel, reasons: List<String>)`
    - `suspend fun addAlert(a: Alert)`, `suspend fun alertsSince(millis: Long): List<Alert>`
    - `suspend fun saveCheckin(c: Checkin)`, `suspend fun saveIntervention(i: Intervention)`, `suspend fun updateIntervention(id: String, fields: Map<String, Any?>)`, `suspend fun interventions(): List<Intervention>`
    - `suspend fun saveSessionReport(r: SessionReport)`, `suspend fun saveVoiceFeatures(sessionId: String, v: VoiceFeatures, atMillis: Long)`
    - `suspend fun setIntake(summary: String)`, `suspend fun lastCheckin(): Checkin?`
    - All writes use `FirestoreJson.encode`.
  - `PatientSession`: anonymous Firebase Auth; `patientId = auth.uid`. On first run it creates `PatientDoc(displayName = "Live patient", clinicianEmail = BuildConfig.CLINICIAN_EMAIL)`.
  - `DailyWorker`: periodic every 6 h + `runNow()`. Builds today/yesterday snapshots, runs `DailyPipeline`, writes the daily doc + new alerts + heartbeat, posts the nudge via `NudgeNotifier` (tapping it opens the check-in), and also fills `objectiveDelta`/`outcomeScore` on yesterday's rated interventions using `Outcome.score`.

- [ ] **Step 1: Write failing tests:**
  - `pipelineWritesNullZForMissingMetrics`
  - `pipelineNudgesOnlyOncePerDay`
  - `pipelineDropsDuplicateAlertKind`
  - `pipelineRiskMatchesRiskEngine`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `DailyPipeline`, then the app classes.** Enable Firestore offline persistence (default on Android; keep it on).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Verify on device.** `runNow()` creates `patients/{uid}/daily/{today}` and updates `lastSeenAtMillis` in the Firebase console.
- [ ] **Step 6: Commit** `feat: daily pipeline, Firestore sync, heartbeat, nudge`.

---

### Task 12: Google API clients (Weather, Places, Routes, Calendar)

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/google/{GoogleHttp.kt, WeatherClient.kt, PlacesClient.kt, RoutesClient.kt, CalendarClient.kt, TimeWindows.kt}`
- Test: `android/core/src/test/kotlin/com/twoam/companion/core/google/{TimeWindowsTest.kt, ClientsParsingTest.kt}` (fixtures from Task 2)

**Interfaces:**
- Produces:
  - `data class ApiKeyAuth(val key: String, val androidPackage: String, val certSha1: String)`. Every Maps Platform request sends `X-Goog-Api-Key`, `X-Android-Package`, `X-Android-Cert`.
  - `data class TimeWindow(val start: ZonedDateTime, val end: ZonedDateTime)`
  - `data class HourForecast(val start: ZonedDateTime, val isDaytime: Boolean, val cloudCover: Int, val precipProbability: Int)`
  - `object TimeWindows`:
    - `fun daylight(hours: List<HourForecast>, sunrise: ZonedDateTime, sunset: ZonedDateTime): List<TimeWindow>`. Merges consecutive hours within sunrise..sunset with cloudCover ≤ 50* and precip ≤ 30*.
    - `fun free(busy: List<TimeWindow>, dayStart: ZonedDateTime, dayEnd: ZonedDateTime, minMinutes: Long = 30): List<TimeWindow>`
  - `class WeatherClient(http: HttpClient, auth: ApiKeyAuth)`:
    - `suspend fun summary(lat: Double, lng: Double): JsonObject`. Fields: `conditions`, `temperatureC`, `daylightWindows` (ISO pairs), `sunrise`, `sunset`.
    - Uses `GET https://weather.googleapis.com/v1/currentConditions:lookup`, `/v1/forecast/hours:lookup`, `/v1/forecast/days:lookup`.
  - `class PlacesClient(http, auth)`:
    - `suspend fun nearby(kind: String, lat: Double, lng: Double, radiusM: Double = 2000.0, max: Int = 5): JsonObject` (array `places` of `{id,name,address}`).
    - park → `searchNearby` includedTypes `["park"]`; sea → `["beach"]`; yoga → `["yoga_studio"]`; meditation → `searchText` "meditation center".
    - FieldMask `places.id,places.displayName,places.formattedAddress,places.location`.
  - `class RoutesClient(http, auth)`:
    - `suspend fun walking(fromLat: Double, fromLng: Double, placeId: String): JsonObject` (`durationMin`, `distanceM`, `mapsUrl`).
    - `POST https://routes.googleapis.com/directions/v2:computeRoutes` travelMode WALK.
    - `mapsUrl = "https://www.google.com/maps/dir/?api=1&destination_place_id=$placeId&destination=place&travelmode=walking"`.
  - `class CalendarClient(http, token: suspend () -> String)`:
    - `suspend fun freeSlots(date: LocalDate, zone: ZoneId): JsonObject` (freeBusy on `primary`, day 08:00–21:00*, `TimeWindows.free`).
    - `suspend fun createEvent(title: String, start: String, end: String, location: String?): JsonObject` (`id`, `htmlLink`).

- [ ] **Step 1: Write failing tests:**
  - `TimeWindowsTest.daylightMergesClearHours`
  - `.daylightExcludesAfterSunset`
  - `.daylightEmptyWhenAllCloudy`
  - `.freeFindsGapsAndDropsShortOnes`
  - `ClientsParsingTest` (Ktor `MockEngine` serving the Task 2 fixtures): `placesParsesFixtureCountAndFirstName`, `routesParsesDurationMinutes`, `weatherSummaryHasSunriseSunset`, `requestsCarryAndroidRestrictionHeaders`
- [ ] **Step 2: Run** `./gradlew :core:test --tests "*google*"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): Google Weather, Places, Routes, Calendar tools`.

---

### Task 13: Crisis screen and escalation

**Files:**
- Create: `android/app/src/main/kotlin/com/twoam/companion/crisis/{CrisisNumbers.kt, CrisisController.kt, CrisisScreen.kt}`
- Test: `android/app/src/test/kotlin/com/twoam/companion/crisis/CrisisTest.kt` (Robolectric)

**Interfaces:**
- Consumes: `FirestoreRepo.addAlert`, `Alert`.
- Produces:
  - `object CrisisNumbers { const val EMERGENCY = "112"; const val CRISIS_LINE: String /* MIELI, verified in Step 1 */; const val CRISIS_LINE_LABEL = "MIELI Crisis Helpline" }`
  - `fun dialIntent(number: String): Intent` (`ACTION_DIAL`, `tel:` URI)
  - `class CrisisController(private val repo: FirestoreRepo, private val clock: () -> Long, private val scope: CoroutineScope) { val visible: StateFlow<Boolean>; fun onCrisis(reason: String) }`. Sets `visible = true` **synchronously**, then launches `repo.addAlert(Alert(level = crisis, kind = crisis, ...))`.
  - `CrisisScreen`: full-screen over the check-in, with large buttons "Call MIELI Crisis Helpline", "Call 112", and "Back to conversation". It never dials by itself.

- [ ] **Step 1: Verify the MIELI crisis line number on mieli.fi.** Put it in `CrisisNumbers.CRISIS_LINE` with a comment `// verified on mieli.fi <date>`.
- [ ] **Step 2: Write failing tests:**
  - `dialIntentUsesActionDial` (`assertEquals(Intent.ACTION_DIAL, dialIntent("112").action)`)
  - `crisisScreenVisibleBeforeAlertWriteCompletes` (repo fake suspends forever → `visible.value == true`)
  - `alertWrittenWithCrisisLevel`
- [ ] **Step 3: Run** `./gradlew :app:testDebugUnitTest --tests "*CrisisTest"`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS. Also run `grep -c CALL_PHONE android/app/src/main/AndroidManifest.xml`. Expected: `0`.
- [ ] **Step 6: Commit** `feat: one-tap crisis screen with instant clinician alert`.

---

### Task 14: Voice check-in session

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/session/{LiveVoiceClient.kt, AudioIO.kt, CheckinSession.kt}`
- Create: `android/app/src/main/kotlin/com/twoam/companion/voice/{FirebaseLiveVoiceClient.kt, AndroidAudioIO.kt, AppToolBackend.kt, CheckinViewModel.kt, CheckinScreen.kt}`
- Test: `android/core/src/test/kotlin/com/twoam/companion/core/session/CheckinSessionTest.kt`

**Interfaces:**
- Consumes: `ToolCatalog`, `ToolDispatcher`, `SessionRecorder`, `ProsodyAnalyzer`, `SystemPromptBuilder`, `InterventionRanker`, Google clients, `FirestoreRepo`, `CrisisController`, `docs/spike-results.md` (exact SDK calls).
- Produces:
  - `sealed interface LiveEvent { data class AudioOut(val pcm24k: ByteArray); data class InputText(val text: String); data class OutputText(val text: String); data class ToolCall(val id: String, val name: String, val args: JsonObject); data object Interrupted; data object TurnComplete }`
  - `interface LiveVoiceClient { suspend fun connect(systemInstruction: String, tools: List<ToolSpec>); suspend fun sendAudio(pcm16k: ByteArray); val events: Flow<LiveEvent>; suspend fun sendToolResponse(id: String, name: String, result: JsonObject); suspend fun close() }`
  - `interface AudioIO { val frames: Flow<ShortArray>; fun play(pcm24k: ByteArray); fun stopPlayback(); val agentSpeaking: Boolean; fun close() }`
  - `class CheckinSession(live: LiveVoiceClient, audio: AudioIO, dispatcher: ToolDispatcher, recorder: SessionRecorder, prosody: ProsodyAnalyzer) { suspend fun run(systemInstruction: String) /* returns when end() is called */; suspend fun end(): SessionResult }`
  - `data class SessionResult(val draft: SessionDraft, val voice: VoiceFeatures?)`
- Session behavior:
  - Each mic frame goes to `live.sendAudio` and to `prosody.accept(frame, gated = audio.agentSpeaking)`.
  - `AudioOut` → `audio.play`. `Interrupted` → `audio.stopPlayback()`.
  - `InputText`/`OutputText` → `recorder.addTranscript("patient"|"agent", …)`.
  - `ToolCall` → `dispatcher.dispatch` → `live.sendToolResponse`.
- App side:
  - `AndroidAudioIO` uses `AudioRecord(VOICE_COMMUNICATION, 16000, MONO, PCM_16BIT)` + `AcousticEchoCanceler` when available, and `AudioTrack` at 24 kHz. `agentSpeaking` = playback queue non-empty.
  - `FirebaseLiveVoiceClient` maps `ToolSpec` → Firebase `FunctionDeclaration` and uses the calls recorded in `docs/spike-results.md`, with input/output transcription enabled.
  - `AppToolBackend` implements `ToolBackend` with Task 12 clients (last known location from `FusedLocationProviderClient`), `FirestoreRepo`, and the `CrisisController.onCrisis` passed as the dispatcher's `onCrisis`.
  - `play_music` opens `spotify:search:<q>`, falling back to `https://open.spotify.com/search/<q>`.
  - `CheckinViewModel` builds `PromptContext` (intake, today's oriented z, last 7 days' voice z, `weather.summary` line, `InterventionRanker.guidance`, unrated interventions from the last 3 days) and runs the session. On end it saves the `Checkin` (via the tool), `VoiceFeatures` (Firestore + local store for Task 10), and calls Task 15.
  - `CheckinScreen`: a big "Talk" / "I'm done" button, live caption of the agent text, and the crisis overlay bound to `CrisisController.visible`.

- [ ] **Step 1: Write failing tests** with `FakeLiveVoiceClient` (a `MutableSharedFlow` of events, recording sends) and `FakeAudioIO`:
  - `micFramesGoToLiveAndProsody`
  - `framesDuringAgentSpeechAreGatedForProsody`
  - `toolCallIsDispatchedAndAnswered`
  - `interruptStopsPlayback`
  - `transcriptsRecordedBySpeaker`
  - `silentSessionEndsWithNullVoiceFeatures`
- [ ] **Step 2: Run** `./gradlew :core:test --tests "*CheckinSessionTest"`. Expected: FAIL.
- [ ] **Step 3: Implement `CheckinSession`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Implement the app classes.**
- [ ] **Step 6: Verify on the S24+.** A 2-minute check-in where the agent:
  - mentions sleep from real data
  - calls `get_weather` and `find_nearby_places`
  - creates a calendar event (visible in Google Calendar)
  - `voiceFeatures/{sessionId}` exists afterwards
  - reading a passage flatly and then animatedly gives a visibly lower `f0StdHz` for the flat reading
- [ ] **Step 7: H24 decision gate.** If the self-managed audio isn't stable by H24, switch `AndroidAudioIO` to the SDK's built-in audio conversation. Record the patient's mic PCM to `cacheDir/session.pcm`, and after the session send it to `REPORT_MODEL` with a prompt asking for `VoiceFeatures`-shaped JSON, then **delete the file**. Note the switch in `docs/spike-results.md`.
- [ ] **Step 8: Commit** `feat: live voice check-in with tools and prosody`.

---

### Task 15: Session report and intake (structured Gemini)

**Files:**
- Create: `android/core/src/main/kotlin/com/twoam/companion/core/report/{SessionReportPrompt.kt, SessionReportParser.kt, IntakePrompt.kt}`
- Create: `android/app/src/main/kotlin/com/twoam/companion/report/{ReportGenerator.kt, IntakeScreen.kt}`
- Create: `docs/demo/fictional-intake.md` (a clearly fictional post-TMS intake report)
- Test: `android/core/src/test/kotlin/com/twoam/companion/core/report/SessionReportTest.kt`

**Interfaces:**
- Consumes: `SessionDraft`, `VoiceFeatures`, `Metric`, `SessionReport`.
- Produces:
  - `object SessionReportPrompt { fun build(draft: SessionDraft, voiceOriented: Map<Metric, Double?>, todayOriented: Map<Metric, Double?>): String; val responseSchemaJson: String }` (schema fields = `SessionReport` minus ids/time)
  - `object SessionReportParser { fun parse(json: String?, draft: SessionDraft, voiceOriented: Map<Metric, Double?>, atMillis: Long): SessionReport; fun fallback(draft: SessionDraft, voiceOriented: Map<Metric, Double?>, atMillis: Long): SessionReport }`
  - The parser always fills `emotions` from `draft.emotions` and `voiceSignals` from `voiceOriented` (keys = `Metric.key`), not from the model.
  - It caps `flaggedQuotes` to 3, each ≤ 200 chars. If `draft.crisis` it forces `riskChange = "escalated"`.
  - `fallback`: mood from `draft.checkin`, `themes = []`, `riskChange = "unknown"`, `sleepSummary = ""`.
  - `object IntakePrompt { fun build(reportText: String): String }`. Output: a plain ≤ 120-word summary.
  - app `class ReportGenerator(repo: FirestoreRepo) { suspend fun generate(result: SessionResult, voiceOriented: Map<Metric, Double?>, todayOriented: Map<Metric, Double?>) }`. Firebase AI `generativeModel(REPORT_MODEL)` with JSON response schema, a **15 s timeout → fallback**, then saves. The draft (transcript) is dropped afterwards.
- [ ] **Step 1: Write failing tests:**
  - `promptContainsEmotionLabelsAndForbidsDiagnosis`
  - `parseValidJson`
  - `malformedJsonFallsBack`
  - `nullJsonFallsBack`
  - `quotesCappedTo3x200`
  - `crisisForcesEscalated`
  - `voiceSignalsComeFromMeasurementNotModel`
- [ ] **Step 2: Run** `./gradlew :core:test --tests "*SessionReportTest"`. Expected: FAIL.
- [ ] **Step 3: Implement the core, then the app classes.** `IntakeScreen`: paste text → summary → `repo.setIntake`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify on device.** After a check-in, `sessionReports/{sessionId}` appears within ~10 s.
- [ ] **Step 6: Commit** `feat: automatic session reports and intake summary`.

---

### Task 16: Firestore rules, alert emails, silence check

**Files:**
- Create: `firebase/firestore.rules`, `firebase/functions/src/{index.ts, alerting.ts, types.ts}`
- Test: `firebase/functions/test/{alerting.test.ts, rules.test.ts}`

**Interfaces:**
- Consumes: the Task 1 contract (mirrored in `types.ts`).
- Produces:
  - `alerting.ts`: `export function buildAlertEmail(alert: Alert, patient: PatientDoc): { subject: string; text: string } | null` (null for amber; subject prefix `[CRISIS]` or `[RED]` + displayName; text = reason + dashboard link `https://<project>.web.app/patient.html?id=<id>`)
  - `alerting.ts`: `export function shouldFlagSilent(p: PatientDoc, hasOpenSilentAlert: boolean, nowMs: number): boolean` (true iff `!p.synthetic && p.lastSeenAtMillis != null && nowMs - p.lastSeenAtMillis > 24h && !hasOpenSilentAlert`)
  - `index.ts`:
    - `onAlertCreated` = `onDocumentCreated("alerts/{id}")` → writes `mail/{auto}` `{to: patient.clinicianEmail, message: {subject, text}}` when the email isn't null; also writes `patients/{id}.risk = "red"` for red/crisis.
    - `checkSilence` = `onSchedule("every 60 minutes")` → adds `Alert{level: red, kind: silent, reason: "No data from phone for over 24 hours"}`.
  - Rules: a patient (`request.auth.uid == patientId`) can read/write their own `patients/{id}` + `daily`, and create docs in `checkins|interventions|sessionReports|voiceFeatures|alerts` where `request.resource.data.patientId == request.auth.uid`. A clinician (`request.auth.token.email == get(/patients/$(pid)).data.clinicianEmail`) can read all of that patient's docs and update only `alerts.acknowledged`. `mail` and `digests` are function-only writes; clinicians can read their patients' digests.
- [ ] **Step 1: Write failing tests:**
  - `amberAlertSendsNoEmail`
  - `crisisSubjectStartsWithCRISIS`
  - `silent23hFalse`
  - `silent25hTrue`
  - `syntheticNeverSilent`
  - `openSilentAlertNotDuplicated`
  - `neverSeenNotSilent`
  - rules: `patientCannotReadOtherPatientsCheckins`, `clinicianReadsOwnPatient`, `clinicianCannotWriteDaily`, `patientCannotCreateAlertForOtherPatient`, `clinicianCanOnlyToggleAcknowledged`
- [ ] **Step 2: Run** `cd firebase/functions && npx vitest run test/alerting.test.ts` and `cd firebase && firebase emulators:exec --only firestore "cd functions && npx vitest run test/rules.test.ts"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Install the "Trigger Email from Firestore" extension (collection `mail`) with team SMTP credentials.
- [ ] **Step 4: Run both commands.** Expected: PASS.
- [ ] **Step 5: Deploy** `firebase deploy --only firestore:rules,functions`. Create a test red alert in the console. Expected: an email arrives at `CLINICIAN_EMAIL`.
- [ ] **Step 6: Commit** `feat(firebase): rules, clinician alert emails, silence check`.

---

### Task 17: Weekly digest

**Files:**
- Create: `firebase/functions/src/digest.ts`
- Modify: `firebase/functions/src/index.ts`
- Test: `firebase/functions/test/digest.test.ts`

**Interfaces:**
- Consumes: `SessionReport`, `DailyDoc` types (Task 16).
- Produces:
  - `export function isoWeekKey(d: Date): string` (e.g. `"2026-W46"`)
  - `export function buildDigestPrompt(p: PatientDoc, reports: SessionReport[], days: DailyDoc[]): string`
  - `weeklyDigest` = `onSchedule({schedule: "every monday 07:00", timeZone: "Europe/Helsinki"})`
  - `generateDigestNow` = `onCall` (requires the caller's email to equal `patient.clinicianEmail`; input `{patientId}`)
  - Both write `digests/{patientId}_{week}` `{patientId, week, text, generatedAtMillis}` using `@google/genai`, model `"gemini-2.5-flash"`, secret `GEMINI_API_KEY`.
- [ ] **Step 1: Write failing tests:**
  - `weekKeyForNov13_2026IsW46`
  - `weekKeyForJan1_2026IsW01`
  - `promptListsEachReportsThemes`
  - `promptForbidsDiagnosis`
  - `emptyWeekSaysNoCheckins`
- [ ] **Step 2: Run** `npx vitest run test/digest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Deploy** and call `generateDigestNow` from the dashboard (after Task 20) or the shell.
- [ ] **Step 6: Commit** `feat(firebase): weekly clinician digest`.

---

### Task 18: Seed synthetic patients

**Files:**
- Create: `firebase/seed/{synth.mjs, seed.mjs, package.json}`
- Test: `firebase/seed/test/synth.test.mjs`

**Interfaces:**
- Produces:
  - `export function makePatient(profile: "stable"|"improving"|"crisis", name: string, clinicianEmail: string, today: string): { patient, daily: DailyDoc[21], reports: SessionReport[5], interventions: Intervention[], alerts: Alert[] }` (deterministic, `synthetic: true`)
  - `seed.mjs` writes Aino (stable, green), Juhani (improving, green), Laura (crisis, red, with `sleep_collapse` + `crisis` alerts), using firebase-admin. It honors `FIRESTORE_EMULATOR_HOST`. `CLINICIAN_EMAIL` comes from the env.
  - Daily docs include HRV values (covers the "HRV: seeded" case).
- [ ] **Step 1: Write failing tests:**
  - `each profile has 21 consecutive daily docs ending today`
  - `crisis profile is red with a crisis alert`
  - `all docs synthetic`
  - `interventions have outcomeScore for ranking`
- [ ] **Step 2: Run** `cd firebase/seed && node --test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `CLINICIAN_EMAIL=... node seed.mjs` → 3 patients visible in the console.
- [ ] **Step 5: Commit** `feat(firebase): synthetic demo patients`.

---

### Task 19: Clinician dashboard: patient list and alert banner

**Files:**
- Create: `firebase/hosting/{index.html, styles.css}`, `firebase/hosting/js/{firebase.js, list.js}`, `firebase/hosting/js/lib/{sort.js, alerts.js}`, `firebase/hosting/assets/alert.mp3`
- Test: `firebase/hosting/test/{sort.test.mjs, alerts.test.mjs}`

**Interfaces:**
- Consumes: the `patients` and `alerts` collections.
- Produces:
  - `sort.js`: `export function sortPatients(patients, latestAlertAtById)`. Order: red > amber > green, then latest alert time desc, then displayName.
  - `alerts.js`: `export function newAlertIds(prevIds /* Set|null */, alerts)`. Returns `[]` when `prevIds` is null (initial load), else the ids not in `prevIds`. Also `export function bannerAlerts(alerts)`: unacknowledged red/crisis, newest first.
  - `firebase.js`: init + email/password sign-in form; exports `db`, `auth`.
  - `list.js`: live `onSnapshot` of the clinician's patients (`where clinicianEmail == auth email`) and their alerts. It renders risk chips with reasons and a red banner (patient name, reason, time, "Acknowledge" button → sets `acknowledged: true`), and plays `alert.mp3` for each id from `newAlertIds`.
- [ ] **Step 1: Write failing tests:**
  - `redBeforeAmberBeforeGreen`
  - `sameRiskNewerAlertFirst`
  - `initialLoadPlaysNoSound`
  - `newAlertDetected`
  - `bannerExcludesAmberAndAcknowledged`
- [ ] **Step 2: Run** `cd firebase/hosting && node --test test/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify.** `firebase serve --only hosting`, sign in, see 3 seeded patients sorted with Laura first. A console-created crisis alert makes a sound plus a banner within seconds.
- [ ] **Step 6: Commit** `feat(dashboard): risk-sorted patient list with live alert banner`.

---

### Task 20: Clinician dashboard: patient detail

**Files:**
- Create: `firebase/hosting/{patient.html}`, `firebase/hosting/js/{detail.js}`, `firebase/hosting/js/lib/{series.js, whatWorks.js}`
- Test: `firebase/hosting/test/{series.test.mjs, whatWorks.test.mjs}`

**Interfaces:**
- Consumes: `daily`, `sessionReports`, `interventions`, `alerts`, `digests`, and the `generateDigestNow` callable.
- Produces:
  - `series.js`: `export function toSeries(dailyDocs, key, field = "metrics")`. Returns `{labels: string[], values: (number|null)[]}`, sorted by date, with nulls kept as gaps.
  - `whatWorks.js`: `export function whatWorks(interventions)`. Returns `[{type, mean, n}]` using only non-null `outcomeScore`, sorted by mean desc then n desc.
  - `detail.js` (`patient.html?id=`), with these sections:
    - header (risk + reasons)
    - this week's digest + "Generate now" button
    - 14-day Chart.js lines for sleep, steps, resting HR/HRV, time at home, late-night screen
    - "Voice signals" chart (pitchStdHz, speechRateSps, pauseRatio)
    - session report cards (mood, themes, emotions, voice signals vs usual, suggestion, previous outcome, flagged quotes)
    - "What works" table
    - alert history
  - Copy says "voice signals", never "diagnosis".
- [ ] **Step 1: Write failing tests:**
  - `seriesSortedByDate`
  - `seriesKeepsNullGaps`
  - `whatWorksSkipsUnscored`
  - `whatWorksSortedByMeanThenCount`
- [ ] **Step 2: Run** `node --test test/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Verify.** Laura's page shows gaps where data is null, report cards, the "what works" ranking and a digest after "Generate now". Run `grep -ri diagnos firebase/hosting/*.html firebase/hosting/js`. Expected: no UI copy matches.
- [ ] **Step 6: Deploy** `firebase deploy --only hosting`, then commit `feat(dashboard): patient detail with trends, reports, what works`.

---

### Task 21: Demo controls, script, rehearsal

**Files:**
- Create: `android/app/src/main/kotlin/com/twoam/companion/demo/{DemoOverrides.kt, DebugPanel.kt}`, `docs/demo-script.md`
- Modify: `SnapshotBuilder` (apply overrides), `DailyWorker` (mark `demoOverride: true`)

**Interfaces:**
- Consumes: `DailyWorker.runNow`, `FirestoreRepo.heartbeat`, `CheckinViewModel`.
- Produces: `DebugPanel`, opened by tapping the title 5 times, with these controls:
  - "Run daily job now"
  - "Simulate two rough nights" (sleep 240 min on the last 2 nights + late-night screen 90 min → amber + nudge)
  - "Simulate next day" (clock offset +1 day for the prompt, so the agent asks about yesterday's walk)
  - "Silence test" (sets `lastSeenAtMillis = now − 25 h` once; `checkSilence` then raises red)
  - "Seed HRV" (only if spike says HRV absent)

  Overrides only ever affect `demoOverride`-flagged docs.
- [ ] **Step 1: Implement the panel and overrides.**
- [ ] **Step 2: Write `docs/demo-script.md`** following the spec's 6-step demo script, with the exact taps and lines to say, including the scripted crisis line. Add a pre-demo checklist: phone charged, hotspot ready, dashboard signed in, seed fresh, crisis number verified.
- [ ] **Step 3: Run the full demo end to end on the S24+.** Check each spec Verification line:
  - session report on the dashboard ≤ 10 s
  - flat vs animated prosody differs
  - silence test → red alert + email, and **no** crisis screen on the phone
  - crisis line → crisis screen + clinician alert, no dialing
- [ ] **Step 4: Record the backup video** of the full run and store its link in `docs/demo-script.md`.
- [ ] **Step 5: Commit** `feat: demo controls and rehearsed demo script`.
