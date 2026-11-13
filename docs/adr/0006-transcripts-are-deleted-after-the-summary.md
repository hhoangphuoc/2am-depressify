# Transcripts are deleted after the Summary

The transcript of a Check-in is shown on screen while it happens, uploaded so the backend can produce the Summary, the Outcome of past Suggestions and the Attention flag, and then deleted from the backend. Gemini's own storage is switched off (`store=false`). We give up the ability to re-read or re-analyse past conversations in exchange for holding as little mental-health conversation data as possible. For the same reason, when a Patient withdraws Consent for a Signal, the data already collected for it is deleted.

## Consequences

- Anything we want to keep from a Check-in must be extracted at upload time; a better Summary prompt later cannot be applied to old Check-ins.
- Google still holds prompts for up to 55 days for abuse monitoring on the paid tier ([research](../research/gemini-api.md)).
