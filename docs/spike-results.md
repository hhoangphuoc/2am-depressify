# Hour-0 spike results (issue #6)

Run on 14 November 2026 against the real project `junction26hel-7400` from a Mac. Terms follow [GLOSSARY.md](../GLOSSARY.md).

- **Scope.** This repository builds the backend only, so this run covers the backend half of #6: the Gemini calls, the Maps calls and the Firestore region. The phone and hardware spikes are listed under [Needs a person](#needs-a-person).
- **Data.** Every call used fictional content: a made-up Check-in between "Alex" and the Companion, a made-up crisis transcript for "Sam", synthetic speech from macOS `say`, and public Helsinki landmarks.
- **Keys.** The Gemini and Maps keys were read from Secret Manager at run time and never written anywhere. Every fixture has keys, tokens and resumption handles replaced with `REDACTED`.
- **Harness.** The spike code is on the throwaway branch `spike/6-throwaway`, under `spike/6/`.
- **Fixtures.** The raw requests and responses are in [`fixtures/spike/`](../fixtures/spike/), ready to use as test fixtures for #14, #18 and #20.

## Summary

| Spike | Result | Fixtures |
|---|---|---|
| 1. Ephemeral token for Live, locked to model, system instruction, tools and transcription | **Pass.** The body shape that works is `bidiGenerateContentSetup` plus `fieldMask`. `liveConnectConstraints` is rejected. | `live/token-*.json`, `live/constrained-endpoint-probes.json` |
| 2. Live conversation over a raw Ktor WebSocket from Kotlin Multiplatform common code (JVM on the Mac) | **Pass.** Covered setup, a text turn, a spoken 16 kHz PCM turn, a tool round trip and a spoken interruption. `gemini-3.8-live` answered. Tested with the OkHttp engine (the one Android uses) and with CIO. | `live/session-ktor-okhttp.json`, `live/messages/*.json` |
| 2b. The same on the S24+ with the real microphone, and on an iPhone | **Needs a person** | none |
| 3. Text model with structured output (Finish Check-in, #14) | **Pass.** `response_format` with a JSON Schema works on `v1` and `v1beta`. | `interactions/*.json` |
| 4. Decisions API with three yes/no questions (#20) | **Pass.** The fictional crisis transcript was answered, not refused. The refusal shape is taken from the docs. | `decisions/*.json` |
| 5a. Maps agent tools (`mapstools.googleapis.com`): weather, text search, routes | **Pass**, after the service was enabled (re-run on 14 November, [below](#maps-agent-tools-after-enabling)). At the time of the spike: HTTP 403 `PERMISSION_DENIED`. | `maps/mapstools-*.json` |
| 5b. Direct Places API (New) text search and Weather API | **Pass** | `maps/places-searchText.json`, `maps/weather-*.json` |
| 5c. Direct Routes API | **Blocked.** HTTP 403, because `routes.googleapis.com` is not enabled. | `maps/routes-computeRoutes.json` |
| 6. Calendar | **Needs a person** (OAuth consent on a phone). The steps are [below](#calendar-steps-for-a-person). | none |
| Health Connect and HRV, usage statistics, iOS | **Needs a person** | none |
| Firestore region | **Decided:** `europe-north1` (Finland). The database already exists there. | none |

## 1. Ephemeral token for Gemini Live

### The request that works

The token is minted with `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens`, with the key in the `x-goog-api-key` header.

```json
{
  "uses": 1,
  "expireTime": "<now + 30 min, RFC 3339>",
  "newSessionExpireTime": "<now + 60 s, RFC 3339>",
  "bidiGenerateContentSetup": {
    "model": "models/gemini-3.8-live",
    "generationConfig": { "responseModalities": ["AUDIO"] },
    "systemInstruction": { "parts": [{ "text": "<the Brief>" }] },
    "tools": [{ "functionDeclarations": [
      { "name": "get_time", "description": "...", "behavior": "BLOCKING",
        "parameters": { "type": "OBJECT", "properties": {} } } ] }],
    "inputAudioTranscription": {},
    "outputAudioTranscription": {}
  },
  "fieldMask": "model,generationConfig,systemInstruction,tools,inputAudioTranscription,outputAudioTranscription"
}
```

The response is HTTP 200 with only `{ "name": "auth_tokens/<token>" }`, and it takes 0.3 to 0.5 s. The whole `name` value, prefix included, is the token. The response contains no lifetime fields; the lifetime is whatever the request asked for.

### What we found

| Question | Finding |
|---|---|
| `liveConnectConstraints` vs `bidiGenerateContentSetup` | The REST endpoint rejects `liveConnectConstraints` (HTTP 400, `Unknown name "liveConnectConstraints" at 'auth_token'`). The guide's shape only works through the SDK. `@google/genai` 3.3.0 `ai.authTokens.create({ config: { liveConnectConstraints, lockAdditionalFields } })` turns it into `bidiGenerateContentSetup` plus `fieldMask` on the wire, and that call works on `v1beta` and `v1alpha` (`live/token-sdk-genai-3.3.0.json`). |
| What goes in `fieldMask` | Every field set in `bidiGenerateContentSetup` must be in the mask, **including `model`**. Without `model` in the mask the call fails with HTTP 400, "BidiGenerateContentSetup contains fields that are not specified in field_mask". The mask accepts camelCase or snake_case paths, and whole objects (`generationConfig`) or leaf paths (`generationConfig.responseModalities`). |
| Is the config really locked? | Yes. A client `setup` that sent its own system instruction ("you are a pirate…") got `setupComplete`, and the model answered with the locked instruction. The override is ignored without an error. A client `setup` naming another model was also accepted. |
| What the client sends as `setup` | `{"setup":{"model":"models/gemini-3.8-live"}}` works, and so does `{"setup":{}}`. Everything else comes from the token. |
| `uses: 1` | A second connection with the same token is closed straight after the WebSocket upgrade with close code **1011**, "Token has been used too many times". |
| `newSessionExpireTime` | A connection after the window is closed with code **1011**, "new_session_expire_time deadline exceeded". |
| `expireTime` limit | Over 20 hours returns HTTP 400, "expire_time is too far in the future. Maximum lifetime is 20h". Both times are optional (a mint without them works). Per the guide the defaults are 30 minutes and 60 seconds. |
| Token errors | They come as a WebSocket close (1011 plus a reason) after the upgrade, never as an HTTP error. The client must show the close reason. |

## 2. Gemini Live protocol (captured from Kotlin)

### Harness

The harness is a Kotlin Multiplatform project with a `jvm()` target. All the Live code is in `commonMain`, using only `ktor-client-core`, `ktor-client-websockets`, kotlinx.serialization and coroutines (Ktor 3.6.1, Kotlin 2.4.21). The engine and file I/O are in `jvmMain`. The pure parts (client message builders and `parseServerMessage(JsonObject): List<LiveEvent>`) are a working prototype of the `core` Live protocol parsing in the spec.

The Gemini key never reached the Kotlin process. A Node script minted the token, and the token was passed to Kotlin as an environment variable in the same shell command. This is the same split as the phone and the Start Check-in function.

| Run | Engine | Token placement | Result |
|---|---|---|---|
| A (saved as the fixture) | OkHttp (the Android engine) | `?access_token=<token>` query parameter | Pass, 558 frames |
| B | CIO | `Authorization: Token <token>` header | Pass, 538 frames |

The endpoint is `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained`.

Each run went through these turns, about 33 s in total:
1. Setup.
2. A text turn.
3. A spoken turn: 5.4 s of synthetic speech as 16 kHz mono PCM16 in 40 ms chunks (1,280 bytes), then 2 s of silence and `audioStreamEnd`.
4. A text question that triggered the tool, and the tool response.
5. A request for a long story, then a spoken barge-in 0.8 s after the first audio arrived.

### Latency (Mac, office network)

| Step | Run A (OkHttp) | Run B (CIO) |
|---|---|---|
| `setup` sent → `setupComplete` | 657 ms | 756 ms |
| Text sent → first audio | 564 ms | 468 ms |
| End of speech → first audio (includes server end-of-speech detection) | 1,382 ms | 1,497 ms |
| Text sent → `toolCall` | 289 ms | 351 ms |
| `toolResponse` sent → first audio | 401 ms | 1,200 ms |
| Barge-in speech starts → `interrupted` | 239 ms | 340 ms |

`gemini-3.8-live` answered every turn.

### Message types

Every message type below has an example in `fixtures/spike/live/messages/`. The full ordered session is in `live/session-ktor-okhttp.json`; long base64 payloads are cut to 48 characters there.

| Direction | Message | Shape observed |
|---|---|---|
| client → server | setup | `{"setup":{"model":"models/gemini-3.8-live"}}` |
| client → server | text | `{"realtimeInput":{"text":"..."}}` |
| client → server | audio | `{"realtimeInput":{"audio":{"data":"<base64 PCM16>","mimeType":"audio/pcm;rate=16000"}}}` |
| client → server | end of audio | `{"realtimeInput":{"audioStreamEnd":true}}` |
| client → server | tool response | `{"toolResponse":{"functionResponses":[{"id":"fc_…","name":"get_time","response":{"time":"14:05"}}]}}` |
| server → client | ready | `{"setupComplete":{}}` |
| server → client | resume handle | `{"sessionResumptionUpdate":{"newHandle":"…","resumable":true}}`. Sent even though resumption was never asked for. The spec doesn't resume, so ignore it. |
| server → client | audio plus transcript | `{"serverContent":{"modelTurn":{"role":"model","parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"…"}}]},"outputTranscription":{"text":"…"}}}`. The output transcript arrives in the same message as audio parts. |
| server → client | input transcript | `{"serverContent":{"inputTranscription":{"text":"Hi there. I slept badly…"}}}`. It arrived in one piece at the end of the utterance, not streamed. |
| server → client | voice activity | `{"voiceActivity":{"type":"ACTIVITY_START","audioOffset":"0.200s"}}`, and `ACTIVITY_END`. **Not in the research note.** |
| server → client | tool call | `{"toolCall":{"functionCalls":[{"name":"get_time","args":{},"id":"fc_18429171870273940054"}]}}` |
| server → client | interrupted | `{"serverContent":{"interrupted":true}}` |
| server → client | generation complete | `{"serverContent":{"generationComplete":true}}` |
| server → client | turn complete plus usage | `{"serverContent":{"turnComplete":true},"usageMetadata":{"promptTokenCount":…,"responseTokenCount":…,"totalTokenCount":…,"promptTokensDetails":[…],"responseTokensDetails":[…],"thoughtsTokenCount":…}}` |
| server → client | empty | `{}` (90 in one session) and `{"serverContent":{}}`. Parse them as no events. |
| server → client | `goAway`, `toolCallCancellation` | Not seen; the sessions were far shorter than the 10-minute connection limit. |

### Findings that change how the client is built (#14, #15, #30)

1. **Every server frame is a binary WebSocket frame** that holds UTF-8 JSON. A client that only reads `Frame.Text` sees nothing. Client frames can be text.
2. **One message can carry several parts** (audio plus output transcript), and many messages carry none (`{}`). Write the parser as "message → list of events", as the spec says. The prototype `parseServerMessage` in the harness does this.
3. **`turnComplete` comes seconds after `generationComplete`**, about when real-time playback of the reply would end (2 to 6 s later). `usageMetadata` rides on `turnComplete`. Use `generationComplete` for "the model has said everything" and `turnComplete` for "the turn is over".
4. **The server's end-of-speech detection needs more than about 1.2 s of silence.** With 1.2 s of silence and then nothing more, the turn never ended: there was `ACTIVITY_START` but no `ACTIVITY_END`. With 2 s, `ACTIVITY_END` came about 1.3 s after the speech stopped, before `audioStreamEnd` was sent. The phone streams the microphone continuously, so this only matters for mute: send `audioStreamEnd` when the Patient mutes.
5. **Barge-in works after `generationComplete` too.** The server still treats the reply as playing. The order is `voiceActivity ACTIVITY_START` → `interrupted:true` → `turnComplete` (with usage) for the cut turn → the new reply after the barge-in speech ends. Stop playback on `interrupted` at once.
6. **Tool round trip.** `toolCall.functionCalls[].id` looks like `fc_<digits>`. Answering with `{id, name, response}` worked with `behavior: "BLOCKING"`. `NON_BLOCKING` with `scheduling` was not tested.
7. The first audio part of a reply is often a 2-byte `"AAA="` (silence).

### Raw WebSocket or Firebase AI Logic

**Decision: the build uses the raw Ktor WebSocket.**
- The whole protocol worked from common Kotlin with the OkHttp engine that Android uses, with `gemini-3.8-live` and a locked ephemeral token.
- Firebase AI Logic is Android-only (no KMP artifact) and doesn't list `gemini-3.8-live`. It authenticates through Firebase and App Check, so it can't use our locked token, and the Brief and tools would sit in the app. It stays the fallback only.
- **Still to confirm by a person:** the same code on the S24+ with the real microphone and playback, and the Darwin engine on an iPhone.

## 3. Text model with structured output (Finish Check-in, #14)

`POST https://generativelanguage.googleapis.com/v1/interactions` (`v1beta` gives the same result), with the key in the header:

```json
{
  "model": "gemini-4-hydrogen",
  "store": false,
  "system_instruction": "You summarise a short wellbeing Check-in ... never invent ratings.",
  "input": "Check-in transcript:\n<transcript as text>",
  "response_format": {
    "type": "text",
    "mime_type": "application/json",
    "schema": {
      "type": "object",
      "properties": {
        "mood": { "type": ["integer", "null"], "minimum": 1, "maximum": 5 },
        "energy": { "type": ["integer", "null"], "minimum": 1, "maximum": 5 },
        "sleepQuality": { "type": ["integer", "null"], "minimum": 1, "maximum": 5 },
        "sleepLine": { "type": "string" },
        "themes": { "type": "array", "items": { "type": "string" }, "maxItems": 4 },
        "suggestion": { "type": ["string", "null"] },
        "previousOutcome": { "type": ["string", "null"] },
        "previousTried": { "type": ["boolean", "null"] },
        "previousFelt": { "type": ["integer", "null"], "minimum": 1, "maximum": 5 },
        "quotes": { "type": "array", "items": { "type": "string" }, "maxItems": 3 }
      },
      "required": ["mood", "energy", "sleepQuality", "sleepLine", "themes", "suggestion",
                   "previousOutcome", "previousTried", "previousFelt", "quotes"],
      "additionalProperties": false
    }
  }
}
```

(The fixture has a `description` on every property as well.)

### Response

The response has `status`, `usage`, `created`, `updated`, `service_tier`, `steps`, `object` and `model`. With `store: false` there is **no `id`**. `steps` is a `thought` step (an opaque signature only), then a `model_output` step. The JSON is the text of `model_output.content[0].text`, which is what the SDK's `output_text` returns.

The fictional transcript gave `mood: 3`, `energy: 2`, `sleepQuality: 2`, four themes, the agreed Suggestion, `previousTried: true`, `previousFelt: null` and three verbatim quotes. Nothing was invented.

### Notes for #14

- Union types such as `["integer", "null"]` are accepted. Per the structured-output docs, `minLength`/`maxLength` are ignored, so the code must still cap quotes at three of at most 200 characters and turn out-of-range ratings into null, as the spec says.
- The calls took 6.6 s and 7.8 s, including 844 thought tokens. That fits the 15-second timeout, but not by much. Lowering the thinking level was not tried.
- `TextRequest` in `firebase/functions/src/gemini.ts` needs a `response_format` field. `@google/genai` 3.3.0 already types `response_format` on `interactions.create`.

## 4. Decisions API (#20)

`POST https://generativelanguage.googleapis.com/v1beta/decisions` (`v1beta` only), with the key in the header:

```json
{
  "model": "gemini-decision-1",
  "input": "Check-in transcript:\n<transcript as text>",
  "questions": {
    "crisis":    { "type": "noul", "instructions": "Does the Patient express thoughts of self-harm or suicide, or say they might act on such thoughts?" },
    "decline":   { "type": "noul", "instructions": "Does the Patient express marked hopelessness or describe a clear decline in how they are coping compared with before?" },
    "triedLast": { "type": "noul", "instructions": "Did the Patient say they tried the previous Suggestion the Companion asked about?" }
  }
}
```

### Response

```json
{
  "answers": {
    "crisis":    { "type": "noul", "noul": 0.0187, "confidence": 0.9813 },
    "decline":   { "type": "noul", "noul": 0.0558, "confidence": 0.9442 },
    "triedLast": { "type": "noul", "noul": 0.9812, "confidence": 0.9812 }
  },
  "usage": { "total_tokens": 434, "total_input_tokens": 434, "input_tokens_by_modality": [...], "total_output_tokens": 0 }
}
```

| Transcript (fictional) | crisis | decline | triedLast | Latency |
|---|---|---|---|---|
| Routine: tried the walk, slept badly, agreed to a stretch break | 0.02 | 0.06 | 0.98 | 1.3 s |
| Crisis: "everyone would be better off without me", didn't go out | 0.93 | 0.99 | 0.01 | 0.3 s |

With the spec's starting thresholds (crisis ≥ 0.5, decline ≥ 0.6, tried ≥ 0.6 or ≤ 0.4), both transcripts route as expected. `confidence` came back as `max(noul, 1 − noul)` in every answer.

### Errors and safety refusals

- **The fictional crisis transcript was answered, not refused.** No refusal could be observed with fictional content.
- The docs give the refusal shape as HTTP 400 with `{"error":{"message":"Request blocked due to safety violations (harmful content).","code":"safety"}}`. The other documented codes are `prohibited_content`, `blocklist`, `image_safety` and `content_blocked`. It is saved as `decisions/safety-refusal-documented.json` and marked "not observed".
- Decisions errors use a **string** `code`, unlike the usual Google RPC envelope. An invalid request returned `{"error":{"message":"The value 'yesno' is not supported for 'type' at 'questions.bad'. …","code":"invalid_request"}}` (`decisions/error-invalid-question-type.json`).
- #20 should treat any HTTP 400 whose `error.code` is one of the safety codes as a safety refusal ("amber, could not be assessed automatically"). Any other failure is "assessment unavailable".

## 5. Maps (#18)

**Update, 14 November 2026: the Maps agent tools are enabled and verified.** `mapstools.googleapis.com` ("Maps Experience agent tools") is now enabled on `junction26hel-7400`. With the stored `MAPS_API_KEY`, `v1:lookupWeather`, `v1:searchText` and `v1:computeRoutes` all returned HTTP 200. The key `depressify-maps` allows mapstools, places, weather and routes. #18 (the Map tool) is being built by a teammate. The 403 results below are what the spike saw before the API was enabled.

The Maps key is in Secret Manager as `MAPS_API_KEY`. Its API restrictions already allow `mapstools.googleapis.com`, `routes.googleapis.com`, `places.googleapis.com` and `weather.googleapis.com`. The key was sent only in the `X-Goog-Api-Key` header.

Enabled on the project at the time of the spike: `places.googleapis.com` and `weather.googleapis.com`. Not enabled: `mapstools.googleapis.com` and `routes.googleapis.com`.

| Call | Result |
|---|---|
| `POST https://mapstools.googleapis.com/v1:lookupWeather` `{location:{latLng}}` | 403 |
| `POST https://mapstools.googleapis.com/v1:searchText` `{textQuery, languageCode, regionCode}` | 403 |
| `POST https://mapstools.googleapis.com/v1:computeRoutes` `{origin:{latLng}, destination:{latLng}, travelMode:"WALK"}` | 403 |
| `POST https://places.googleapis.com/v1/places:searchText`, `X-Goog-FieldMask: places.id,places.displayName,places.location,places.googleMapsUri,places.primaryType,places.formattedAddress`, body `{textQuery:"park", locationBias:{circle:{center, radius:1500}}, pageSize:5, languageCode:"en", regionCode:"FI"}` | 200 in 0.7 s: Old Church Park, Esplanadi, Kaisaniemi Park, Hesperianpuisto, Kaivopuisto (all `city_park`) |
| `GET https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=60.1699&location.longitude=24.9384` | 200 in 1.1 s: mostly cloudy, 3 °C (feels like −2 °C), 18 % chance of snow |
| `GET .../v1/forecast/hours:lookup?...&hours=6` and `.../v1/forecast/days:lookup?...&days=1` | 200 |
| `POST https://routes.googleapis.com/directions/v2:computeRoutes` (WALK, `X-Goog-FieldMask: routes.duration,routes.distanceMeters`) | 403 |

All four 403s have the same shape, with `metadata.service` naming the API: `{"error":{"code":403,"message":"Permission denied on the service.","status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"ACCESS_DENIED","domain":"googleapis.com","metadata":{"service":"mapstools.googleapis.com"}}, …]}}`. The reason is `ACCESS_DENIED`, not `SERVICE_DISABLED`.

The mapstools request bodies above follow the reference pages, but the nested `Location` and `Waypoint` shapes (`latLng`) are **not verified**, because the calls never got past the permission check.

### Maps agent tools after enabling

`mapstools.googleapis.com` was enabled later on 14 November, and the three calls were re-run from the sample location in Otaniemi (60.185, 24.8324). The fixtures `maps/mapstools-*.json` now hold these real responses, with `contentToken` and `retrievalToken` redacted; the 403s above are no longer recorded.

| Call | Result |
|---|---|
| `:searchText` `{textQuery, languageCode, locationBias:{circle:{center, radiusMeters}}}` | 200 in 1.1 s: `places[]` (`id`, `location`, `googleMapsLinks`, `attribution.title`), a `summary` and a `contentToken`. The place name is only in `attribution.title` ("Flowel yoga - Google Maps") and the summary. |
| `:lookupWeather` `{location:{latLng}, languageCode, capabilities:["WEATHER"]}` | 200 in 0.4 s: `weather` with temperature, feels-like, condition, precipitation, wind and an `attribution`. No daylight field. |
| `:computeRoutes` `{origin:{latLng}, destination:{latLng}, travelMode:"WALK"}` | 200 in 0.3 s: `routes[0].distanceMeters` and `duration` ("1677s") |

- The `latLng` shapes are now verified.
- `lookupWeather` without `capabilities` is HTTP 400, "At least one capabilities value must be specified".
- The circle's field is `radiusMeters`; `radius` (the direct Places name) is HTTP 400.
- The location bias is weak: "health clinic" from Otaniemi returned a clinic in Tallinn first. `mapTool` sorts by distance and drops anything over 10 km.

### Maps agent tools or direct APIs

| | Maps agent tools (`mapstools`) | Direct Places (New) + Weather + Routes |
|---|---|---|
| Works today | Yes since 14 November (enabled; all three calls answered HTTP 200). At the spike: no | Places and Weather yes; Routes needs `routes.googleapis.com` enabled |
| Services to call | One (weather, places and routes) | Three, each with its own request shape and field masks |
| Price for one place search | Essentials: 10,000 free a month, then $7 per 1,000 | Text Search Pro (needed for names and Maps links): 5,000 free a month, then $32 per 1,000 |
| Price for weather and a route | Same SKU as above | Weather: 10,000 free, then $0.15 per 1,000. Routes Essentials: 10,000 free, then $5 per 1,000 |
| Passing results to Gemini | Built for it: the terms explicitly allow grounding an LLM with this output | Not explicitly allowed. The EEA Places terms limit Places content to nine listed purposes, and the research note could not confirm that recommending places through an LLM is one |
| Attribution | Each place shown with "Google Maps" attribution and a link from `googleMapsLinks.placeUrl`, right after the content it supports. A voice app also needs a companion screen with the verbatim conversation and the sources, plus a standing notice that answers may include Google Maps information | Google Maps logo or the text "Google Maps" next to any place content shown off a map; no names or addresses stored (place IDs only) |
| Output | A summary plus place IDs, coordinates and links, with up to 5 places on Essentials | Fields we choose |

Sources: [google-maps-platform.md](research/google-maps-platform.md) and the [agent tools overview](https://developers.google.com/maps/ai/maps-experience-agent-tools).

**Recommendation for #18: Maps agent tools.**
- It is one service for all three tools.
- A place search costs a quarter as much.
- It is the only path whose terms explicitly allow passing the results to an LLM, which is what the Companion does.
- The spec already requires a live transcript and a standing "place results come from Google Maps" line on the Check-in screen, which covers the voice attribution rule.

**What the user must do:**
- Enable `mapstools.googleapis.com` on `junction26hel-7400`, for example with `gcloud services enable mapstools.googleapis.com --project junction26hel-7400`.
- Then re-run the three mapstools calls (`spike/6/node/maps.mjs` on the throwaway branch) to capture real fixtures and confirm the `Location` and `Waypoint` shapes.
- The key needs no change.

**Fallback if mapstools can't be enabled:** use the direct APIs, which already work for places and weather.
- Enable `routes.googleapis.com` for the walking route.
- Keep the Places field mask to `places.id,places.displayName,places.googleMapsUri,places.location`.
- Store only place IDs.

## 6. Calendar: steps for a person

The Calendar spike needs a Google account to grant consent on the phone, so it was not run. The research note picks `calendar.events.owned` as the narrowest single scope that reads events and inserts them on calendars the user owns. Free/busy is covered by reading events.

1. **Consent screen.** In Google Cloud Console for `junction26hel-7400`, open Google Auth Platform → Branding and Audience:
   - Set the user type to External and the status to Testing.
   - Add the Google accounts of the testers and the demo phone under **Test users**. Testing allows up to 100.
   - Consent in Testing mode expires after 7 days, so re-consent before the demo if needed.
2. **Data access.** Add the scope `https://www.googleapis.com/auth/calendar.events.owned`.
3. **Enable the API.** Enable `calendar-json.googleapis.com`. This is not done yet.
4. **OAuth clients.** Create:
   - An **Android** client for package `app.depressify.patient` with the debug keystore's SHA-1 (`./gradlew :androidApp:signingReport`).
   - A **Web** client, whose ID the app passes as the server client ID.
   - An **iOS** client for bundle `app.depressify.patient`, if iOS is tried.
5. **On the S24+:** request the scope with `Identity.getAuthorizationClient(activity).authorize(...)`, then use the access token to call these three endpoints:
   - `POST https://www.googleapis.com/calendar/v3/freeBusy` for today on `primary`.
   - `GET https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=…&timeMax=…&singleEvents=true&orderBy=startTime`.
   - `POST https://www.googleapis.com/calendar/v3/calendars/primary/events` with a fictional 10-minute "Stretch break".
6. **Check the scope.** Confirm all three calls succeed with only `calendar.events.owned`. If free/busy is refused, add `calendar.freebusy` and record that.
7. **Save the results.** Save the raw responses as `fixtures/spike/calendar/*.json`, with event IDs, emails and tokens redacted.

## Needs a person

| Item | What to do | Unblocks |
|---|---|---|
| Live on the S24+ | Run the Ktor client from `shared` with the OkHttp engine and the real microphone (voice communication source, echo cancellation). Hold a natural 30-second spoken Check-in with one tool call and one barge-in, using a token from a throwaway callable. Save the messages the same way as above. | #15 |
| Live on an iPhone | Same, with the Darwin engine and voice processing on. A fail narrows #30 to typed Check-ins. | #30 |
| Health Connect and HRV | On the S24+ with the Galaxy Watch and Samsung Health sync on, read 14 days of steps, sleep sessions, heart rate, resting heart rate and HRV. List which record types hold data, and say plainly whether Samsung writes HRV. | #24 |
| Usage statistics | On the S24+, check whether screen-on spans from `UsageStatsManager` are usable for late-night screen time. | #24 |
| Calendar | The steps above | #19 |
| Maps agent tools | Enable `mapstools.googleapis.com`, then re-run the three calls | #18 |

## Decisions for the build

1. **Firestore region:** `europe-north1` (Finland). The database is already there, and the functions run there too, except the scheduled Digest in `europe-west1` (no Cloud Scheduler in `europe-north1`).
2. **Live transport:** a raw Ktor WebSocket from common Kotlin to `BidiGenerateContentConstrained`.
   - Use the `access_token` query parameter; the `Authorization: Token` header also works.
   - Decode binary frames.
   - Firebase AI Logic is the fallback only, if the S24+ test fails.
3. **Token body (Start Check-in, #14):** `POST /v1beta/auth_tokens` with `uses: 1`, `expireTime` about 10 minutes (covers the 8-minute cap), `newSessionExpireTime` about 60 s, and `bidiGenerateContentSetup` (model, `generationConfig.responseModalities: ["AUDIO"]`, `systemInstruction` (the Brief), `tools`, both transcriptions). Add a `fieldMask` that lists every field set, **including `model`**. Plain `fetch` works; so does `@google/genai` `ai.authTokens.create` with `liveConnectConstraints`. Return only `name` to the phone, and never log it.
4. **Structured output (Finish Check-in, #14):** Interactions `response_format: { type: "text", mime_type: "application/json", schema }` on `gemini-4-hydrogen` with `store: false`. Read the JSON from `output_text`. Validate and clamp in code.
5. **Decisions (#20):** `POST /v1beta/decisions` with `gemini-decision-1` and three `noul` questions keyed `crisis`, `decline` and `triedLast`. Read `answers.<key>.noul`. Route `error.code` ∈ {`safety`, `prohibited_content`, `blocklist`, `image_safety`, `content_blocked`} to "could not be assessed automatically".
6. **Maps (#18):** Maps agent tools once `mapstools.googleapis.com` is enabled. Until then, or as the fallback, direct Places (New) and Weather, plus Routes once `routes.googleapis.com` is enabled.

## Not verified

- Anything on a phone: microphone capture, echo cancellation, playback, the OkHttp engine on Android itself, and the Darwin engine.
- `goAway`, `toolCallCancellation`, session resumption and context compression: not seen in sessions of about 30 s.
- `NON_BLOCKING` tools with `scheduling`.
- Finnish speech.
- A Decisions safety refusal: the shape is from the docs only.
- The mapstools request and response shapes beyond the permission error.
- Whether a lower thinking level speeds up the structured-output call.
