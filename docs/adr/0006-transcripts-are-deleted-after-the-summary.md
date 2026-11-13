# Transcripts are never stored outside the phone

The transcript of a Check-in is shown on screen while it happens. When the Check-in ends it passes through a Cloud Function in memory, which calls Gemini to produce the Summary, the ratings, the Outcome of the last Suggestion and the Attention flag judgment, and then drops it. The function neither stores nor logs it, and Gemini's own storage is switched off (`store=false`). The function is needed because the Gemini Decisions API takes a server-side key ([research](../research/gemini-api.md)).

The same rule covers everything else: raw sensor samples and audio never leave the phone, except the audio streamed to Gemini Live during a Check-in. Firestore holds daily aggregates, Summaries and flags only. We give up the ability to re-read or re-analyse past conversations in exchange for holding as little mental-health data as possible. When a Patient withdraws Consent for a Signal, the data already collected for it is deleted.

## Consequences

- Anything we want to keep from a Check-in must be extracted when it ends; a better Summary prompt later cannot be applied to old Check-ins.
- On-phone voice analysis (pitch, pauses) is a stretch goal. If it slips it is dropped, never replaced by sending recorded audio out.
- Google still holds prompts for up to 55 days for abuse monitoring on the paid tier.
