// Gemini model names, defined once for the functions (and once in `core` for the phone).
// Every call to the text model sets `store: false`, so Gemini keeps no copy of the interaction.

/** The general-purpose text model for Intake highlights, Summaries and Digests. */
export const TEXT_MODEL = "gemini-4-hydrogen";

/** The Gemini Live model a Check-in talks to. Start Check-in locks every token to it. */
export const LIVE_MODEL = "gemini-3.8-live";

/** The music model behind the Companion's suggest_music tool. */
export const MUSIC_MODEL = "lyria-3.5";

/** The image model for a generated music clip's cover. */
export const ARTWORK_MODEL = "gemini-3.1-flash-lite-image";

/**
 * The Gemini Decisions API model Finish Check-in asks its three yes/no questions (#20). `v1beta`
 * only, called with `fetch` (src/decisionsApi.ts); the request shape is the #6 spike's.
 */
export const DECISION_MODEL = "gemini-decision-1";
