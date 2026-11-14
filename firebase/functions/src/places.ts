// Find places (#18, the places part): the callable behind the Companion's `find_places` tool.
//
//   findPlaces  {patientId, query, latitude, longitude} -> {places: [{name, mapsUrl, distanceMeters}]}
//
// The phone sends where the Patient is only for this lookup; nothing is stored or logged. The Maps
// key is a function secret and never reaches the phone (ADR 0002).
// shortcut: direct Places API (New), the only Maps path enabled on the project; move to Maps agent
// tools (mapstools.googleapis.com) once enabled, whose terms explicitly allow grounding an LLM.
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { CheckInStore } from "./checkInFunctions";
import { patientIdOf } from "./intake";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall } from "./intakeFunctions";
import { assertActsAsPatient } from "./patientCaller";

/** The Maps key, a function secret. */
export const MAPS_API_KEY = defineSecret("MAPS_API_KEY");

export const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
/** The fields the #6 spike settled on. Names are shown and handed to the model, never stored. */
export const PLACES_FIELD_MASK = "places.id,places.displayName,places.googleMapsUri,places.location";
export const PLACES_QUERY_MAX_CHARS = 120;
export const PLACES_MAX_RESULTS = 5;
const PLACES_RADIUS_METERS = 3000;
const PLACES_TIMEOUT_MS = 10_000;

export interface FindPlacesRequest {
  patientId: string;
  query: string;
  latitude: number;
  longitude: number;
}

export interface NearbyPlace {
  name: string;
  mapsUrl: string;
  /** Straight-line distance from the location sent, in metres. Not a walking distance. */
  distanceMeters: number;
}

export interface PlacesClient {
  /** The response body of one Text Search. Throws with a `status` when the call fails. */
  searchText(body: unknown): Promise<unknown>;
}

function inRange(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

export function parseFindPlacesRequest(data: unknown): FindPlacesRequest {
  const patientId = patientIdOf(data);
  const { query, latitude, longitude } = (data ?? {}) as Record<string, unknown>;
  if (typeof query !== "string" || query.trim() === "" || query.length > PLACES_QUERY_MAX_CHARS) {
    throw new HttpsError("invalid-argument", "A query of at most " + PLACES_QUERY_MAX_CHARS + " characters is required.");
  }
  if (!inRange(latitude, 90) || !inRange(longitude, 180)) {
    throw new HttpsError("invalid-argument", "A location is required.");
  }
  return { patientId, query: query.trim(), latitude, longitude };
}

/** The Text Search body, the shape recorded in fixtures/spike/maps/places-searchText.json. */
export function buildPlacesSearch(request: Pick<FindPlacesRequest, "query" | "latitude" | "longitude">) {
  return {
    textQuery: request.query,
    languageCode: "en",
    pageSize: PLACES_MAX_RESULTS,
    locationBias: {
      circle: { center: { latitude: request.latitude, longitude: request.longitude }, radius: PLACES_RADIUS_METERS },
    },
  };
}

type LatLng = { latitude: number; longitude: number };

/** Great-circle distance in metres. */
function metersBetween(a: LatLng, b: LatLng): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** Up to five places, nearest first. A place without a name, a link or a location is dropped. */
export function parsePlaces(body: unknown, origin: LatLng): NearbyPlace[] {
  const places = (body as { places?: unknown } | null)?.places;
  if (!Array.isArray(places)) return [];
  return places
    .flatMap((place): NearbyPlace[] => {
      const name = place?.displayName?.text;
      const mapsUrl = place?.googleMapsUri;
      const location = place?.location;
      if (typeof name !== "string" || name === "" || typeof mapsUrl !== "string" || !mapsUrl.startsWith("https://")) return [];
      if (!inRange(location?.latitude, 90) || !inRange(location?.longitude, 180)) return [];
      return [{ name, mapsUrl, distanceMeters: metersBetween(origin, location) }];
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, PLACES_MAX_RESULTS);
}

/** The real client: one fetch, with the key in a header. Built per call so the secret is read at run time. */
export function fetchPlacesClient(apiKey: string, fetchImpl: typeof fetch = fetch): PlacesClient {
  // Refuse without a key, so the emulator (which has no secret) never sends a request to Maps.
  if (!apiKey) throw new Error("The Maps API key is not set.");
  return {
    async searchText(body) {
      const response = await fetchImpl(PLACES_URL, {
        method: "POST",
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACES_FIELD_MASK, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
      });
      // Never read the error body: it may quote the request.
      if (!response.ok) throw Object.assign(new Error("Places search failed"), { status: response.status });
      return response.json();
    },
  };
}

export interface FindPlacesDeps {
  store: Pick<CheckInStore, "getPatient">;
  places: PlacesClient;
}

/** Searches near the location sent. Reads the Patient only to check the caller; writes nothing. */
export async function findPlacesHandler(call: IntakeCall, deps: FindPlacesDeps): Promise<{ places: NearbyPlace[] }> {
  const auth = requireAuth(call.auth);
  const request = parseFindPlacesRequest(call.data);
  const ids = { patientId: request.patientId };
  let patient;
  try {
    patient = await deps.store.getPatient(request.patientId);
  } catch {
    logger.warn("findPlaces: a read failed", ids);
    throw new HttpsError("unavailable", "Could not reach your records. Try again.");
  }
  assertActsAsPatient(request.patientId, patient, auth);
  try {
    return { places: parsePlaces(await deps.places.searchText(buildPlacesSearch(request)), request) };
  } catch (error) {
    // Never log the error, the query or the location.
    logger.warn("findPlaces: the Places call failed", { ...ids, status: statusOf(error) });
    throw new HttpsError("unavailable", "Could not look up places. Try again.");
  }
}

/** Builds the callable. Production passes the Admin SDK and Places; tests pass fakes. */
export function createPlacesFunctions(deps: { store: () => FindPlacesDeps["store"]; places: () => PlacesClient }) {
  const findPlaces = onCall({ secrets: [MAPS_API_KEY], timeoutSeconds: 30 }, (request) =>
    safely("findPlaces", () =>
      findPlacesHandler(callerOf(request), {
        store: deps.store(),
        // Built only when Places is called, after the input and caller checks.
        places: { searchText: (body) => deps.places().searchText(body) },
      }),
    ),
  );
  return { findPlaces };
}
