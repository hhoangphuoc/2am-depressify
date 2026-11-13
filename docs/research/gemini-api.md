# Gemini API and Gemini Live API

Researched 2026-11-13 against Google's own docs (index: [llms.txt](https://aistudio.google.com/llms.txt)), the Firebase AI Logic docs, the `googleapis/java-genai` source and the LiveKit docs. Every claim links to the page that owns it. Model names follow the repo skills `.agents/skills/gemini-api-dev` and `.agents/skills/gemini-live-api-dev`, checked against the live docs.

## Read this first

1. **The terms forbid clinical use.** "You may not use the Services in clinical practice, to provide medical advice, or in any manner that is overseen by or requires clearance or approval from a medical device regulatory agency." ([Gemini API Additional Terms, Use Restrictions](https://aistudio.google.com/docs/terms#use-restrictions)). A wellbeing companion with a clinician dashboard sits close to this line. Fine for a hackathon demo; a real product needs legal review or a different contract (see Open questions).
2. **In Finland/EU you must be on the paid tier.** "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." ([terms](https://aistudio.google.com/docs/terms#use-restrictions)). Paid tier also means prompts are not used for training ([terms, Paid Services](https://aistudio.google.com/docs/terms#data-use-paid)).
3. **Use `gemini-3.8-live` for the voice check-in**, connected from the phone with an ephemeral token minted by the backend. This is the architecture Google recommends ([Live overview](https://aistudio.google.com/docs/live-api#implementation-approach)).
4. **There is no official Kotlin Multiplatform SDK.** Options are raw WebSocket via Ktor (works on all KMP targets), the Google Gen AI Java SDK (JVM), or Firebase AI Logic (Android only, and it does not yet list `gemini-3.8-live`).
5. **"Affective dialog" is gone and "proactive audio" does not mean what the product idea means.** Details in section 1.

## Base URLs and auth at a glance

| Surface | Endpoint | Auth | Call from |
|---|---|---|---|
| Live session (API key) | `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=API_KEY` | API key | Backend only ([WebSocket guide](https://aistudio.google.com/docs/live-api/get-started-websocket)) |
| Live session (ephemeral token) | `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=TOKEN` | Ephemeral token (query param, or header `Authorization: Token <token>`) | Mobile/web client ([WebSocket guide](https://aistudio.google.com/docs/live-api/get-started-websocket), [Live reference](https://aistudio.google.com/api-reference/live#ephemeral-auth-tokens)) |
| Mint ephemeral token | `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens` | `x-goog-api-key` | Backend only ([ephemeral tokens](https://aistudio.google.com/docs/live-api/ephemeral-tokens)) |
| Interactions (text, PDF, structured output) | `POST https://generativelanguage.googleapis.com/v1beta/interactions` (stable `v1` also exists) | `x-goog-api-key` | Backend only ([create interaction](https://aistudio.google.com/api-reference/interactions-api/create-interaction)) |
| Decisions | `POST https://generativelanguage.googleapis.com/v1beta/decisions` | `x-goog-api-key` | Backend only ([Decisions API](https://aistudio.google.com/docs/decisions-api)) |
| Embeddings | `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent` (also `:batchEmbedContents`) | `x-goog-api-key` | Backend only ([embeddings](https://aistudio.google.com/docs/embeddings)) |
| Files upload | `POST https://generativelanguage.googleapis.com/upload/v1beta/files`, then `GET/DELETE /v1beta/files/{id}` | `x-goog-api-key` | Backend only ([Files API](https://aistudio.google.com/docs/files)) |

API version gotcha: SDKs released from November 2026 default to `v1`. Live API, ephemeral tokens and Decisions exist only on `v1beta`, so those calls fail until you set the version explicitly ([API versions](https://aistudio.google.com/api-reference/api-versions)). The docs' REST examples for Interactions also send the header `Api-Revision: 2026-05-20` ([document processing example](https://aistudio.google.com/docs/document-processing)).

## 1. Live API

### Model choice

| Model | Use when | Notes |
|---|---|---|
| `gemini-3.8-live` (stable, Sept 2026) | Default for the daily check-in. Lowest latency, built-in "interleaved reasoning". | Sync and async function calling. No `thinking_level`. ([model card](https://aistudio.google.com/docs/models/gemini-3.8-live)) |
| `gemini-3.8-live-extended-thinking` (stable) | Only if tool chains get long and you want spoken fillers ("checking that now...") while it reasons. | Async tools only. `turnComplete` no longer means idle; watch `interactionStatus` (`IN_PROGRESS`/`IDLE`). ([model card](https://aistudio.google.com/docs/models/gemini-3.8-live-extended-thinking)) |
| `gemini-3.5-transcribe-live` | Not needed. Live sessions already give transcripts. | ([live transcribe](https://aistudio.google.com/docs/live-api/live-transcribe)) |

Both Live models: input text, images, audio; output audio only; 131,072 input / 65,536 output tokens; no structured output, code execution, URL context, file search, Maps grounding, context caching or Batch ([model card](https://aistudio.google.com/docs/models/gemini-3.8-live)).

The model names are marked stable, but the Live API reference and the ephemeral token feature are both still labelled preview ([Live reference](https://aistudio.google.com/api-reference/live), [ephemeral tokens](https://aistudio.google.com/docs/live-api/ephemeral-tokens)).

### Protocol

Stateful WebSocket, JSON text frames. First client message must be `setup`; wait for `setupComplete` before sending anything else ([Live reference: BidiGenerateContentSetup](https://aistudio.google.com/api-reference/live#BidiGenerateContentSetup)).

| Direction | Message | Purpose |
|---|---|---|
| client → server | `setup` | `model` (`models/gemini-3.8-live`), `generationConfig` (`responseModalities: ["AUDIO"]`, `speechConfig`), `systemInstruction`, `tools`, `realtimeInputConfig`, `sessionResumption`, `contextWindowCompression`, `inputAudioTranscription`, `outputAudioTranscription`, `historyConfig` |
| client → server | `realtimeInput` | `audio`, `video`, `text`, `audioStreamEnd`, `activityStart`/`activityEnd`. Do not use the deprecated `mediaChunks`. |
| client → server | `clientContent` | `turns[]` with role `user`/`model`, `turnComplete`. Injects context at any point in a 3.8 session; `turnComplete: true` interrupts the model. |
| client → server | `toolResponse` | `functionResponses[]` matched to calls by `id` |
| server → client | `setupComplete` | Ready |
| server → client | `serverContent` | `modelTurn` (audio parts), `inputTranscription`, `outputTranscription`, `interrupted`, `generationComplete`, `turnComplete`, `interactionStatus`, `groundingMetadata` |
| server → client | `toolCall`, `toolCallCancellation` | Function calls to run, and calls cancelled by a barge-in |
| server → client | `goAway`, `sessionResumptionUpdate`, `usageMetadata` | Connection about to close; new resume handle; token counts |

Source for all rows: [Live WebSockets reference](https://aistudio.google.com/api-reference/live). One server event can carry several parts at once (audio plus transcript), so handle every part ([capabilities: model comparison](https://aistudio.google.com/docs/live-api/capabilities#model-comparison)).

### Audio and video

- Input audio: raw 16-bit PCM, little-endian, mono, 16 kHz, MIME `audio/pcm;rate=16000`, base64 in JSON. Other rates are resampled server-side, but Google says resample to 16 kHz on the client. Output: raw 16-bit PCM at 24 kHz ([audio formats](https://aistudio.google.com/docs/live-api/capabilities#audio-formats), [best practices](https://aistudio.google.com/docs/live-api/best-practices#resampling)).
- Send chunks of 20–40 ms; never buffer a second before sending ([best practices](https://aistudio.google.com/docs/live-api/best-practices#streaming-guidelines)).
- Video is single JPEG/PNG frames at max 1 frame per second through `realtimeInput.video` ([sending video](https://aistudio.google.com/docs/live-api/capabilities#send-video)). There is no dedicated emotion output. The model simply sees the frames; you would have to ask it (via a tool call or the post-session summary) what it observed.
- Video frames join every turn by default (`TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO`), so send frames sparingly ([model card, migration notes](https://aistudio.google.com/docs/models/gemini-3.8-live#migrating)). Audio+video sessions last 2 minutes without compression.
- Voices: any of the TTS prebuilt voices via `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`. Language cannot be set explicitly; the model follows the speaker, and you can restrict it in the system instruction. Finnish (`fi`) is on the supported list ([voice and language](https://aistudio.google.com/docs/live-api/capabilities#change-voice-and-language), [languages](https://aistudio.google.com/docs/live-api/capabilities#supported-languages)).

### VAD and interruptions

- Server VAD is on by default. Tunables under `realtimeInputConfig.automaticActivityDetection`: `startOfSpeechSensitivity`, `endOfSpeechSensitivity`, `prefixPaddingMs`, `silenceDurationMs` ([VAD config](https://aistudio.google.com/docs/live-api/capabilities#configure-automatic-vad)).
- Google recommends `silenceDurationMs` of 500–800 ms (server default about 800 ms). For a low-mood user who pauses a lot, stay at the high end or above; low values chop one utterance into fragments ([VAD quality](https://aistudio.google.com/docs/live-api/capabilities#vad-quality-best-practices)).
- Hybrid VAD: keep server VAD, send `audioStreamEnd: true` when the client detects end of speech or the mic is muted ([hybrid VAD](https://aistudio.google.com/docs/live-api/capabilities#hybrid-vad)).
- Manual mode (push-to-talk): set `disabled: true` and send `activityStart`/`activityEnd` ([disable VAD](https://aistudio.google.com/docs/live-api/capabilities#disable-automatic-vad)).
- On barge-in the server sends `interrupted: true`; clear the playback queue immediately. Pending function calls are cancelled ([VAD](https://aistudio.google.com/docs/live-api/capabilities#interruptions)).

### Session limits, resumption, compression

| Limit | Value | Source |
|---|---|---|
| Audio-only session | 15 min without compression | [session management](https://aistudio.google.com/docs/live-api/session-management#maximum-session-duration) |
| Audio + video session | 2 min without compression | same |
| One WebSocket connection | about 10 min, then `goAway` with `timeLeft` | same |
| Resume handle validity | 2 hours after the session ends | [session resumption](https://aistudio.google.com/docs/live-api/session-management#session-resumption) |
| Context window | 128k tokens; audio is about 25 tokens/second | [limitations](https://aistudio.google.com/docs/live-api/capabilities#context-window), [best practices](https://aistudio.google.com/docs/live-api/best-practices#context-management) |

- Compression: `contextWindowCompression: { slidingWindow: {} }`, optional `triggerTokens` (default 80% of the window) and `slidingWindow.targetTokens`. It drops the oldest turns; the system instruction stays. With it, sessions are unlimited ([reference](https://aistudio.google.com/api-reference/live#ContextWindowCompressionConfig)).
- Resumption: send `sessionResumption: {}` in setup, store the latest `sessionResumptionUpdate.newHandle` when `resumable` is true, reconnect with `sessionResumption: { handle }`. Not resumable mid-generation or mid-tool-call ([reference](https://aistudio.google.com/api-reference/live#SessionResumptionUpdate)).
- A daily check-in of 5–15 minutes therefore needs resumption (to survive the 10-minute reconnect) and, if it may exceed 15 minutes, compression.
- Cross-day memory is your job. Seed each new session with a short summary through `clientContent` and `historyConfig.initialHistoryInClientContent: true`; Google recommends one summary message over replaying long history ([incremental updates](https://aistudio.google.com/docs/live-api/capabilities#incremental-updates)).

### Transcription (for clinician summaries)

Set `inputAudioTranscription: {}` and `outputAudioTranscription: {}` in setup. Transcripts arrive in `serverContent.inputTranscription` / `outputTranscription` (`text`, `languageCode`, offsets), with no ordering guarantee relative to audio ([audio transcriptions](https://aistudio.google.com/docs/live-api/capabilities#audio-transcription), [reference](https://aistudio.google.com/api-reference/live#BidiGenerateContentTranscription)). Config options include `languageCodes`, `customVocabulary`, `wordTimestamp`, `diarization` and `mode` (`VERBATIM` default, or `SMART`) ([AudioTranscriptionConfig](https://aistudio.google.com/api-reference/live#AudioTranscriptionConfig)). Transcription text is billed extra at the text output rate ([billing notes](https://aistudio.google.com/docs/live-api/best-practices#audio-tokens-and-transcriptions)).

Consequence for architecture: with a direct client connection the transcript lands on the phone, so the app must upload it to the backend when the session ends.

### Affective dialog and proactive audio

- **Affective dialog** (`enable_affective_dialog`): removed in both 3.8 Live models; it only exists on the legacy Gemini 2.5 Flash Live preview ([capabilities](https://aistudio.google.com/docs/live-api/capabilities#affective-dialog)). The overview page still advertises it; the model card and capabilities page are the accurate ones. The pricing page does describe the 3.8 Live models as having "acoustic nuance detection" ([pricing](https://aistudio.google.com/docs/pricing#gemini-3.8-live)), so tone awareness is native, with no switch to set. Empathy is driven by the system instruction.
- **Proactive audio**: this means the model may decide *not* to answer irrelevant input. It is permanently on for 3.8 Live; setting it to false errors ([capabilities](https://aistudio.google.com/docs/live-api/capabilities#proactive-audio), [ProactivityConfig](https://aistudio.google.com/api-reference/live#ProactivityConfig)). It does not make the agent start conversations. Input tokens are billed the whole time the session listens ([billing notes](https://aistudio.google.com/docs/live-api/best-practices#proactive-audio-mode)).
- For the product's "proactive suggestions": the backend decides when to nudge, sends a push notification, and when the user opens the app the client starts a session and sends `realtimeInput.text` (or a `clientContent` turn) so the agent speaks first.

## 2. Function calling and tools in Live

### What is supported

| Tool | `gemini-3.8-live` | Extended thinking |
|---|---|---|
| Function calling | Sync and async | Async only |
| Google Search grounding | Yes | Yes |
| Google Maps grounding | **No** | **No** |
| Code execution, URL context | No | No |

Source: [Live tool use](https://aistudio.google.com/docs/live-api/tools#tools-overview). Places, weather, calendar and health data must therefore be your own functions.

### Sync vs NON_BLOCKING

- `behavior: "NON_BLOCKING"` lets the conversation continue while the function runs. `BLOCKING` pauses the model until the response arrives ([async function calling](https://aistudio.google.com/docs/live-api/tools#async-function-calling)).
- The model card says NON_BLOCKING is the default on `gemini-3.8-live` ([model card](https://aistudio.google.com/docs/models/gemini-3.8-live#migrating)), while the tools guide still says calls are sequential by default. Set `behavior` explicitly on every declaration to avoid depending on either reading.
- With non-blocking calls, put `scheduling` in the function response: `INTERRUPT` (speak now), `WHEN_IDLE` (after the current sentence), `SILENT` (just remember it) ([same page](https://aistudio.google.com/docs/live-api/tools#async-function-calling)). `SILENT` fits background context such as weather or sleep score; `WHEN_IDLE` fits "I found a yoga class nearby".
- The Live API never runs functions for you. The client receives `toolCall` and must reply with `toolResponse` ([function calling](https://aistudio.google.com/docs/live-api/tools#function-calling)).

### Declaring the context tools

Declarations go in `setup.tools` (they cannot change mid-session). Shape, following the documented examples:

```json
{
  "setup": {
    "model": "models/gemini-3.8-live",
    "generationConfig": { "responseModalities": ["AUDIO"] },
    "tools": [
      { "googleSearch": {} },
      { "functionDeclarations": [
        { "name": "get_weather", "behavior": "NON_BLOCKING",
          "description": "Current weather and today's forecast at the user's location.",
          "parameters": { "type": "OBJECT", "properties": {} } },
        { "name": "find_places", "behavior": "NON_BLOCKING",
          "description": "Find nearby parks, yoga or meditation classes.",
          "parameters": { "type": "OBJECT",
            "properties": { "category": { "type": "STRING" }, "radius_m": { "type": "INTEGER" } },
            "required": ["category"] } },
        { "name": "get_calendar_today", "behavior": "NON_BLOCKING", "description": "Today's calendar events." },
        { "name": "get_health_snapshot", "behavior": "NON_BLOCKING", "description": "Last night's sleep, resting HR, HRV, steps." },
        { "name": "log_mood", "behavior": "NON_BLOCKING",
          "description": "Record the user's self-reported mood (1-10) and a short note.",
          "parameters": { "type": "OBJECT",
            "properties": { "score": { "type": "INTEGER" }, "note": { "type": "STRING" } },
            "required": ["score"] } }
      ] }
    ]
  }
}
```

Function names here are our own design, not Google's. With a direct client connection the tool call arrives on the phone. The phone answers on-device tools itself (health data, location) and calls our backend for tools that need server keys (weather, places, calendar), then sends `toolResponse`.

Google's tool guidance for Live: precise names and descriptions, and say in the system instruction when each tool should be used ([best practices](https://aistudio.google.com/docs/live-api/best-practices#tool-definitions)).

## 3. Ephemeral tokens

| Item | Value |
|---|---|
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens` with `x-goog-api-key` |
| `uses` | Default 1. 0 means unlimited. Resuming a session does not count as a use. |
| `newSessionExpireTime` | Window to *start* a session. Default 60 seconds. |
| `expireTime` | Window to keep *sending* on that session. Default 30 minutes. Both must be under 20 hours. |
| Constraints | Lock model and config server-side. Guide's REST body uses `liveConnectConstraints: { model, config }`; the reference names the field `bidiGenerateContentSetup` plus `fieldMask`. |
| Scope | Live API only, `v1beta` only, preview feature |

Sources: [ephemeral tokens guide](https://aistudio.google.com/docs/live-api/ephemeral-tokens), [AuthToken reference](https://aistudio.google.com/api-reference/live#AuthToken).

Notes:

- The token is returned in the `name` field and is used "as if it were an API key" ([guide](https://aistudio.google.com/docs/live-api/ephemeral-tokens#connect-live-api)).
- Locking the config keeps the system instruction and tool list on the server, so a tampered client cannot change the agent's behaviour ([guide](https://aistudio.google.com/docs/live-api/ephemeral-tokens)).
- Google's own caveat: a token is only as secure as your backend's authentication of the user ([best practices](https://aistudio.google.com/docs/live-api/ephemeral-tokens#best-practices)).

### Recommended architecture

Google states client-to-server gives better streaming performance and is simpler, and that production apps doing this should use ephemeral tokens ([Live overview](https://aistudio.google.com/docs/live-api#implementation-approach)).

1. App authenticates the patient with our backend.
2. Backend mints a single-use token locked to `gemini-3.8-live`, the system instruction (including today's context summary), tool declarations, transcription, resumption and compression.
3. App opens the `BidiGenerateContentConstrained` WebSocket with `access_token`.
4. App streams mic audio, plays 24 kHz output, executes tool calls (calling the backend where needed), collects transcripts.
5. On session end the app posts the transcript and tool log to the backend, which runs summarisation and risk flags.

Backend proxying (phone → backend → Gemini) is the alternative. It keeps transcripts and tool execution on the server and never exposes a token, at the cost of latency and having to build an audio relay. For a hackathon the direct path is less work. The trade-off is that the clinical record depends on the client uploading it.

## 4. Non-realtime work (Interactions API and friends)

All of this runs on the backend with the API key.

### Text model

`gemini-4-hydrogen` is the documented default general-purpose model: stable, 1M-token context, inputs text/image/video/audio/PDF, supports function calling, structured output, Search and Maps grounding ([model card](https://aistudio.google.com/docs/models/gemini-4-hydrogen), [latest models](https://aistudio.google.com/docs/latest-model)). `gemini-3.5-flash-lite` is the cheap option ([pricing](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite)).

### Post-session summary and clinician report

- `POST /v1beta/interactions` with `model`, `input`, optional `system_instruction`, `tools`, `response_format`, `safety_settings`, `store`, `previous_interaction_id` ([Interactions overview](https://aistudio.google.com/docs/interactions-overview)).
- Structured output: `"response_format": { "type": "text", "mime_type": "application/json", "schema": { ...JSON Schema... } }` ([structured outputs](https://aistudio.google.com/docs/structured-output)). Use this for the progress report (mood trend, sleep, adherence, notable quotes, suggested follow-up).
- Function tools in Interactions are declared as `{ "type": "function", "name", "description", "parameters" }`, a different shape from Live's `functionDeclarations` ([function calling](https://aistudio.google.com/docs/function-calling)).
- Maps grounding works here (not in Live), on `gemini-4-hydrogen` among others. Limits: English prompts and responses only, and Maps sources must be shown with attribution ([Maps grounding](https://aistudio.google.com/docs/maps-grounding#limitations)). A text-side "context agent" could use it to pre-compute place suggestions.
- `tools`, `system_instruction` and generation config are per-interaction and must be re-sent each turn (repo skill `gemini-api-dev`).

### Decisions API for risk flags

- `POST /v1beta/decisions`, model `gemini-decision-1`. Body: `model`, `input`, `questions` (1–1,000, map of key → `{ type, instructions, criteria }`) ([Decisions API](https://aistudio.google.com/docs/decisions-api#request)).
- Types: `noul` (yes probability 0.01–0.99), `choice` (2–255 options), `score` (ordered rubric levels, returns probability-weighted score). Every answer carries `confidence` ([question types](https://aistudio.google.com/docs/decisions-api#question-types)).
- Input can be text, PDF, audio, image or video; 262,144-token context; zero output tokens ([model page](https://aistudio.google.com/docs/models/gemini-decision-1)).
- Fit: after each session, ask narrow questions over the transcript ("Does the user express hopelessness?", "Did the user mention skipping medication?", rubric "engagement level 0–4") and threshold in code. Google's own advice: set thresholds from labelled examples, treat input as untrusted, and "keep a human or a second check on high-stakes actions" ([best practices](https://aistudio.google.com/docs/decisions-api#best-practices)).
- Gotchas: no conversation-history blocks (serialise the transcript as text); no Batch, caching, Flex or Priority; safety filters can reject the request with HTTP 400 `safety` instead of answers ([limitations](https://aistudio.google.com/docs/decisions-api#limitations), [reference](https://aistudio.google.com/docs/decisions-api#request)). That last one matters for transcripts that mention self-harm, and needs a fallback path.
- It gives probabilities with no explanation. Pair it with a generated summary for the clinician.

### Embeddings for memory

- `gemini-embedding-2`: multimodal, default 3072 dimensions, reducible with `output_dimensionality` (for example 768); max 8,192 input tokens ([embeddings](https://aistudio.google.com/docs/embeddings#control-embedding-size), [limits](https://aistudio.google.com/docs/embeddings#supported-modalities)).
- No `task_type` on this model; put the task instruction in the text instead ([task types](https://aistudio.google.com/docs/embeddings#task-types-embeddings-2)).
- PDFs are capped at 6 pages per request, so do not embed the intake report directly; embed text chunks of its extracted summary ([PDF limits](https://aistudio.google.com/docs/embeddings#pdf-limits)).
- For a hackathon, a rolling text summary per patient is likely enough and embeddings can wait.

### Clinical intake PDF

- Pass inline as an input block `{ "type": "document", "data": "<base64>", "mime_type": "application/pdf" }`, or upload through the Files API and reference the URI ([document understanding](https://aistudio.google.com/docs/document-processing)).
- Limits: 50 MB or 1,000 pages per PDF; each page costs 258 tokens ([technical details](https://aistudio.google.com/docs/document-processing#technical-details)). Document tokens bill at the image rate ([pricing notes](https://aistudio.google.com/docs/pricing#notes)).
- Files API uploads are deleted automatically after 48 hours and can be deleted earlier ([Files API](https://aistudio.google.com/docs/files)).
- Suggested flow: one Interactions call with structured output extracts diagnosis, treatment history, medication and risk notes to JSON; store that in our database; inject a short version into each Live session's system instruction.

## 5. Kotlin client options

| Option | Platforms | Live support | Auth model | Verdict |
|---|---|---|---|---|
| Raw WebSocket with Ktor | All KMP targets (Android, iOS, JVM, JS/Wasm) | Full protocol, including `gemini-3.8-live` and ephemeral tokens | Ephemeral token from our backend | Best fit for KMP. Protocol is plain JSON over WSS ([WebSocket guide](https://aistudio.google.com/docs/live-api/get-started-websocket)). We write the audio capture/playback per platform. |
| Google Gen AI Java SDK `com.google.genai:google-genai` | JVM | `client.async.live` (class `AsyncLive`, marked experimental), plus `interactions`, `decisions`, `authTokens` | API key or Agent Platform credentials | Good for the backend (Ktor/Spring). Official and GA per [libraries page](https://aistudio.google.com/docs/libraries). README on `main` shows version 2.3.0 and says Java 17+ from 2.0.0 ([README](https://github.com/googleapis/java-genai/blob/main/README.md), [Client.java](https://github.com/googleapis/java-genai/blob/main/src/main/java/com/google/genai/Client.java), [AsyncLive.java](https://github.com/googleapis/java-genai/blob/main/src/main/java/com/google/genai/AsyncLive.java)). Android use is not documented. |
| Firebase AI Logic `com.google.firebase:firebase-ai` (BoM 35.2.0) | Android (Kotlin/Java), Swift, Web, Flutter, Unity. No KMP artifact documented. | `liveModel().connect()`, `startAudioConversation()`; Live support is Preview | Firebase project; App Check enforcement required since 2 Nov 2026; no API key in the app | Fastest Android-only path, but its docs list only `gemini-3.1-flash-live-preview` and 2.5 models for Live, not `gemini-3.8-live`; no `UsageMetadata`; tool docs for Live "coming soon" ([Firebase Live API](https://firebase.google.com/docs/ai-logic/live-api?api=dev), [get started](https://firebase.google.com/docs/ai-logic/get-started?api=dev)). |
| LiveKit Agents (Google plugin) | Agent runs server-side in Python or Node; clients join over WebRTC | Yes, including `google/gemini-3.8-live` | LiveKit credentials or our Gemini key on the agent server | Gives WebRTC transport and echo handling, but adds a third party in the audio path and a non-Kotlin agent process ([LiveKit Gemini plugin](https://docs.livekit.io/agents/models/realtime/plugins/gemini/)). |

There was never a Google-provided Kotlin SDK for the Developer API beyond the old Android library, which is deprecated in favour of Firebase AI Logic ([libraries, legacy table](https://aistudio.google.com/docs/libraries#previous-sdks)).

Recommendation: Ktor WebSocket client in shared KMP code for Live, with platform audio behind `expect/actual`; Java SDK or plain HTTP on the backend for tokens, Interactions, Decisions and embeddings.

## 6. Data handling

| Topic | Finding | Source |
|---|---|---|
| Availability | Finland and all EU states are on the Developer API region list | [available regions](https://aistudio.google.com/docs/available-regions) |
| EEA rule | Only Paid Services may be offered to EEA/Swiss/UK users. In the EEA, paid-tier data terms apply even to free quota. | [terms](https://aistudio.google.com/docs/terms#use-restrictions) |
| Training use | Free tier: content is used to improve products and may be read by human reviewers; "Do not submit sensitive, confidential, or personal information". Paid tier: not used; processed under Google's Data Processing Addendum. | [terms: unpaid](https://aistudio.google.com/docs/terms#data-use-unpaid), [paid](https://aistudio.google.com/docs/terms#data-use-paid) |
| Abuse logs | Prompts, context and outputs retained 55 days for abuse monitoring; flagged content may be reviewed by authorised Google staff. | [abuse monitoring](https://aistudio.google.com/docs/usage-policies#how-we-handle-data) |
| Data location | Paid-tier data "may be stored transiently or cached in any country in which Google or its agents maintain facilities". No EU residency on the Developer API. | [terms](https://aistudio.google.com/docs/terms#data-use-paid) |
| Interactions storage | `store=true` by default. Paid tier keeps 55 days (configurable to 7/14/28/55), free tier 1 day. `store=false` disables `previous_interaction_id` and background runs. Stored interactions can be deleted by ID. | [data storage and retention](https://aistudio.google.com/docs/interactions-overview#data-storage-retention) |
| Developer logs | Logging in AI Studio is on by default for Interactions calls; owner can turn it off. Never share datasets from EEA users with Google. | [data logging](https://aistudio.google.com/docs/logs-policy) |
| Files | Deleted after 48 hours | [Files API](https://aistudio.google.com/docs/files) |
| Age | Apps must not be directed at under-18s | [terms](https://aistudio.google.com/docs/terms#age-requirements) |
| Medical restriction | No use "in clinical practice, to provide medical advice", or under medical-device regulation | [terms](https://aistudio.google.com/docs/terms#use-restrictions) |
| Prohibited use | No content that "facilitates self-harm"; no tracking or monitoring people without consent; no automated decisions with material detrimental impact in healthcare without human supervision; no biometrics use without legally required consent | [Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy) |
| Safety settings | Interactions accepts `safety_settings` (`type` + `threshold`); adjustable filters are off by default on current models. Loosened settings may trigger Google review. | [safety settings](https://aistudio.google.com/docs/safety-settings) |

What this means for the build:

- Set `store=false` on every Interactions call that carries patient data, and keep history in our own database. Turn off AI Studio logging for the project.
- Send Gemini a pseudonymous patient ID, never name or national ID.
- Camera capture and clinician monitoring both need explicit consent screens (prohibited-use policy items on biometrics and monitoring).
- Risk flags must go to a human clinician; the app must not act on them alone.
- Whether Live session audio is stored beyond the 55-day abuse log is not stated on the pages read.

## 7. Pricing and rate limits

Paid tier, USD per 1M tokens ([pricing](https://aistudio.google.com/docs/pricing)):

| Model | Input | Output | Notes |
|---|---|---|---|
| `gemini-3.8-live` / `-extended-thinking` | $0.75 text; $3.00 audio (about $0.005/min); $1.00 image/video (about $0.002/min) | $4.50 text; $12.00 audio (about $0.018/min) | Free tier exists. Search grounding: 5,000 free requests/month then $14 per 1,000. |
| `gemini-4-hydrogen` | $1.50 | $7.50 (incl. thinking) | Batch/Flex half price. Search and Maps grounding as above. |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | |
| `gemini-decision-1` | $0.10 | none (0 output tokens) | Shared input billed once per request |
| `gemini-embedding-2` | $0.20 text; $0.45 image; $6.50 audio; $12.00 video | n/a | Batch half price |

Live billing detail: each turn re-bills the whole accumulated context, so cost per turn grows through the session; compression with a low trigger (Google's example: trigger 25,000, window 8,000) caps it. Transcription adds text-output charges ([Live pricing and billing](https://aistudio.google.com/docs/live-api/best-practices#pricing-billing)). A rough floor for a 10-minute check-in split evenly is 5 × $0.005 + 5 × $0.018 ≈ $0.12, before context re-billing and transcription. This is my arithmetic from the per-minute prices, not a Google figure.

Rate limits ([rate limits](https://aistudio.google.com/docs/rate-limits)):

- Limits are per project (RPM, TPM, RPD) and depend on usage tier. Tier 1 needs a linked billing account (billing tier cap $250); Tier 2 needs $100 paid plus 3 days.
- Per-model numbers for the Live and text models are not published on the docs page; they are shown per project in [AI Studio](https://aistudio.google.com/rate-limit). Concurrent Live session limits were not found.
- Spend-based limit on Tier 1: $10 per rolling 10 minutes.
- `gemini-decision-1`: Free 200 RPM / 50k TPM / 10k RPD; Tier 1 1,500 RPM / 1M TPM / 50k RPD.
- Search grounding: 1,500 requests/day per project.

## Open questions

1. Is the Gemini Developer API acceptable given the "no clinical practice / medical advice" clause, or should the pitch frame the product as wellbeing support with clinicians viewing patient-shared data? For anything beyond the demo, do we move to Gemini Enterprise Agent Platform (Vertex) terms?
2. Paid tier from day one? Required for EU users and for keeping data out of training. Who owns the billing account?
3. Direct client connection with ephemeral tokens (recommended, faster to build) or backend audio proxy (transcripts never depend on the client)?
4. KMP client via raw Ktor WebSocket, or Android-only via Firebase AI Logic and accept an older Live model?
5. Is camera/facial capture in scope? It shortens sessions to 2 minutes without compression, raises cost and needs biometric consent.
6. Session language: Finnish, English, or follow the user?
7. What happens when the agent or a Decisions flag indicates acute risk: crisis line prompt in-app, clinician alert, both? Who is the human in the loop?
8. Do we keep raw transcripts for clinicians or only summaries? Retention period on our side?
9. Google Search grounding in Live: on (fresh local info) or off (tighter control over what a vulnerable user hears)?

## Not verified

- Per-model RPM/TPM and concurrent-session limits for `gemini-3.8-live` and `gemini-4-hydrogen` (only visible in AI Studio for a real project).
- Whether `gemini-3.8-live` works through Firebase AI Logic despite not being listed there.
- Whether the Java SDK runs on Android, and its latest released version on Maven Central (README on `main` says 2.3.0; the Google libraries page still shows 1.0.0).
- Which field name the token endpoint actually accepts for constraints (`liveConnectConstraints` in the guide vs `bidiGenerateContentSetup` in the reference). Test before relying on locked configs.
- The default function-calling behaviour on `gemini-3.8-live` (docs disagree). Not tested.
- How well the Live model handles Finnish speech and whether transcripts are accurate in Finnish.
- How safety filtering behaves in Live sessions and in Decisions when a user talks about self-harm. No Live-specific safety documentation was found.
- Retention of Live session audio and transcripts on Google's side beyond the general 55-day abuse log.
- The Data Processing Addendum's handling of special-category (health) data under GDPR; the addendum itself was not read.
- Gemini Enterprise Agent Platform availability of `gemini-3.8-live` in EU regions and its medical-use terms.
- LiveKit's Kotlin/Android client details (only the agent-side page was read).
- Context7 was not used; every finding comes from the first-party pages linked above.
- No API calls were made. Nothing here was exercised against a live endpoint.

