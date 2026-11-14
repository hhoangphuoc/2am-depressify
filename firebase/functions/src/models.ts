// Gemini model names, defined once for the functions (and once in `core` for the phone).
// Every call to the text model sets `store: false`, so Gemini keeps no copy of the interaction.

/** The general-purpose text model for Intake highlights, Summaries and Digests. */
export const TEXT_MODEL = "gemini-4-hydrogen";

/** The Live model for the spoken Check-in. The phone connects to it with a token from Start Check-in. */
export const LIVE_MODEL = "gemini-3.8-live";
