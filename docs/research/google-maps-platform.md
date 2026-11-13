# Google Maps Platform: surroundings context and activity suggestions

Researched 2026-11-13 against Google's own docs and terms. Prices are USD, pay-as-you-go, global list. Every claim links to the page that owns it. Items I could not confirm are listed under "Not verified".

## 1. What matters most

1. **Billing address decides the rules.** A Google Cloud project created after 8 July 2025 on a billing account with an EEA address (Finland is listed) falls under the EEA terms ([EEA FAQ](https://developers.google.com/maps/comms/eea/faq)). Under those terms, Places API content other than latitude, longitude and place ID must not be shown "with any map", and may only be used for a closed list of nine purposes ([Places EEA guide](https://developers.google.com/maps/comms/eea/places), [permitted uses](https://cloud.google.com/terms/maps-platform/eea-places-api-permitted-uses)). Recommending parks or yoga studios to a patient is not clearly on that list. Places UI Kit is exempt from both restrictions.
2. **Grounding with Google Maps does not work in Live sessions.** The Live API tool table marks Google Maps "Not supported" for all four Live models; Search and function calling are supported ([Live API tool use](https://aistudio.google.com/docs/live-api/tools.md)).
3. **Maps Experience agent tools (formerly Maps Grounding Lite) fits the voice agent best.** One REST/MCP service returns places, weather, air quality, pollen and routes, with 10,000 free requests a month. It can be wrapped as Live function calls from the backend ([overview](https://developers.google.com/maps/ai/maps-experience-agent-tools)).
4. **Weather is cheap and covers Finland** on all five endpoints, including alerts ([coverage](https://developers.google.com/maps/documentation/weather/coverage)).
5. **No official Kotlin Multiplatform map component exists.** Maps Compose is Android only ([repo](https://github.com/googlemaps/android-maps-compose)). Plan one map per platform behind an `expect`/`actual` composable.

## 2. Places API (New)

Use for this product: find nearby parks, nature, yoga, wellness, gyms and cafes to suggest; fetch details and a photo for a suggestion card.

Base URL: `https://places.googleapis.com/v1`. Status: current version; the older API is labelled Legacy.

| Method | Endpoint | Notes | Source |
|---|---|---|---|
| Text Search | `POST /places:searchText` | Body `textQuery`. Optional `includedType` (one type), `strictTypeFiltering`, `locationBias`, `locationRestriction`, `openNow`, `minRating`, `rankPreference`, `languageCode`, `regionCode`, `pageSize` 1 to 20, `pageToken` | [doc](https://developers.google.com/maps/documentation/places/web-service/text-search) |
| Nearby Search | `POST /places:searchNearby` | Body `locationRestriction.circle` (radius 0 to 50,000 m), `includedTypes`/`excludedTypes`/`includedPrimaryTypes`/`excludedPrimaryTypes` (up to 50 each), `maxResultCount` 1 to 20, `rankPreference` (`POPULARITY` default) | [doc](https://developers.google.com/maps/documentation/places/web-service/nearby-search) |
| Place Details | `GET /places/PLACE_ID` | Optional `languageCode`, `regionCode`, `sessionToken` | [doc](https://developers.google.com/maps/documentation/places/web-service/place-details) |
| Autocomplete | `POST /places:autocomplete` | Body `input`; optional `includedPrimaryTypes`, `locationBias`/`locationRestriction`, `origin`, `sessionToken` | [doc](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete) |
| Photos | `GET /NAME/media?maxHeightPx=..&maxWidthPx=..` | `NAME` is `photos[].name` from a search or details response. One of the two size params is required (1 to 4800). `skipHttpRedirect=true` returns JSON with `photoUri` | [doc](https://developers.google.com/maps/documentation/places/web-service/place-photos) |

**Field mask.** Text Search, Nearby Search and Place Details have no default fields. Omit the mask and the call fails. Pass `X-Goog-FieldMask` (or `fields`/`$fields`). Search masks are prefixed `places.` (for example `places.id,places.displayName,places.location`); Details masks are not ([Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search), [Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details)).

**Auth.** API key in `X-Goog-Api-Key` (or `key=`), or OAuth 2.0 with scope `https://www.googleapis.com/auth/cloud-platform`, intended for a server-side service account ([OAuth](https://developers.google.com/maps/documentation/places/web-service/oauth-token)). Billing must be enabled on the project.

**Place types that fit.** All of these are in Table A, so they work as filters in Nearby Search and Text Search ([place types](https://developers.google.com/maps/documentation/places/web-service/place-types)):

| Need | Types |
|---|---|
| Parks and nature | `park`, `city_park`, `national_park`, `state_park`, `nature_preserve`, `hiking_area`, `garden`, `botanical_garden`, `woods`, `lake`, `river`, `beach`, `scenic_spot`, `picnic_ground` |
| Movement | `yoga_studio`, `gym`, `fitness_center`, `sports_club`, `swimming_pool`, `ice_skating_rink` |
| Wellness | `wellness_center`, `spa`, `sauna`, `public_bath`, `massage` |
| Social, quiet | `cafe`, `coffee_shop`, `tea_house`, `library`, `community_center`, `cultural_center`, `museum`, `art_gallery` |

There is no meditation, pilates or mental health type in the tables. Use Text Search ("meditation class near ...") for those.

**Pricing by field tier.** A request is billed at the highest tier among the fields in the mask ([SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details/places), [price list](https://developers.google.com/maps/billing-and-pricing/pricing)).

| Tier | Example fields (web service) | Free per month | Then per 1,000 |
|---|---|---|---|
| Text Search Essentials (IDs Only) | `places.id`, `places.name` (resource name), `nextPageToken` | Unlimited | free |
| Place Details Essentials (IDs Only) | `id`, `name`, `photos` | Unlimited | free |
| Place Details Essentials | `formattedAddress`, `location`, `types`, `viewport` | 10,000 | $5 |
| Text Search Pro / Nearby Search Pro | `displayName`, `formattedAddress`, `location`, `primaryType`, `types`, `photos`, `googleMapsUri`, `googleMapsLinks`, `businessStatus`, `accessibilityOptions` | 5,000 each | $32 |
| Place Details Pro | `displayName`, `primaryType`, `googleMapsUri`, `businessStatus` | 5,000 | $17 |
| Enterprise | `rating`, `userRatingCount`, `regularOpeningHours`, `currentOpeningHours`, `websiteUri`, phone numbers, `priceLevel` | 1,000 per SKU | $35 search, $20 details |
| Enterprise + Atmosphere | `reviews`, `editorialSummary`, `generativeSummary`, `reviewSummary`, `outdoorSeating`, `allowsDogs`, `goodForGroups`, `restroom` | 1,000 per SKU | $40 search, $25 details |
| Place Details Photos | each photo fetch | 1,000 | $7 |
| Autocomplete Requests | per request without a session | 10,000 | $2.83 |

Gotchas:

- Opening hours and rating push a search into Enterprise (1,000 free). Asking "is the park open now" through the `openNow` request filter is a parameter; I did not confirm whether it changes the SKU.
- Nearby Search has no IDs-only tier; its cheapest SKU is Pro.
- Autocomplete requests inside a session token are free (Autocomplete Session Usage) and the closing Place Details call is billed. Ending with an IDs-only details call bills every request as if there were no session; ending with an Essentials-only details call bills the first 12 requests ([session tokens](https://developers.google.com/maps/documentation/places/web-service/place-session-tokens), [SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details/places)).
- Place IDs may be stored indefinitely; refresh them when older than 12 months ([place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id)).

## 3. Weather, Air Quality, Pollen

### Weather API

Use: tell the agent whether a walk is sensible now or later today, and give clinicians daylight and weather context for mood trends.

Base URL: `https://weather.googleapis.com/v1`. All are `GET` with `location.latitude` and `location.longitude`. Common optional params: `unitsSystem` (metric default), `languageCode` ([overview](https://developers.google.com/maps/documentation/weather/overview)).

| Endpoint | Returns | Params | Source |
|---|---|---|---|
| `/currentConditions:lookup` | Condition and icon, temperature, feels-like, humidity, UV index, precipitation, wind, cloud cover, `isDaytime`, last-24h summary | location | [doc](https://developers.google.com/maps/documentation/weather/current-conditions) |
| `/forecast/hours:lookup` | Up to 240 hours | `hours` 1 to 240, `pageSize` 1 to 24, `pageToken` | [reference](https://developers.google.com/maps/documentation/weather/reference/rest/v1/forecast.hours/lookup) |
| `/forecast/days:lookup` | Up to 10 days, including sunrise and sunset (`sunEvents`) | `days`, `pageSize` (default 5), `pageToken` | [doc](https://developers.google.com/maps/documentation/weather/daily-forecast) |
| `/history/hours:lookup` | Past 24 hours only | `hours` 1 to 24, `pageSize`, `pageToken` | [reference](https://developers.google.com/maps/documentation/weather/reference/rest/v1/history.hours/lookup) |
| `/publicAlerts:lookup` | Severe weather alerts | location, `languageCode` | [doc](https://developers.google.com/maps/documentation/weather/weather-alerts) |

- **Finland:** covered for current, daily, hourly, history and alerts. Alerts come from the Finnish Meteorological Institute via MeteoAlarm in `fi-FI`, `sv-SE`, `en-GB` ([coverage](https://developers.google.com/maps/documentation/weather/coverage), [alerts](https://developers.google.com/maps/documentation/weather/weather-alerts)).
- **Status:** Preview on 8 April 2025, generally available since 30 June 2025; the alerts endpoint since 18 November 2025. A minute forecast endpoint exists and is Experimental ([release notes](https://developers.google.com/maps/documentation/weather/release-notes)).
- **Auth:** API key or OAuth token; billing required ([billing](https://developers.google.com/maps/documentation/weather/usage-and-billing)).
- **Price:** one SKU, "Weather Usage": 10,000 free per month, then $0.15 per 1,000 ([price list](https://developers.google.com/maps/billing-and-pricing/pricing)).
- **History is 24 hours.** For a clinician trend chart, the backend must store its own samples, and the terms cap that: current conditions and hourly forecast 1 hour, daily forecast 24 hours, today's forecast 30 days, hourly history 240 hours ([EEA service terms, section 23](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms)).
- EEA terms: the app must deliver value beyond the weather data, and public alert content must not be shown with any map (same section).
- AQI and particulates are not in the Weather API ([overview](https://developers.google.com/maps/documentation/weather/overview)).

### Air Quality API

Base URL: `https://airquality.googleapis.com/v1`.

| Endpoint | Returns | Source |
|---|---|---|
| `POST /currentConditions:lookup` | Current AQI and pollutants | [doc](https://developers.google.com/maps/documentation/air-quality/current-conditions) |
| `POST /forecast:lookup` | Hourly forecast up to 96 hours | [doc](https://developers.google.com/maps/documentation/air-quality/forecast) |
| `POST /history:lookup` | Hourly history up to 30 days | [doc](https://developers.google.com/maps/documentation/air-quality/history) |

Finland is covered; default local index `fin_hsy` ([coverage](https://developers.google.com/maps/documentation/air-quality/coverage)). Price: 10,000 free, then $5 per 1,000 ([price list](https://developers.google.com/maps/billing-and-pricing/pricing)).

**Terms problem:** the customer "may only use the Air Quality API for (a) air-quality based routing solutions ... and (b) Customer environmental risk indices and correlational research" ([EEA service terms, section 2](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms)). Correlating air quality with mood may fit (b); showing AQI as a general feature may not.

### Pollen API

`GET https://pollen.googleapis.com/v1/forecast:lookup` with `location.latitude`, `location.longitude`, `days` (up to 5), `languageCode`, `plantsDescription` ([doc](https://developers.google.com/maps/documentation/pollen/forecast)). Finland: grass, trees, weeds, including birch and alder ([coverage](https://developers.google.com/maps/documentation/pollen/coverage)). Price: Pro SKU, 5,000 free, then $10 per 1,000 ([price list](https://developers.google.com/maps/billing-and-pricing/pricing)). Permitted use is limited to pollen-based routing and "environmental risk indices, insights, and forecasts" ([EEA service terms, section 17](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms)).

## 4. Routes and Geocoding

### Routes API

Use: walking time and distance from the patient to a suggested park.

`POST https://routes.googleapis.com/directions/v2:computeRoutes` with `origin`, `destination`, `travelMode: "WALK"` ([doc](https://developers.google.com/maps/documentation/routes/compute_route_directions)). A field mask is required here too, for example `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline` ([choose fields](https://developers.google.com/maps/documentation/routes/choose_fields)).

- `WALK`, `BICYCLE` and `TWO_WHEELER` routes are in beta and may miss sidewalks or pedestrian paths. Google says you must show that warning to users for every walking route you display ([RouteTravelMode](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelMode)).
- Price: a plain request bills Compute Routes Essentials, 10,000 free then $5 per 1,000. Traffic-aware routing or 11+ waypoints moves to Pro ($10), two-wheeler to Enterprise ($15) ([SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details/routes), [price list](https://developers.google.com/maps/billing-and-pricing/pricing)).
- EEA terms: route description or steps may not be shown with any map. Show the line on a map or the steps as text, not both together ([Routes EEA guide](https://developers.google.com/maps/comms/eea/routes)).

### Geocoding

| Version | Reverse geocoding endpoint | Source |
|---|---|---|
| v4 | `GET https://geocode.googleapis.com/v4/geocode/location/LAT,LNG` (optional `types`, `granularity`, `X-Goog-FieldMask`) | [doc](https://developers.google.com/maps/documentation/geocoding/reverse-geocoding) |
| Older | `GET https://maps.googleapis.com/maps/api/geocode/json?latlng=LAT,LNG&key=..` and `?address=..` | [doc](https://developers.google.com/maps/documentation/geocoding/requests-reverse-geocoding), [start](https://developers.google.com/maps/documentation/geocoding/start) |

Use: turn device coordinates into "near Töölönlahti, Helsinki" for the agent prompt. Price: Geocoding SKU, 10,000 free then $5 per 1,000 ([price list](https://developers.google.com/maps/billing-and-pricing/pricing)). The terms allow storing lat/lng, formatted address and structured address indefinitely only for the user-facing feature that asked for it, isolated per user; otherwise lat/lng for 30 days ([EEA service terms, section 6](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms)). The device's own location services give coordinates for free; Google's key-security page recommends them over the Geolocation API ([security](https://developers.google.com/maps/api-security-best-practices)).

## 5. Maps on the client

| Platform | Official SDK | Coordinates and key classes | Map load price | Source |
|---|---|---|---|---|
| Android | Maps SDK for Android | `com.google.android.gms:play-services-maps` (docs show 20.1.0), `minSdk` 23 | Unlimited free (Maps SDK SKU) | [config](https://developers.google.com/maps/documentation/android-sdk/config) |
| Android, Compose | Maps Compose library | `com.google.maps.android:maps-compose` (README shows 9.0.1; pulls in the Maps SDK), API level 24+. `GoogleMap`, `Marker`, `Polyline`, `Circle` composables | same | [doc](https://developers.google.com/maps/documentation/android-sdk/maps-compose), [repo](https://github.com/googlemaps/android-maps-compose) |
| iOS | Maps SDK for iOS | Swift Package `https://github.com/googlemaps/ios-maps-sdk`, product `GoogleMaps` | Unlimited free | [config](https://developers.google.com/maps/documentation/ios-sdk/config) |
| Web | Maps JavaScript API | Loaded by script with an API key | Dynamic Maps: 10,000 free, then $7 per 1,000 | [overview](https://developers.google.com/maps/documentation/javascript/overview), [price list](https://developers.google.com/maps/billing-and-pricing/pricing) |

**Kotlin Multiplatform / Compose Multiplatform.** Google publishes no shared map component. Maps Compose describes itself as Jetpack Compose components for the Maps SDK for Android ([repo](https://github.com/googlemaps/android-maps-compose)). The practical shape:

- `commonMain`: `expect fun MapView(...)` plus shared place and route models.
- `androidMain`: `GoogleMap` from Maps Compose.
- `iosMain`: wrap a native map view in `UIKitView`. JetBrains documents this interop with an `MKMapView` example ([Kotlin docs](https://kotlinlang.org/docs/multiplatform/compose-uikit-integration.html)). Using `GMSMapView` instead needs the iOS SDK linked into the Kotlin framework; I did not find a primary source describing that setup.
- Web: Maps JavaScript API in the page. I did not find a JetBrains page for embedding HTML elements in Compose Multiplatform for web.

Cheaper option for a hackathon: skip the embedded map. Show a suggestion card and open `googleMapsUri` / `googleMapsLinks` from the Places response, which the EEA guide explicitly still allows ([Places EEA guide](https://developers.google.com/maps/comms/eea/places)).

**Places SDK for Android (New) vs REST from the backend.**

| | Places SDK for Android | REST from backend |
|---|---|---|
| Artifact | `com.google.android.libraries.places:places` (docs show 6.0.2), `minSdk` 23 ([config](https://developers.google.com/maps/documentation/places/android-sdk/config)) | none |
| Key | Android-restricted key in the app | Server key or service account, never shipped |
| KMP | Android only; iOS needs the separate Places SDK for iOS | One implementation for all clients |
| Agent access | App must forward results to the agent | Backend already holds the function-call loop |
| Billing | Same SKUs, by field ([SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details/places)) | Same |

Google's guidance: use a client SDK where one exists; otherwise call web services through an authenticated proxy server that builds the requests itself ([security](https://developers.google.com/maps/api-security-best-practices)). For a KMP app whose agent runs server-side, REST from the backend is less code.

**Places UI Kit** is a set of prebuilt Place Details, Place Search and Autocomplete components for Android, iOS and JavaScript ([Android overview](https://developers.google.com/maps/documentation/places/android-sdk/places-ui-kit-overview)). It may be used with or without any map, including a non-Google map, and is the route Google offers EEA customers for showing place content beside a map ([Places EEA guide](https://developers.google.com/maps/comms/eea/places)). Price: UI Kit Query 10,000 free then $1 per 1,000; Pro components 5,000 free then $5 ([price list](https://developers.google.com/maps/billing-and-pricing/pricing)). It is native UI per platform, so it also needs `expect`/`actual` wrappers.

## 6. Grounding with Google Maps (Gemini tool)

- **What it is:** a built-in Gemini API tool. Enable `{"type": "google_maps", "latitude": .., "longitude": ..}` and the model searches Maps itself. The response is text plus `place_citation` annotations carrying a name and a Google Maps URL ([doc](https://aistudio.google.com/docs/maps-grounding.md)).
- **Live sessions:** not supported on Gemini 3.8 Live, 3.8 Live Extended Thinking, 3.1 Flash Live Preview or 2.5 Flash Live Preview ([Live API tool use](https://aistudio.google.com/docs/live-api/tools.md)).
- **Models:** supported on the non-Live models listed on the page, from Gemini 2.5 through Gemini 4. Gemini 3 and 4 models can combine it with function calling ([doc](https://aistudio.google.com/docs/maps-grounding.md)).
- **Price:** Gemini 3 and newer: 5,000 free search queries a month shared across those models, then $14 per 1,000 queries; one prompt can trigger several queries. Gemini 2.5 and older: $25 per 1,000 grounded prompts (same page).
- **Limits stated on the page:** English prompts and responses only. The page says both "may not be available in all regions" and "globally available"; treat regional availability as unconfirmed.
- **Display rules:** sources must directly follow the generated text and be visible within one user interaction; each needs a link preview with the source name, the URL and the text "Google Maps" unmodified, untranslated (`translate="no"`) (same page).
- **Terms:** show results only to the user who asked; do not modify them or mix in other content; store only up to 90 days for display tuning or up to 6 months in that user's chat history; no training on the data ([Gemini API terms](https://ai.google.dev/gemini-api/terms)).

### Maps Experience agent tools

Formerly Maps Grounding Lite. Base `https://mapstools.googleapis.com`; MCP server at `https://mapstools.googleapis.com/mcp` (Streamable HTTP) ([overview](https://developers.google.com/maps/ai/maps-experience-agent-tools)).

| Tool | REST method | Returns |
|---|---|---|
| `search_places` | `POST /v1:searchText` (`textQuery`, `languageCode`, `regionCode`) | AI summary with citations, plus place IDs, coordinates and Google Maps links; up to 5 places (6 to 10 is Pro) |
| `lookup_weather` | `POST /v1:lookupWeather` | Current weather, 24h history, 10-day forecast; current and 4-day air quality. Pollen and 30-day AQ history are Pro |
| `compute_routes` | `POST /v1:computeRoutes` | Distance and duration for driving or walking; no step-by-step directions |
| `search_along_route` | `POST /v1:searchAlongRoute` | Places along a route; always Pro |
| `resolve_names`, `resolve_maps_urls` | `POST /v1:resolveNames`, `/v1:resolveMapsUrls` | Place IDs; free |

- Auth: `X-Goog-Api-Key`, or OAuth scope `https://www.googleapis.com/auth/maps-platform.mapstools`. Enable the `mapstools.googleapis.com` service.
- Price: Essentials 10,000 free then $7 per 1,000; Pro 5,000 free then $14 per 1,000. Quota 300 requests a minute per tool.
- The model you pair it with must not train on or store the content. Sources must follow the output, with a link built from `googleMapsLinks.placeUrl`.
- **Voice rule:** a voice app must show the sources in a companion screen holding a verbatim record of the conversation, tell users that answers may include Google Maps information, and keep a standing notice in settings ([attribution](https://developers.google.com/maps/ai/maps-experience-agent-tools/attribution)).
- Storage: grounded output may be kept 30 days for tuning, or up to 2 years in that user's chat history ([EEA service terms, section 11](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms)).

### Comparison for the voice agent

| | Grounding with Google Maps | Maps Experience agent tools via function calling | Places/Weather/Routes via function calling |
|---|---|---|---|
| Works in a Live session | No | Yes (your functions) | Yes (your functions) |
| Who runs the call | Gemini | Your backend | Your backend |
| Output | Prose plus citations | Summary plus IDs, coordinates, links | Structured fields you choose |
| Filter by type, radius, open now | No control | Text query only | Full control |
| Weather, air quality, pollen in the same service | No | Yes | Separate APIs |
| Free per month | 5,000 queries | 10,000 (Essentials) | Per SKU: 10,000 / 5,000 / 1,000 |
| After free | $14 per 1,000 | $7 per 1,000 | $32 per 1,000 for a Pro place search |
| EEA Places permitted-use list | Not a Places API call | Own section of the terms | Applies |

## 7. Keys, auth and terms

**Key restrictions** ([security best practices](https://developers.google.com/maps/api-security-best-practices)):

| Restriction | Use for |
|---|---|
| Android apps (package name plus SHA-1) | Maps SDK for Android, Places SDK for Android |
| iOS apps (bundle ID) | Maps SDK for iOS, Places SDK for iOS |
| Websites (HTTP referrer) | Maps JavaScript API on the clinician dashboard and web app |
| IP addresses | Backend key for web services, where the IP is stable |

Always add an API restriction as well, and use a separate key per app. Google suggests separate projects for client and server usage.

**What goes where:**

| Call | Where | Why |
|---|---|---|
| Map rendering | Client, restricted key | SDKs are built for it |
| Places, Weather, Air Quality, Pollen, Routes, Geocoding, Maps Experience agent tools | Backend | Google: web service keys "are not expected to be publicly exposed"; use an authenticated proxy that builds the requests |
| Gemini Live audio | Client with an ephemeral token, tools answered by the backend | See the Gemini research file; [ephemeral tokens](https://aistudio.google.com/docs/live-api/ephemeral-tokens.md) |

Server-side, Google recommends OAuth with a service account over API keys where supported. Direct mobile calls to web services are possible with `X-Android-Package`/`X-Android-Cert` or `X-Ios-Bundle-Identifier` headers and a matching restriction, but Google ranks that below a proxy. App Check is also offered to protect keys.

**Terms that matter:**

- No caching or storing of Maps content unless the service terms allow it; no scraping, pre-fetching or saving business names, addresses or reviews ([EEA terms](https://cloud.google.com/terms/maps-platform/eea), [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)).
- Place IDs: store indefinitely. Place lat/lng: up to 30 days ([Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)).
- For the clinician dashboard this means: store "suggested place ID X at time T", and re-fetch the name when displaying. Do not store names, addresses or ratings.
- No use of Maps content to train, test, validate or fine-tune ML models ([EEA terms](https://cloud.google.com/terms/maps-platform/eea)).
- The services may not be used "to transmit, store, or process health information subject to United States HIPAA regulations" (same page). Do not send clinical data in Maps requests.
- Attribution: content shown off a Google map needs the Google Maps logo or the text "Google Maps"; logo height 16 to 19 dp ([Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)).
- Non-EEA billing accounts: Places, Routes and Geocoding content may be used without a map but never with a non-Google map ([service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)). EEA accounts: that clause is removed, replaced by the "no use with any map" rules above ([EEA FAQ](https://developers.google.com/maps/comms/eea/faq)).

## 8. Free usage under current pricing

Free usage is per SKU per month: 10,000 for Essentials, 5,000 for Pro, 1,000 for Enterprise ([pricing overview](https://developers.google.com/maps/billing-and-pricing/overview)). These caps replaced the old monthly $200 credit ([March 2025 changes](https://developers.google.com/maps/billing-and-pricing/march-2025#free-usage-caps)). Billing must still be enabled.

| What we would call | SKU | Free per month | Then per 1,000 |
|---|---|---|---|
| Weather (any endpoint) | Weather Usage | 10,000 | $0.15 |
| Air quality | Air Quality Usage | 10,000 | $5 |
| Pollen | Pollen Usage | 5,000 | $10 |
| Walking route | Compute Routes Essentials | 10,000 | $5 |
| Reverse geocode | Geocoding | 10,000 | $5 |
| Place search with names | Text Search Pro, Nearby Search Pro | 5,000 each | $32 |
| Place search with hours or rating | Text/Nearby Search Enterprise | 1,000 each | $35 |
| Place photo | Place Details Photos | 1,000 | $7 |
| Places, weather, routes for the agent | Maps Grounding Essentials | 10,000 | $7 |
| Same, with Pro options | Maps Grounding Pro | 5,000 | $14 |
| Grounding with Google Maps | Gemini API | 5,000 queries | $14 |
| Mobile map | Maps SDK | Unlimited | free |
| Web map | Dynamic Maps | 10,000 | $7 |
| Places UI Kit card | Places UI Kit Query | 10,000 | $1 |

Source for every row except Grounding with Google Maps: [price list](https://developers.google.com/maps/billing-and-pricing/pricing).

**Maps Demo Key.** A no-cost key that needs no billing account, for prototyping only. It covers Maps JavaScript API, Places UI Kit, Places API (New) without user photos and reviews, Geocoding v4, Compute Routes, Weather API and Maps Grounding Lite. It requires a personal Google account; Workspace accounts are not eligible. It has daily limits and pauses rather than charges ([Maps Demo Key](https://developers.google.com/maps/demo-key)).

## Open questions

1. Which billing account will the Google Cloud project use: an EEA (Finnish) address, or not? This decides whether the Places permitted-use list and the "no use with any map" rules apply.
2. If EEA: do we accept showing place suggestions through Places UI Kit and Maps Experience agent tools, and avoid raw Places API content in our own UI?
3. Do we need an embedded map at all, or is a suggestion card with an "Open in Google Maps" link enough for the demo?
4. Voice agent tooling: Maps Experience agent tools wrapped as functions (simplest, one service), or separate Places, Weather and Routes functions (more control, higher place-search price)?
5. Are we willing to build the companion transcript screen with Google Maps source links that the voice attribution rule requires?
6. Is air quality in scope, given its narrow permitted use? Weather alone may be enough.
7. For the hackathon, is the Maps Demo Key acceptable, or do we want a billed project from day one?
8. Do clinicians need weather history beyond 24 hours? If so, which values may we retain within the caching limits, or do we use a different weather source for long-term trends?
9. Does the agent need to speak Finnish? Grounding with Google Maps is English only.

## Not verified

- Maps Demo Key daily quotas: the quota table did not render in the page I fetched.
- Whether a wellbeing activity suggestion fits any of the nine EEA Places permitted uses. This is a legal reading, not something the docs settle.
- Whether passing Places API results into Gemini as a function response is acceptable under the "no creating content" and ML clauses. The terms give an explicit allowance only for Maps Experience agent tools and Grounding with Google Maps.
- Whether the `openNow` request filter changes the billed SKU.
- Latest SDK versions. The numbers above are the ones printed in Google's setup pages and README today.
- Linking `GMSMapView` into a Compose Multiplatform iOS target, and HTML or map embedding in Compose Multiplatform for web: no primary source found.
- Regional availability of Grounding with Google Maps: the page contradicts itself.
- Grounding with Google Maps on Google's cloud agent platform and through Firebase: not checked.
- Geocoding v4 launch status (GA or preview) and its forward-geocoding endpoint path.
- App Check setup for Places SDK and Maps JavaScript API: page fetched, not read in detail.
- Maps Experience agent tools data quality in Finland, and the Finnish language quality of its summaries: not tested. No request in this file was executed against a live key.
- The Gemini model names on the Grounding page are copied from that page as fetched; I did not cross-check them against the models list.
