# Design QA · 2am patient app and clinician dashboard

final result: passed

## Comparison targets

| | Path |
| --- | --- |
| Source visual truth (patient) | `design/patient/reference/small-step-refined.png` (selected Small Step target) |
| Source references (voice, dashboard) | Claude Design artifacts (patient flow and dashboard), reviewed locally; captures not kept and orb-ui.com "cloud" theme (motion reference) |
| Implementation, patient | `http://127.0.0.1:5173/` (dev), captures `design/qa/patient-today-screen.png`, `patient-today-night-screen.png`, `patient-voice-speaking-screen.png`, `patient-voice-offer-screen.png` |
| Implementation, clinician | `http://127.0.0.1:5174/` (dev), captures in `design/deck/shots/c-*.png` |
| Side-by-side evidence | `design/qa/deck-today-compare.png` (target and Today build in one frame) |

## Capture settings

- Patient: headless Chromium, viewport 1400 × 1200, deviceScaleFactor 2. `[data-testid=device-screen]` verified at 393 × 852 CSS px before every capture (the build script throws otherwise). Screen captures are 788 × 1704 px.
- Source target: 852 × 1846 px, the same 0.461 aspect as the 393 × 852 screen. Compared at equal display height; no density finding was filed.
- Clinician: 1440 × 960 at 1.5×, 768 × 1024 at 2× and 390 × 844 at 2×.
- State for Today: `?hour=10` (morning, returning Patient, everyday scenario). Voice: `?screen=check&at=1` and `at=8`, frozen so the caption is complete.
- Runtime check: `npm run check:runtime` passed (28 protected files) before capture.

## Full-view comparison

Today, target and build side by side (`deck-today-compare.png`): the composition, order, palette, pill action, Suggestion card with landscape and three-tab bar match. Headline, action label and Suggestion title now match the target's proportions. The build adds one quiet line, `Friday 13 November · Good morning, Alex`, above the headline; this is an intended adoption from the Claude artifacts. The device status bar and home indicator are template chrome and are not judged.

Voice session against the Claude board (compared side by side during review; captures not kept): the build keeps the artifact's single orb, state colours, speaker-labelled caption and step marker on the plain 2am ground, without the painted landscape. The caption cannot be hidden, as the requirements need.

## Focused regions

- Headline and primary action on Today: weight, size and tracking compared at equal height; matched after iteration 2.
- Suggestion card: image crop, title size, link position above the tab bar; matched after iteration 2.
- Orb: texture, colour per state and night dimming checked at the orb crop for speaking, listening, thinking, muted and night.
- Booking sheet: fields, action and keyboard absence checked at full screen after iteration 3.

## Iteration history

**Iteration 1 · blocked**

- [P1] Night theme text unreadable. The runtime base style `p{color:#555}` overrode the night ink on dark ground. Fix: route paragraph colour through a `--p-body` token. Evidence after fix: `patient-today-night-screen.png`, voice-at-night slide.
- [P1] Microphone icon invisible on the primary control. The shared `button{color:inherit}` reset beat `.live-mic`. Fix: raise specificity.
- [P2] Voice controls sat on the home indicator: `--mobile-safe-area-height` is undefined outside `.mobile-page`, which invalidated the padding. Fix: `--p-safe` token from `--device-safe-area-bottom`.
- [P2] Night deck shots rendered in day colours (`hour` passed twice). Fix in `design/deck/build.cjs`.
- [P2] Suggestion card's main action below the fold behind the voice controls. Fix: compact orb (112 px) once the card appears.
- [P2] `Listening…` placeholder shown while disconnected. Fix: empty caption when blocked.

**Iteration 2 · blocked**

- [P2] Today type ran about 1.3× smaller than the target, and every paragraph was 14 px because of the runtime `p{font-size:14px}`. Fix: paragraphs inherit 16 px; Today headline 44 px/700, action 22 px, Suggestion title 28 px.
- [P2] Primary buttons rendered at regular weight: `font: inherit` on buttons reset `.p-primary`'s 600. Fix: restore the weight with matching specificity.
- [P2] Orb rendered as the CSS fallback in development: the WebGL cleanup released the context that React's second development mount reused. Fix: no manual context release. Frozen frames drew before layout; fix: `ResizeObserver` repaint in still mode.

**Iteration 3 · passed**

- [P2] Booking sheet showed the text keyboard over its action. Two causes: date and time used `KeyboardInput`, and focus inside the sheet scrolled the clipped phone screen to reveal the hidden keyboard. Fix: native date and time inputs, and the phone screen's scroll pinned to 0. Evidence: booking slide in `design/deck/2am-screens.pdf`.
- [P2] Impeccable detector: orb resize animated width, height and inset. Fix: removed; only colour crossfades. Detector now returns no findings for the patient files.
- Post-fix evidence: `deck-today-compare.png`, `deck-voice.png`, full deck rebuilt with `{"slides":40,"errors":[]}`.

## Required fidelity surfaces

- Fonts and typography: system sans as in the target; Today sizes matched; tracking tightens on large type. Runtime Roboto appears only in the Pixel status bar (template chrome, suppressed in Impeccable with a stated reason).
- Spacing and layout: 24 px margins, card radius 20, pill actions, tab bar height consistent with the target.
- Colours and tokens: `#FAFAF7` ground, `#233C4C` ink, `#E9EDF0` card; night palette contrast checked by eye on device captures. Orb gradients use the same palette.
- Images: target landscape and the generated Finnish lakeside photo are both used as atmosphere; no asset was replaced with a code drawing. Phosphor icons are official SVGs.
- Copy: Today copy matches the target word for word; night copy and voice lines are new and short.

## Interactions and console

Checked in the in-app browser and headless Chromium: voice session advance, tap-to-interrupt, mute, type switch, Suggestion accept / smaller / not now, booking sheet, deep links for every deck state, clinician filters, patient tabs and modals. Headless captures reported no page errors; the in-app browser console showed no errors on the voice session.

## Residual gaps (not blocking)

- [P3] Greeting line above the Today headline is an addition to the target.
- Not done: Pixel 10 captures, a full VoiceOver and keyboard-only pass, real microphone and Gemini Live audio, and testing on a physical phone.
- Clinician screens have no single selected image target; they were reviewed against the Claude dashboard artifact and the interface spec.

## Implementation checklist

All P0 to P2 items above are fixed. Follow-up polish: decide whether to keep the greeting line, then capture Pixel 10 and run the screen-reader pass.
