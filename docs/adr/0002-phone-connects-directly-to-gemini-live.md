# The phone connects directly to Gemini Live

During a Check-in the phone opens the Gemini Live WebSocket itself, using a short-lived token minted by a Cloud Function that locks the model, the Brief and the tools. We chose this over relaying audio through a server because Google recommends it and latency is lower ([research](../research/gemini-api.md)).

The client is a raw Ktor WebSocket in shared Kotlin. No Gemini SDK exists for Kotlin Multiplatform, and Firebase AI Logic would have to be integrated twice (Kotlin and Swift) and manages the audio itself. One shared client serves Android and iOS and gives us the audio frames. An hour-0 spike confirms it; if it fails, the fallback is the Firebase AI Logic SDK on each platform.

## Consequences

- The Gemini and Maps keys never reach the phone. Weather, places and route tool calls go through a Cloud Function; calendar and health tool calls run on the phone, where that data already is.
- A Check-in targets 3 minutes and is capped at about 8, because one Live connection lasts about 10. Longer Check-ins would need session resumption, which we do not build.
- The transcript exists only on the phone until the Check-in ends ([ADR 0006](0006-transcripts-are-deleted-after-the-summary.md)); a crash mid Check-in loses it.
