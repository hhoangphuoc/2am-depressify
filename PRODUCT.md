# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

This workspace contains web design prototypes for an Android-first Kotlin Multiplatform Patient app and a web Clinician dashboard. The Patient prototype preserves native-style preview infrastructure; it is not the native implementation.

## Users and purpose

Patients at home after a TMS course use a short spoken or typed AI Check-in between Visits. Clinicians follow shared progress and identify who may need follow-up. The loop is Sense, Respond with one Suggestion, and Learn from its Outcome.

## Confirmed constraints

The merged `docs/context/system-design.md`, current ADRs and `GLOSSARY.md` own product behaviour. Wellbeing support, never treatment advice or diagnosis. Same Summary for Patient and Clinician; no saved raw conversation archive. Signals require separate Consent. Patient never sees Attention flags. Missing data is not zero. Current v1 scope and synthetic demo boundaries remain in force.

## Brand commitments

User selected option 3, Small Step, then requested minimalist, calm, friendly, illustrative, less distracting UI with less text and noise. Apple Design, Emil Design Engineering, Design Taste, Impeccable and imagegen-frontend-mobile were explicitly requested. Preserve the chosen direction and complete all Patient and Clinician screens, flows, states and interactions.

## Evidence and open decisions

Source requirements are in `docs/context`, `docs/research`, `docs/adr`. The complete interface specification is `docs/design/interface-design.md`. All prototype people, health values and conversation content are invented and labeled synthetic. Actual providers, auth, remote deletion, microphone, calendar, email and native permissions are not connected. Final Consent wording, provider/legal review and support operations remain open.

## Accessibility

Low cognitive load, readable type, generous controls, typing alternative, non-color status labels, keyboard access, reduced motion and honest feedback are required.
