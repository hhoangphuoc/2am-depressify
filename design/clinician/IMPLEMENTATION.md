# Clinician prototype

Implemented only the Clinician interface under `src/`. Existing bootstrap, dependency files, hosting scripts, worker and hosting tests were left intact. Build output was regenerated with the existing build command. The running dashboard server was left to the main agent.

## Interface

- Initially signed in; sign out to explore email/password validation and simulated sign-in. Demo credentials: `clinician@example.test` / `smallstep`.
- Patient roster with computed Attention counts, red-first ordering, search, filters, a red banner, connection freshness, and explicitly enabled sound. Four invented profiles include Alex's simulated phone scenario.
- Patient Overview, Summaries, Signals, and Intake & Visits. Desktop Overview uses a two-thirds timeline and one-third supporting column. Mobile uses a single column. Palette, system typography, 220 px desktop sidebar, 24 px gutters and restrained surfaces follow the selected Small Step direction.
- Mood rating, PHQ-2 and PHQ-9 occupy separate, aligned chart lanes. Canvas charts have accessible HTML data tables. Missing values are gaps, never zero. Visits and Phases use actual dates, including backdated Visits. Missing TMS end date suppresses the week count and Phases until entered.
- Eight Signal trends compare only with the Patient's own preceding 14 days using the median, requiring five valid days. Alex's HRV is always missing; no seeded fallback is substituted into the phone scenario. Calendar contains only busy-time aggregates.
- The latest Elias Summary uses the supplied text, ratings 3/2/3, short-walk Suggestion, previous tried Outcome feeling 4/5, and observational Voice cue “Long pauses”. Mood charts agree with their corresponding Summaries. No conversation archive is present.
- Weekly Digest read/generate, pending/error/retry and timestamps; its content and source list use actual synthetic Summaries. “What seems to help” counts reported Outcomes and feelings, with no causal or adherence claim.
- Visit recording validates dates and type-specific integer PHQ ranges; saves leave flags unchanged. Intake accepts fictional pasted text or local `.txt` / `.md` files up to 100 KB, previews extracted highlights, then saves highlights only. Both support failure/retry without dropping form edits.
- Multiple uncleared reasons retain their highest flag level. A new amber cannot downgrade red. Each raised and cleared reason stays in history. Clearing requires confirmation that action was taken on every reason; an optional local action note is a prototype proposal.
- An ordinary assessment timeout displays unavailable, with prior flags retained. It does not silently produce green. Explicit retry runs a simulated assessment. Phone silence is described as a quiet phone, not an inference about self-harm.
- Sharing withdrawal removes identifying display content, Summaries, Signals, Intake, Visits, TMS date, flags and history from that in-memory record, and suppresses future flags and alerts. Changing view or resetting demo views cannot restore that deleted record. Reload creates a fresh, entirely invented dataset.
- Native modal dialogs provide protected focus, Escape dismissal, initial focus and restoration. Keyboard buttons, visible focus, mobile 44 px targets, reduced motion, and semantic forms/tables are implemented.

## Prototype controls

The separate footer disclosure **Prototype states** reaches empty/no-match/loading, offline/stale, denied/expired, unavailable Signals, insufficient Baseline, assessment timeout, new amber while red remains, missing TMS end date, sharing withdrawal, generation/extraction failure, save failure, phone silence, and sign-in retry. Operation failures happen once per mounted workflow; retry then succeeds. The clock is intentionally frozen at 13 Nov 2026, 14:20 Helsinki.

## Verification

- `node src/data.selfcheck.mjs` passed: ordering without mutation, both PHQ ranges, null/zero distinction, Baseline minimum, Digest sources, missing phone data, flag priority/history, timeout, Consent deletion/suppression, device HRV, and backdated Phase boundaries.
- `npm run build` passed and produced the existing Sites client/server/hosting artifacts.
- `npm run test:sites` passed all four existing packaging/worker checks.
- Impeccable detector over the changed UI sources returned no findings.
- No browser, screenshot, keyboard, screen-reader, audio-output, or device testing was performed by this agent. Main agent owns browser testing at 390/768/1440 and the running server.

## Limits

This is a design prototype, not a production healthcare implementation. Authentication, automatic assessment, extraction, generation, email statuses and saves are local simulations. Extraction splits fictional text into short highlights; it is not model extraction or PDF/OCR. The dataset, all measurements and all people are invented; there are no real health, microphone, calendar, email, identity or backend connections. Nothing is persisted across page reloads. Actual authentication, Consent propagation/deletion, retention, authorization and delivery guarantees require the production backend.
