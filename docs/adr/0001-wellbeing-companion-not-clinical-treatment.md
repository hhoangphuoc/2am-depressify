# Wellbeing companion, not clinical treatment

The challenge brief asks for "maintenance treatment", but the Gemini API terms forbid use "in clinical practice" or "to provide medical advice" ([research](../research/gemini-api.md)). The product is therefore a wellbeing companion: the Companion supports the Patient and makes Suggestions, never diagnoses or advises on treatment, and every clinical judgment stays with the Clinician. When a Check-in shows signs of self-harm risk, the app shows a Crisis notice and raises the Attention flag to red; the Companion stays supportive and does not counsel.

## Consequences

- Copy, prompts and the pitch say "suggestion" and "support", never "treatment" or "therapy". Voice cues are described as observations, never as a diagnosis.
- The Patient's only self-reports are three 1 to 5 ratings: mood, energy and sleep quality.
- The Companion never administers a clinical questionnaire. PHQ-2 and PHQ-9 are Questionnaire scores the Clinician records at a Visit.
- The Clinician has no way to steer the Companion (for example "encourage morning walks"), because that would make the Companion a channel for clinical advice.
- The Companion says it is an AI and not a clinician at a Patient's first Check-in.
- The app never places a call. The Crisis notice opens the dialler and the Patient places the call.
- A real product beyond the demo needs a model provider whose terms allow clinical use, or a legal review.
