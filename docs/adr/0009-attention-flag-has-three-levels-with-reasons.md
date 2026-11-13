# The Attention flag has three levels, with reasons and no number

The Attention flag is green, amber or red. Amber means drift worth a look; red means a sharp break or a crisis and also sends the Clinician an email. Every level carries written reasons, only the Clinician clears it, and no score is ever shown. This replaces the on/off flag of [ADR 0007](0007-attention-flag-is-on-or-off-with-reasons.md): the levels give the Clinician an order to work through and decide when to interrupt them, while still avoiding a number that would read as a clinical risk assessment ([ADR 0001](0001-wellbeing-companion-not-clinical-treatment.md)).

The level comes from two places: the Gemini Decisions API, which answers fixed yes/no questions about each Check-in, and simple rules on Signals. If Gemini's safety filter refuses to judge a Check-in, the level is amber with the reason "could not be assessed automatically".

Questionnaire scores are separate: the Clinician records them at a Visit and they never feed the flag.
