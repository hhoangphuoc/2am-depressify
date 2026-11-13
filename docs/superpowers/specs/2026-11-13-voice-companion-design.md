# Design: Daily voice companion for staying well after TMS (Junction 2026, Aalto challenge)

## Context
Aalto's challenge: help people stay well at home after TMS depression treatment. The challenge asks for a **closed loop** (sense how the person is doing → respond with something that helps → learn what works for this person), and suggests a clinician view showing who needs a call. The repo currently holds only `docs/context/ideas-junction.md`.

Decisions by the user:
- The heart of the demo is a **live voice companion**. Google APIs (Maps/Places, Calendar, Weather, Health) are the agent's tools.
- Team: **2–3 devs, ~48h, strong in Kotlin**. **Real phone sensors.**
- Stack **A: Android-native Kotlin**. Clinician view: **small web page**.
- Demo device: teammate's **Galaxy S24+ + Galaxy Watch**. An Apple Watch can't feed an Android app, so it isn't used.
- **Automatic clinician reporting** after every session + periodic summaries, **anomaly detection**, and an **emergency path to a crisis line**.
- Emergency rule: **one-tap call + instant clinician alert**. The person places the call; the app never dials by itself. Sensor-only anomalies only ever alert the clinician.
- **Voice emotion detection, both layers:** Gemini notes emotions live, and the phone measures prosody (pitch variation, speech rate, pauses) against the person's normal.
- The user is collecting **public research and open data** separately (see Open data).

## Goals / non-goals / anti-goals
- **Goals:**
  - A 3-minute daily voice check-in that knows the person's real context (body, behavior, voice, weather, calendar) and suggests one concrete, doable action: book it, route it, play it.
  - The system learns which actions help this person.
  - Every session produces a clinician report automatically.
  - Anomalies reach the clinician, and a crisis reaches a hotline within one tap.
- **Non-goals (this weekend):** iOS, KMP/web patient app, mood-from-playlist (Spotify closed that API in Nov 2024), blood, analyzing video calls, booking classes, diagnosis, auto-dialing.
- **Anti-goals:**
  - A chatty app that nags a low-energy person.
  - Raw sensor samples, audio or full transcripts leaving the phone.
  - Presenting emotion signals as a diagnosis.
  - The agent handling a crisis by itself.

## Approaches considered
- **A. Android-native Kotlin (chosen):** Compose + Firebase AI Logic (official Gemini Live SDK) + Health Connect + Firestore + WorkManager + Cloud Functions.
- B. KMP shared core: wiring the Live websocket/audio by hand costs about a day. Rejected for 48h.
- C. Web/PWA: can't read Health Connect. Rejected.
- Voice emotion alternatives: "Gemini only" (cheap but not credible to clinicians) and "send audio to Gemini after the session" (audio leaves the phone). The latter remains the **fallback** if the on-device audio wiring slips.

## Architecture
```
Galaxy Watch ─▶ Samsung Health ─▶ Health Connect ─┐
Phone: location, UsageStats (late-night screen) ──┤
Mic (during check-in) ─▶ ProsodyAnalyzer ─────────┤
                                                  ▼
Android app (Kotlin/Compose)
  sensing → DailySnapshot → baseline (14-day z-scores) → risk + anomaly rules
  WorkManager ─▶ gentle "want to talk?" nudge        ─▶ alerts (amber/red)
  Voice check-in: Gemini Live (Firebase AI Logic) + tools (incl. note_emotion)
  End of session ─▶ Gemini structured SessionReport
        │ aggregates + reports only
        ▼
Firestore ──▶ Cloud Functions (red alert → clinician email/push; weekly digest)
   ▲
Clinician web page (Firebase Hosting, HTML/JS + Chart.js, live listeners)
```

### Sensing (on device)
- Health Connect: Steps, SleepSession, HeartRate, RestingHeartRate, HeartRateVariabilityRmssd (**check in hour 0 whether Samsung writes HRV. If it doesn't, use resting HR and seed HRV**).
- Mobility: periodic FusedLocation samples → time at home + radius of gyration.
- Late-night screen time: UsageStatsManager (special permission, fine for sideloading).
- Baseline: 14-day rolling mean/std per metric, bootstrapped from the watch's existing Samsung Health history.

### Voice emotion (two layers)
1. **Live perception:** the native-audio Live model hears tone, sighs, flat affect and hesitation. The system prompt tells it to call `note_emotion(label, intensity 1–5, cue)` when it notices something and to adapt its replies. These events go into the session report.
2. **Measured prosody (on device):**
   - The app captures the mic itself: `AudioRecord`, `VOICE_COMMUNICATION` source, echo canceller on, 16 kHz PCM.
   - Each frame is fed both to the Live session (realtime audio input) and to a `ProsodyAnalyzer`. The analyzer uses YIN pitch detection (e.g. TarsosDSP) and an energy-based voice detector.
   - Per session it computes: F0 mean + variability, speech rate (syllable-peak estimate), pause ratio, mean pause length, loudness.
   - Only the patient's frames are analyzed, not the agent's playback.
   - These go into the snapshot as a voice baseline + z-scores. Reduced pitch variability, slower speech and longer pauses are the markers reported in the literature.
   - Audio is never stored.
- Fallback if the self-managed audio slips past about H24: use the SDK's built-in audio conversation, and send the session audio to Gemini afterwards for a structured prosody/emotion assessment, then delete it.
- Wording everywhere: "voice signals," never "diagnosis."

### Proactive nudge (WorkManager every ~6h + hidden demo button)
Sleep z < −1 for 2 nights **and** (time at home high **or** late-night screen high) → one gentle notification, at most once a day.

### Voice check-in (Gemini Live via Firebase AI Logic; verify the current native-audio model ID at build time)
- Prompt assembled per session: intake summary, today's snapshot vs baseline (including voice z-scores from recent sessions), weather, and the top interventions that have worked. Fixed shape: how you slept → what I noticed → one suggestion → commit.
- Enable input/output transcription so the session report can be generated.
- Tools:
  - `get_health_summary(days)`
  - `get_weather()`: Google Weather API, current/hourly/daylight
  - `find_nearby_places(kind)`: Places API (New)
  - `get_walking_route(place_id)`: Routes API or a Maps deep link
  - `get_free_slots(date)`, `create_calendar_event(...)`: Calendar API, OAuth testing mode
  - `play_music(genre_or_mood)`: deep link
  - `note_emotion(label, intensity, cue)`
  - `record_checkin(mood, energy, sleep_quality, phq2_a, phq2_b)`
  - `log_intervention(type, details)`
  - `escalate_to_clinician(reason, severity)`
- Maps/Places/Weather/Routes over REST with an Android-restricted API key. Requires the Firebase Blaze plan + Maps billing (free credit).

### Clinician reporting and escalation
| Level | Trigger | What happens |
|---|---|---|
| **Session report** | every check-in ends | App calls Gemini (structured output) with the transcript, note_emotion events, prosody z-scores, snapshot and interventions. The resulting `SessionReport` (mood, sleep, themes, emotion + voice signals, suggestion, previous outcome, risk change, short flagged quotes) goes to `sessionReports`, and the dashboard updates live. The full transcript is discarded. |
| **Weekly digest** | scheduled Cloud Function (+ "generate now" button) | Gemini summarizes the week's reports and trends into a one-paragraph digest per patient. |
| **Amber** | sustained drift (z-score composite over several days) | Patient moves up the dashboard list with the reason shown. |
| **Red / anomaly** | sharp break: e.g. no phone activity + no steps for 24h, sleep collapse, missed check-ins + low mood, PHQ-2 ≥ 3 | `alerts` doc → Cloud Function → clinician email/push; red banner with sound on the dashboard. **No patient-facing emergency action.** |
| **Emergency** | the agent calls `escalate_to_clinician(severity=crisis)` on suicidal intent | Agent stays calm and present. Full-screen **"Call crisis line" / "Call 112"** one-tap buttons (`ACTION_DIAL`, prefilled). Instant red alert to the clinician. The person places the call. (Verify the MIELI crisis line number.) |

### Learn step
- Each suggestion becomes an `intervention`. Its outcome = the next check-in's "did it help?" (1–5) + that day's objective change (steps/time outside vs baseline).
- Per-type average score; the top 3 go into the prompt. About 1 in 5 suggestions deliberately tries something new.
- The dashboard shows "what works for this patient."

### Risk score
Transparent rules, not ML: weighted z-scores (sleep, mobility, late-night screen, resting HR/HRV, voice prosody) + latest mood + PHQ-2 → green/amber/red. Any crisis forces red.

### Firestore (aggregates only)
`patients/{id}` (profile, intake summary, clinician email) · `patients/{id}/daily/{date}` (metrics, z, risk) · `checkins/{id}` · `sessionReports/{id}` · `voiceFeatures/{sessionId}` · `interventions/{id}` · `alerts/{id}` · `digests/{patient}_{week}`.
Auth: anonymous for the patient demo, email for the clinician. Basic security rules.

### Intake (small)
A **fictional** clinical report → Gemini structured output → intake summary.

### Clinician web page
- Alert banner.
- Patient list sorted by risk.
- Patient detail: 14-day trends (including voice signals), session reports, weekly digest, what works, alert history.
- 3–4 seeded synthetic patients plus the one live patient.

### Open data (user is gathering)
Candidate uses: calibrating the prosody and passive-sensing thresholds, and citing evidence in the pitch.
- Known sources: StudentLife, GLOBEM (phone sensing + depression scores), DAIC-WOZ (depression interviews, licensed), RAVDESS / CREMA-D (open emotional speech).
- The design doesn't depend on any of them; thresholds start as personal-baseline z-scores.
- **Evaluated: OpenNeuro ds003478** (resting EEG + BDI/STAI/HAM-D, 122 students, one visit, no treatment). Not in the runtime loop. It's used only for seed realism and one pitch claim ("self-report alone isn't enough"). See `docs/superpowers/specs/2026-11-13-open-data-ds003478-design.md` and `docs/research/ds003478/findings.md`.

## Demo script (~3 min)
1. The dashboard shows four patients, with the live one in amber.
2. The phone gets a nudge: "Rough couple of nights — want to talk?"
3. Live voice: the agent hears a flat tone (note_emotion), mentions the poor sleep, finds the daylight window and a park, and books the walk.
4. The session ends → the session report appears on the dashboard with voice signals vs baseline.
5. Simulated next day: "Did the walk help?" → the "what works" ranking updates.
6. A scripted crisis line → one-tap crisis screen on the phone + a red alert email/banner for the clinician.

## Team split and timeline
- Dev 1: Live session, prompt, tools, Google API clients, session-report generation.
- Dev 2: Health Connect/sensing, **audio capture + ProsodyAnalyzer**, baseline, risk/anomaly rules, Firestore sync.
- Dev 3: dashboard, Cloud Functions (alerts, digest), seed data, intake, pitch.
- With 2 devs: Dev 2 takes the dashboard; Cloud Functions alerts become dashboard banner only; drop intake.
- H0–4: spikes: Live talking on the S24+ **with self-managed AudioRecord input**, Health Connect reads (HRV?), Maps/Calendar keys.
- H4–16: tools, snapshot, prosody features, schema, dashboard list.
- H16–30: session reports, alerts/escalation, learn step, nudges, risk, dashboard detail. **H24 decision on the prosody fallback.**
- H30–40: prompt polish, demo data, crisis flow rehearsal.
- H40–48: freeze, rehearse, **record a backup video**.

## Left to the builder
Package layout, UI styling, exact prompt wording, risk and anomaly thresholds, prosody algorithm details, chart styling, email vs web push for alerts.

## Verification
- Hour-0 spikes pass on the S24+.
- A full demo run end to end on the device.
- A session report appears on the dashboard within ~10 s of the session ending.
- The prosody features differ visibly between a flat and an animated test reading.
- A simulated 24h-silent anomaly creates a red alert + email, and no patient-facing crisis screen.
- A crisis phrase shows the one-tap call screen + a clinician alert, with no auto-dial.
- The backup video is recorded.

## Next steps after approval
Save as `docs/superpowers/specs/2026-11-13-voice-companion-design.md`, commit, then write the implementation plan (superpowers:writing-plans).
