# The phone connects directly to Gemini Live

During a Check-in the phone opens the Gemini Live WebSocket itself, using a short-lived token minted by our backend that locks the model, system instruction and tools. The phone forwards each tool call to the backend and uploads the transcript when the Check-in ends. We chose this over relaying audio through the backend because Google recommends it, latency is lower, and the backend stays a plain request/response service ([research](../research/gemini-api.md)).

## Consequences

- No Gemini SDK exists for Kotlin Multiplatform, so the Live protocol is a raw Ktor WebSocket in shared code (OkHttp engine on Android, Darwin on iOS).
- The backend only learns what was said if the phone uploads it; a crash mid Check-in loses that transcript.
- API keys for Gemini, Maps and Calendar never reach the phone.
- A Check-in is capped at about 8 minutes because one Live connection lasts about 10. Longer Check-ins would need session resumption, which we do not build.
