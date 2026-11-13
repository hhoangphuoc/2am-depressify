# Wellbeing companion, not clinical treatment

The challenge brief asks for "maintenance treatment", but the Gemini API terms forbid use "in clinical practice" or "to provide medical advice" ([research](../research/gemini-api.md)). The product is therefore a wellbeing companion: the Companion supports the Patient and makes Suggestions, never diagnoses or advises on treatment, and every clinical judgment stays with the Clinician. When a Check-in shows signs of self-harm risk, the app shows a Crisis notice and raises the Attention flag; the Companion stays supportive and does not counsel.

## Consequences

- Copy, prompts and the pitch say "suggestion" and "support", never "treatment" or "therapy".
- The only self-report is a 1 to 5 Mood rating. Clinical questionnaires such as PHQ-9 are left out on purpose.
- The Clinician has no way to steer the Companion (for example "encourage morning walks"), because that would make the Companion a channel for clinical advice.
- The Companion says it is an AI and not a clinician at a Patient's first Check-in.
- A real product beyond the demo needs a model provider whose terms allow clinical use, or a legal review.
