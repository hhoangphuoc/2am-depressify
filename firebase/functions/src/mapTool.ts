// The Map tool (#18): one callable behind the Companion's find_places and get_weather tools.
//
//   mapTool  {patientId, tool: "find_places", query, latitude, longitude}
//              -> {places: [{name, mapsUrl, distanceMeters, walkMinutes}]}
//            {patientId, tool: "get_weather", latitude, longitude}
//              -> {weather: {conditions, temperatureC, feelsLikeC, precipitationPercent, windKmh,
//                            goodForAWalk, sourceTitle, sourceUrl}}
//
// It calls Maps agent tools (mapstools.googleapis.com), whose terms allow handing the output to the
// model. The phone sends where the Patient is only for the lookup; nothing is stored or logged. The
// Maps key is a function secret and never reaches the phone (ADR 0002). The request and response
// shapes are the ones recorded in fixtures/spike/maps/mapstools-*.json.
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { CheckInStore } from "./checkInFunctions";
import { patientIdOf } from "./intake";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall } from "./intakeFunctions";
import { assertActsAsPatient } from "./patientCaller";

/** The Maps key, a function secret. */
export const MAPS_API_KEY = defineSecret("MAPS_API_KEY");

export const MAP_TOOLS = ["find_places", "get_weather"] as const;
export type MapTool = (typeof MAP_TOOLS)[number];
export type MapsMethod = "searchText" | "lookupWeather" | "computeRoutes";

export const MAPS_URL = "https://mapstools.googleapis.com/v1:";
export const PLACES_QUERY_MAX_CHARS = 120;
export const PLACES_MAX_RESULTS = 5;
const PLACES_BIAS_RADIUS_METERS = 3000;
/** The location bias is weak (a clinic search from Espoo returned one in Tallinn), so far places are dropped. */
export const PLACES_MAX_DISTANCE_METERS = 10_000;
const MAPS_TIMEOUT_MS = 10_000;

type LatLng = { latitude: number; longitude: number };

export interface MapToolRequest extends LatLng {
  patientId: string;
  tool: MapTool;
  /** Set for find_places only. */
  query: string | null;
}

export interface NearbyPlace {
  name: string;
  mapsUrl: string;
  /** Straight-line distance from the location sent, in metres. */
  distanceMeters: number;
  /** Minutes on foot, or null when the route lookup failed. */
  walkMinutes: number | null;
}

export interface Weather {
  conditions: string;
  temperatureC: number;
  feelsLikeC: number;
  precipitationPercent: number;
  windKmh: number;
  goodForAWalk: boolean;
  /** The Google source to show beside the weather. */
  sourceTitle: string;
  sourceUrl: string;
}

export type MapToolResponse = { places: NearbyPlace[] } | { weather: Weather };

export interface MapsClient {
  /** The response body of one Maps agent tools call. Throws with a `status` when it fails. */
  call(method: MapsMethod, body: unknown): Promise<unknown>;
}

function inRange(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

export function parseMapToolRequest(data: unknown): MapToolRequest {
  const patientId = patientIdOf(data);
  const { tool, query, latitude, longitude } = (data ?? {}) as Record<string, unknown>;
  if (!MAP_TOOLS.includes(tool as MapTool)) throw new HttpsError("invalid-argument", "Unknown tool.");
  if (!inRange(latitude, 90) || !inRange(longitude, 180)) {
    throw new HttpsError("invalid-argument", "A location is required.");
  }
  if (tool !== "find_places") return { patientId, tool: tool as MapTool, query: null, latitude, longitude };
  if (typeof query !== "string" || query.trim() === "" || query.length > PLACES_QUERY_MAX_CHARS) {
    throw new HttpsError("invalid-argument", "A query of at most " + PLACES_QUERY_MAX_CHARS + " characters is required.");
  }
  return { patientId, tool, query: query.trim(), latitude, longitude };
}

const latLng = ({ latitude, longitude }: LatLng) => ({ latLng: { latitude, longitude } });

export function buildPlacesSearch(query: string, near: LatLng) {
  return {
    textQuery: query,
    languageCode: "en",
    locationBias: { circle: { center: { latitude: near.latitude, longitude: near.longitude }, radiusMeters: PLACES_BIAS_RADIUS_METERS } },
  };
}

export function buildWeatherLookup(near: LatLng) {
  return { location: latLng(near), languageCode: "en", capabilities: ["WEATHER"] };
}

export function buildWalkingRoute(from: LatLng, to: LatLng) {
  return { origin: latLng(from), destination: latLng(to), travelMode: "WALK" };
}

/** Great-circle distance in metres. */
function metersBetween(a: LatLng, b: LatLng): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/**
 * Up to five places within PLACES_MAX_DISTANCE_METERS, nearest first, each with its location for
 * the route lookup. The name is the attribution title; the link is `googleMapsLinks.placeUrl`, as
 * the Maps terms require. A place without a name, a link or a location is dropped.
 */
export function parsePlaces(body: unknown, origin: LatLng): (Omit<NearbyPlace, "walkMinutes"> & { location: LatLng })[] {
  const places = (body as { places?: unknown } | null)?.places;
  if (!Array.isArray(places)) return [];
  return places
    .flatMap((place) => {
      const title = place?.attribution?.title;
      const mapsUrl = place?.googleMapsLinks?.placeUrl;
      const location = place?.location;
      if (typeof title !== "string" || typeof mapsUrl !== "string" || !mapsUrl.startsWith("https://")) return [];
      if (!inRange(location?.latitude, 90) || !inRange(location?.longitude, 180)) return [];
      const name = title.replace(/ - Google Maps$/, "").trim();
      const distanceMeters = metersBetween(origin, location);
      if (name === "" || distanceMeters > PLACES_MAX_DISTANCE_METERS) return [];
      return [{ name, mapsUrl, distanceMeters, location: { latitude: location.latitude, longitude: location.longitude } }];
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, PLACES_MAX_RESULTS);
}

/** Minutes on foot from the first route's `duration` ("501s"), or null. */
export function parseWalkMinutes(body: unknown): number | null {
  const duration = (body as { routes?: { duration?: unknown }[] } | null)?.routes?.[0]?.duration;
  const seconds = typeof duration === "string" && /^\d+s$/.test(duration) ? Number.parseInt(duration, 10) : null;
  return seconds === null ? null : Math.ceil(seconds / 60);
}

/** The current weather trimmed for the model and the card, or null when the body lacks it. */
export function parseWeather(body: unknown): Weather | null {
  const w = (body as { weather?: Record<string, any> } | null)?.weather;
  const conditions = w?.weatherCondition?.description?.text;
  const numbers = [w?.temperature?.degrees, w?.feelsLikeTemperature?.degrees, w?.precipitation?.probability?.percent, w?.wind?.speed?.value];
  const sourceTitle = w?.attribution?.title;
  const sourceUrl = w?.attribution?.url;
  if (typeof conditions !== "string" || conditions === "" || !numbers.every((n) => inRange(n, 1000))) return null;
  if (typeof sourceTitle !== "string" || typeof sourceUrl !== "string" || !sourceUrl.startsWith("https://")) return null;
  if (w?.temperature?.unit !== "CELSIUS" || w?.wind?.speed?.unit !== "KILOMETERS_PER_HOUR") return null;
  const [temperatureC, feelsLikeC, precipitationPercent, windKmh] = numbers.map(Math.round);
  const storm = inRange(w?.thunderstormProbability, 100) ? w.thunderstormProbability : 0;
  return {
    conditions,
    temperatureC,
    feelsLikeC,
    precipitationPercent,
    windKmh,
    // A plain rule: mostly dry, not stormy, not a gale, and neither bitterly cold nor hot.
    goodForAWalk: precipitationPercent < 50 && storm < 20 && windKmh < 40 && feelsLikeC > -15 && feelsLikeC < 30,
    sourceTitle,
    sourceUrl,
  };
}

/** The real client: one fetch per call, with the key in a header. Built per call so the secret is read at run time. */
export function fetchMapsClient(apiKey: string, fetchImpl: typeof fetch = fetch): MapsClient {
  // Refuse without a key, so the emulator (which has no secret) never sends a request to Maps.
  if (!apiKey) throw new Error("The Maps API key is not set.");
  return {
    async call(method, body) {
      const response = await fetchImpl(MAPS_URL + method, {
        method: "POST",
        headers: { "X-Goog-Api-Key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MAPS_TIMEOUT_MS),
      });
      // Never read the error body: it may quote the request.
      if (!response.ok) throw Object.assign(new Error("Maps call failed"), { status: response.status });
      return response.json();
    },
  };
}

export interface MapToolDeps {
  store: Pick<CheckInStore, "getPatient">;
  maps: MapsClient;
}

/** Runs one map tool near the location sent. Reads the Patient only to check the caller; writes nothing. */
export async function mapToolHandler(call: IntakeCall, deps: MapToolDeps): Promise<MapToolResponse> {
  const auth = requireAuth(call.auth);
  const request = parseMapToolRequest(call.data);
  const ids = { patientId: request.patientId, tool: request.tool };
  let patient;
  try {
    patient = await deps.store.getPatient(request.patientId);
  } catch {
    logger.warn("mapTool: a read failed", ids);
    throw new HttpsError("unavailable", "Could not reach your records. Try again.");
  }
  assertActsAsPatient(request.patientId, patient, auth);
  try {
    if (request.query === null) {
      const weather = parseWeather(await deps.maps.call("lookupWeather", buildWeatherLookup(request)));
      if (!weather) throw new Error("no weather in the response");
      return { weather };
    }
    const found = parsePlaces(await deps.maps.call("searchText", buildPlacesSearch(request.query, request)), request);
    const places = await Promise.all(
      found.map(async ({ location, ...place }) => ({
        ...place,
        // A failed route leaves the place without a walking time.
        walkMinutes: await deps.maps.call("computeRoutes", buildWalkingRoute(request, location)).then(parseWalkMinutes, () => null),
      })),
    );
    return { places };
  } catch (error) {
    // Never log the error, the query or the location.
    logger.warn("mapTool: the Maps call failed", { ...ids, status: statusOf(error) });
    throw new HttpsError("unavailable", "Could not look that up. Try again.");
  }
}

/** Builds the callable. Production passes the Admin SDK and Maps; tests pass fakes. */
export function createMapToolFunctions(deps: { store: () => MapToolDeps["store"]; maps: () => MapsClient }) {
  const mapTool = onCall({ secrets: [MAPS_API_KEY], timeoutSeconds: 30 }, (request) =>
    safely("mapTool", () =>
      mapToolHandler(callerOf(request), {
        store: deps.store(),
        // Built only when Maps is called, after the input and caller checks.
        maps: { call: (method, body) => deps.maps().call(method, body) },
      }),
    ),
  );
  return { mapTool };
}
