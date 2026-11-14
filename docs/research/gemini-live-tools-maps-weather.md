# Gemini Live tools, Maps grounding, Maps and Weather on the phone

Researched 2026-11-14 against Google's docs (Gemini docs through the Gemini docs MCP index of [aistudio.google.com/docs](https://aistudio.google.com/llms.txt), Maps docs through search). This file adds to [gemini-api.md](gemini-api.md) and [google-maps-platform.md](google-maps-platform.md) and does not repeat them. Written under time pressure: the Maps Platform half was checked less deeply than the Gemini half, and "Not verified" lists what was not read at the source. No live API call was made for this file.

## Corrections to the existing notes

The Gemini docs changed since 2026-11-13, or the earlier notes misread them:

| Earlier claim | Docs today | Source |
|---|---|---|
| Affective dialog is removed in the 3.8 Live models (gemini-api.md section 1) | Supported on `gemini-3.8-live` and `-extended-thinking`; set `enableAffectiveDialog: true` in setup, `v1beta` | [capabilities: affective dialog](https://aistudio.google.com/docs/live-api/capabilities#affective-dialog), [model comparison](https://aistudio.google.com/docs/live-api/capabilities#model-comparison) |
| Proactive audio is always on and setting it false errors | Opt-in: `proactivity: { proactiveAudio: true }`, `v1beta` | [capabilities: proactive audio](https://aistudio.google.com/docs/live-api/capabilities#proactive-audio) |
| Model card says NON_BLOCKING is the default on `gemini-3.8-live` | The model card's migration section no longer says so; the tools guide says calls are sequential (blocking) by default. The repo skill still says "by default". Keep setting `behavior` explicitly | [model card](https://aistudio.google.com/docs/models/gemini-3.8-live#migrating), [tools](https://aistudio.google.com/docs/live-api/tools#async-function-calling) |
| `gemini-4-hydrogen` is the default text model and supports Maps grounding | The models page lists only `gemini-4-argon` under Gemini 4, and the Maps grounding table lists Gemini 4 Argon, not Hydrogen. Searching the docs for "hydrogen" finds nothing. Check the model string before relying on it | [models](https://aistudio.google.com/docs/models#all-gemini-4-models), [Maps grounding: supported models](https://aistudio.google.com/docs/maps-grounding#supported-models) |
| Live output is audio only | The model card now lists output "Text and audio"; one modality per session still applies (skill) | [model card](https://aistudio.google.com/docs/models/gemini-3.8-live) |
| `gemini-3.8-live-extended-thinking` thinking level unstated | Defaults to `HIGH`; `gemini-3.8-live` is fixed at `MINIMAL` | [model comparison](https://aistudio.google.com/docs/live-api/capabilities#model-comparison) |

## 1. Tool use in the Live API

### Which tools work in which Live model

| Tool | `gemini-3.8-live` | `gemini-3.8-live-extended-thinking` | `gemini-3.1-flash-live-preview` | Gemini 2.5 Flash Live Preview |
|---|---|---|---|---|
| Function calling | Sync and async | Async only (every declaration must be `NON_BLOCKING`, else error) | Sync only | Sync and async |
| Google Search | Yes | Yes | Yes | Yes |
| Google Maps grounding | No | No | No | No |
| Code execution | No | No | No | No |
| URL context | No | No | No | No |

Source: [Live tool use, overview table](https://aistudio.google.com/docs/live-api/tools#tools-overview); the [3.8 Live model card](https://aistudio.google.com/docs/models/gemini-3.8-live) agrees (Maps grounding, code execution, URL context, structured output, file search all "not supported"). Google Search and function declarations can be combined in one session: `tools: [{ googleSearch: {} }, { functionDeclarations: [...] }]` ([combining tools](https://aistudio.google.com/docs/live-api/tools#combine-tools)).

### Protocol

- Declarations go in `setup.tools[].functionDeclarations` (name, description, parameters, optional `behavior`) ([tools](https://aistudio.google.com/docs/live-api/tools#function-calling)).
- The server sends `toolCall.functionCalls[]` (each with `id`, `name`, `args`). The client answers with `toolResponse.functionResponses[]`, matched by `id`. Live never runs functions for you ([BidiGenerateContentToolResponse](https://aistudio.google.com/api-reference/live#bidigeneratecontenttoolresponse)).
- On a barge-in, generation is discarded, pending function calls are dropped and the server sends `toolCallCancellation.ids[]`. "If there were side-effects to those tool calls, clients may attempt to undo the tool calls" ([ToolCallCancellation](https://aistudio.google.com/api-reference/live#bidigeneratecontenttoolcallcancellation), [VAD](https://aistudio.google.com/docs/live-api/capabilities#interruptions)).

### NON_BLOCKING and scheduling

- Add `"behavior": "NON_BLOCKING"` to a declaration; the conversation continues while it runs. Supported on `gemini-3.8-live` and 2.5 Flash Live, required on `-extended-thinking`, not supported on `gemini-3.1-flash-live-preview` ([async function calling](https://aistudio.google.com/docs/live-api/tools#async-function-calling)).
- `scheduling` is set per response. The guide puts it inside the response object: `{ id, name, response: { result: ..., scheduling: "INTERRUPT" } }` (same page).
  - `INTERRUPT`: add to context, interrupt ongoing generation and speak now.
  - `WHEN_IDLE`: add to context, speak after the current output without interrupting. This is the default.
  - `SILENT`: add to context only; used later in the conversation.
  - Ignored for blocking calls. Definitions and default from the SDK type docs ([go-genai FunctionResponseScheduling](https://pkg.go.dev/google.golang.org/genai#FunctionResponseScheduling)).

## 2. Grounding with Google Maps (non-Live)

- **Live:** not available on any Live model (table above).
- **Models:** Gemini 4 Argon, 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Pro Preview, 3.1 Flash-Lite, 3 Flash Preview, 2.5 Pro/Flash/Flash-Lite ([supported models](https://aistudio.google.com/docs/maps-grounding#supported-models)). Gemini 3 models can combine it with function calling; with Google Search on 3.5 Flash and later ([tool combinations](https://aistudio.google.com/docs/maps-grounding#tool-combination), [tool-combination](https://aistudio.google.com/docs/tool-combination#supported-tools)).
- **Interactions request** (what the guide now shows): `"tools": [{ "type": "google_maps", "latitude": .., "longitude": .. }]`. Response text carries `place_citation` annotations with `place_id` (`places/{id}`), `name`, `url`, `review_snippets[]`, `start_index`/`end_index` ([guide](https://aistudio.google.com/docs/maps-grounding#get-started), [Interactions reference, TextContent](https://aistudio.google.com/api-reference/interactions)).
- **generateContent request:** `tools: [{ googleMaps: { enableWidget? } }]` plus `toolConfig.retrievalConfig: { latLng: { latitude, longitude }, languageCode }` ([GoogleMaps](https://ai.google.dev/api/generate-content#googlemaps), [RetrievalConfig](https://ai.google.dev/api/caching#retrievalconfig)). Response `candidates[].groundingMetadata`: `groundingChunks[].maps` with `uri`, `title`, `text`, `placeId` (`places/{id}`), `placeAnswerSources`; plus `groundingSupports[]` and optional `googleMapsWidgetContextToken` ([Maps chunk](https://ai.google.dev/api/generate-content#maps), [GroundingMetadata](https://ai.google.dev/api/generate-content#groundingmetadata)).
- **Widget is being retired.** SDK docs: "The Google Maps contextual widget behavior in Grounding with Google Maps is being deprecated; this field is planned for removal and no longer has any effect once removed" ([.NET GoogleMaps.EnableWidget](https://github.com/googleapis/dotnet-genai/blob/main/Google.GenAI/types/GoogleMaps.cs)). Do not build on `googleMapsWidgetContextToken` or the contextual place element. I did not read the Places UI Kit contextual element page.
- **Display rules:** sources immediately follow the grounded text, visible within one interaction; each source a link preview with the returned name and URL, attributed "Google Maps" unmodified, untranslated, one line, `translate="no"` ([service usage requirements](https://aistudio.google.com/docs/maps-grounding#service-usage-requirements)).
- **Pricing:** Gemini 3 and newer: per search query the model runs, 5,000 free a month shared, then $14 per 1,000; one prompt can run several queries. Gemini 2.5: $25 per 1,000 grounded prompts. Quota follows the model's rate limits ([pricing and rate limits](https://aistudio.google.com/docs/maps-grounding#pricing-and-rate-limits)).
- **Limits:** English prompts and responses only; the page still says both "may not be available in all regions" and "globally available" ([limitations](https://aistudio.google.com/docs/maps-grounding#limitations)).

## 3. Maps Platform on the phone

### Maps SDK for Android and Maps Compose

- Key goes in `AndroidManifest.xml` inside `<application>` as `<meta-data android:name="com.google.android.geo.API_KEY" android:value="..."/>`. Enable **Maps SDK for Android** on the project with billing; restrict the key to Android apps (package name plus SHA-1, debug and release fingerprints separately) and to the Maps SDK for Android API ([get API key](https://developers.google.com/maps/documentation/android-sdk/get-api-key)).
- A wrong, unrestricted-mismatch or disabled key gives a map with no tiles (blank grey) and an authorization failure in logcat; Google's FAQ says to run `adb logcat -e "Google Maps Android API"` to see it ([FAQ](https://developers.google.com/maps/faq)). This came from search results over those pages; I did not read the exact log text at the source.
- Maps SDK map loads are free and unlimited ([price list](https://developers.google.com/maps/billing-and-pricing/pricing)); Maps Compose `GoogleMap`, `Marker`, `Circle` are covered in google-maps-platform.md section 5.

### Maps Experience agent tools (mapstools) and maps

- Attribution: sources immediately after the generated content, reachable in one interaction, using each result's title and URL and the text "Google Maps" ([attribution](https://developers.google.com/maps/ai/maps-experience-agent-tools/attribution)). Voice apps have the extra companion-screen rule in google-maps-platform.md section 6.
- EEA: Google's EEA FAQ says projects under the EEA terms must use Places UI Kit to show Places content, and that Places API content may no longer be shown with any map, including a Google Map ([EEA FAQ](https://developers.google.com/maps/comms/eea/faq)). Whether that rule covers mapstools output is not stated on the pages I saw; the mapstools terms are their own section of the [EEA service terms](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms), which I did not reread.
- An **agentic data visualization token** lets Places UI Kit elements render places returned by the agent tools without extra UI Kit billing; it does not cover map loads ([agentic data visualization token](https://developers.google.com/maps/ai/agentic-data-visualization-token)). Not read in detail.
- EEA terms apply to projects created on or after 8 July 2025, or integrations materially changed after that date ([EEA FAQ](https://developers.google.com/maps/comms/eea/faq)).

### Not covered in this pass

Maps Static API, Places (New) photo media, and Weather API details were not re-researched; the Weather and Places Photo endpoints in google-maps-platform.md sections 2 and 3 stand as written.

## 4. Letting the voice model show cards

- Google's Live guidance: define each tool precisely, including the **invocation condition** in the description ("Invoke this tool only after ..."), and name tool calls step by step in the system instruction ([best practices: tools](https://aistudio.google.com/docs/live-api/best-practices#tool-definitions), [example](https://aistudio.google.com/docs/live-api/best-practices#tool-definitions-example)). "The model performs best on tasks with single function calls" ([prompts](https://aistudio.google.com/docs/live-api/best-practices#prompt-design)). General function calling: 10 to 20 tools at most, strong types and enums, validate calls before running them ([function calling best practices](https://aistudio.google.com/docs/function-calling#best-practices)).
- Google has no page on UI cards from Live. The pattern below is my inference from the protocol: the phone already receives every `toolCall`, so a display tool (`find_places`, `get_weather`, `record_suggestion`) can render a card locally and reply with a short fact summary for the model to speak. Keep the response small: everything returned joins the context and is re-billed every turn ([pricing and billing](https://aistudio.google.com/docs/live-api/best-practices#pricing-billing)).
- With `NON_BLOCKING`, a card can appear while the model keeps talking: reply `SILENT` for pure display or background context, `WHEN_IDLE` when the model should mention the result. `INTERRUPT` only for urgent content.
- On `toolCallCancellation`, remove any card shown for those ids.
- Session limits relevant to tool results: 128k context, audio about 25 tokens a second; compression drops the oldest turns, which can include earlier tool results; resumption handles last 2 hours ([session management](https://aistudio.google.com/docs/live-api/best-practices#session-management)). gemini-api.md notes a session is not resumable mid tool call ([SessionResumptionUpdate](https://aistudio.google.com/api-reference/live#SessionResumptionUpdate)).

## What this means for this repo

- `firebase/functions/src/tools.ts` forces every declaration to `BLOCKING`, the only behaviour the #6 spike verified. `gemini-3.8-live` does support `NON_BLOCKING` with `scheduling`; switching `find_places` and `get_weather` to it, answering `WHEN_IDLE`, would let the model keep talking during the about one-second `mapTool` round trip. That needs a spike: the response shape (`scheduling` inside `response`) and the toolCallCancellation path are untested here.
- Do not switch to Live-side Maps grounding: no Live model supports it. The current route (Live function call, phone, `mapTool` callable, mapstools) remains the right one. Grounding with Google Maps is only an option for `suggestToday` on a non-Live model, and only in English.
- The project is in Finland. If its billing account is EEA, showing mapstools place results as markers on the embedded Google map (`PlacesMap.android.kt`) may conflict with the EEA "no Places content with any map" rule; this is unresolved and needs a reading of the mapstools section of the EEA service terms.
- `PlacesMap.android.kt` reads the manifest key and emits nothing when it is blank, so an empty `maps.apiKey` shows no map at all. A non-empty but invalid or unrestricted-mismatch key gives the grey map plus logcat authorization failure.
- Affective dialog is available again on `gemini-3.8-live` and may suit a wellbeing companion; it would need a check that the token's `bidiGenerateContentSetup` accepts `enableAffectiveDialog`.

## Not verified

- Placement of `scheduling`: guide shows it inside `response`; whether the Live reference `FunctionResponse` also accepts it top-level was not checked.
- Default `behavior` on `gemini-3.8-live` (docs and repo skill disagree).
- Behaviour with an empty (not missing) `com.google.android.geo.API_KEY` without the repo's guard: crash at startup vs grey map. Not tested.
- Whether EEA "no use with any map" applies to mapstools results; agentic visualization token details.
- Maps Static API, Places photo media, Weather API endpoints: not rechecked this pass.
- Places UI Kit contextual element and the widget deprecation date.

