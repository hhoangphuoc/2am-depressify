// The Suggest today callable, for the Patient (or anyone signed in on a Demo Patient):
//
//   suggestToday  {patientId} -> {location, suggestions: [{kind, details, reason, placeQuery, music, places}]}
//                 One call to the text model (storage off, structured output) with the Patient's
//                 Context, then one Places text search near the Patient's location for each
//                 Suggestion with a placeQuery. Reads only; writes nothing.
//
// The Context, the model's reply and the place results are never logged, including on error paths:
// log lines carry the Patient id and an HTTP status only.
import type { Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { readOrUnavailable } from "./checkInFunctions";
import { GEMINI_API_KEY, type TextModelClient } from "./gemini";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall } from "./intakeFunctions";
import { assertActsAsPatient } from "./patientCaller";
import {
  CONTEXT_DAYS,
  CONTEXT_SUGGESTIONS,
  CONTEXT_SUMMARIES,
  PLACES_FIELD_MASK,
  PLACES_SEARCH_URL,
  buildPlacesRequest,
  buildSuggestRequest,
  locationOf,
  parseModelSuggestions,
  parsePlaces,
  parseSuggestRequest,
  type PlacesRequest,
  type SuggestTodayResponse,
} from "./suggest";
import { COLLECTIONS, type DailyDoc, type PatientDoc, type Suggestion, type Summary } from "./types";

/** The Google Maps Platform key for Places API (New), a function secret. It never reaches a client. */
export { MAPS_API_KEY } from "./mapTool";
import { MAPS_API_KEY } from "./mapTool";

const PLACES_TIMEOUT_MS = 8_000;

/** What Suggest today reads. Every list is newest first. */
export interface SuggestStore {
  getPatient(patientId: string): Promise<Partial<PatientDoc> | undefined>;
  recentSummaries(patientId: string, count: number): Promise<Summary[]>;
  recentDays(patientId: string, count: number): Promise<DailyDoc[]>;
  recentSuggestions(patientId: string, count: number): Promise<Suggestion[]>;
}

export interface PlacesClient {
  /** The response body of one text search. Throws on failure, with at most a numeric `status`. */
  searchText(request: PlacesRequest): Promise<unknown>;
}

export interface SuggestTodayDeps {
  store: SuggestStore;
  textModel: TextModelClient;
  places: PlacesClient;
  clock?: () => number;
}

export function adminSuggestStore(db: Firestore): SuggestStore {
  const patientRef = (patientId: string) => db.collection(COLLECTIONS.patients).doc(patientId);
  const newest = async <T>(patientId: string, collection: string, orderBy: string, count: number) =>
    (await patientRef(patientId).collection(collection).orderBy(orderBy, "desc").limit(count).get()).docs.map((doc) => doc.data() as T);
  return {
    async getPatient(patientId) {
      const snapshot = await patientRef(patientId).get();
      return snapshot.exists ? (snapshot.data() as Partial<PatientDoc>) : undefined;
    },
    recentSummaries: (patientId, count) => newest<Summary>(patientId, COLLECTIONS.summaries, "createdAtMillis", count),
    recentDays: (patientId, count) => newest<DailyDoc>(patientId, COLLECTIONS.daily, "date", count),
    recentSuggestions: (patientId, count) => newest<Suggestion>(patientId, COLLECTIONS.suggestions, "suggestedAtMillis", count),
  };
}

/** The real client: one `fetch` per search, with the key in the header (never in the URL). */
export function fetchPlacesClient(apiKey: string, fetchImpl: typeof fetch = fetch): PlacesClient {
  // Refuse without a key, so the emulator (which has no secret) never sends a request to Google.
  if (!apiKey) throw new Error("The Maps API key is not set.");
  return {
    async searchText(request) {
      const response = await fetchImpl(PLACES_SEARCH_URL, {
        method: "POST",
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACES_FIELD_MASK, "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
      });
      if (!response.ok) throw Object.assign(new Error("The place search failed."), { status: response.status });
      return response.json();
    },
  };
}

/** Asks the model for today's Suggestions and finds the places they name. */
export async function suggestTodayHandler(call: IntakeCall, deps: SuggestTodayDeps): Promise<SuggestTodayResponse> {
  const auth = requireAuth(call.auth);
  const { patientId } = parseSuggestRequest(call.data);
  const patient = await readOrUnavailable("suggestToday", { patientId }, () => deps.store.getPatient(patientId));
  assertActsAsPatient(patientId, patient, auth);
  const [summaries, days, suggestions] = await readOrUnavailable("suggestToday", { patientId }, () =>
    Promise.all([
      deps.store.recentSummaries(patientId, CONTEXT_SUMMARIES),
      deps.store.recentDays(patientId, CONTEXT_DAYS),
      deps.store.recentSuggestions(patientId, CONTEXT_SUGGESTIONS),
    ]),
  );

  let output: string | null;
  try {
    output = await deps.textModel.generateText(buildSuggestRequest({ patient, summaries, days, suggestions, nowMillis: (deps.clock ?? Date.now)() }));
  } catch (error) {
    // Never log the error itself: its message or body may echo the Context.
    logger.warn("suggestToday: the text model call failed", { patientId, status: statusOf(error) });
    throw new HttpsError("unavailable", "Could not make Suggestions. Try again.");
  }
  const proposed = parseModelSuggestions(output);
  if (proposed.length === 0) {
    logger.warn("suggestToday: the text model returned no Suggestions", { patientId });
    throw new HttpsError("unavailable", "Could not make Suggestions. Try again.");
  }

  const location = locationOf(patient);
  // shortcut: every call asks the model and Places again (Text Search is billed per call); keep the day's answer per Patient before this serves more than a demo.
  return {
    location,
    suggestions: await Promise.all(
      proposed.map(async (suggestion) => {
        if (location === null || suggestion.placeQuery === null) return { ...suggestion, places: [] };
        try {
          return { ...suggestion, places: parsePlaces(await deps.places.searchText(buildPlacesRequest(suggestion.placeQuery, location))) };
        } catch (error) {
          // A Suggestion without places is still a Suggestion: the phone links to a Maps search instead.
          logger.warn("suggestToday: a place search failed", { patientId, status: statusOf(error) });
          return { ...suggestion, places: [] };
        }
      }),
    ),
  };
}

export interface SuggestDepsFactory {
  store: () => SuggestStore;
  textModel: () => TextModelClient;
  places: () => PlacesClient;
}

/** Builds the callable. Production passes the Admin SDK, Gemini and Places; tests pass fakes. */
export function createSuggestFunctions(deps: SuggestDepsFactory) {
  const suggestToday = onCall({ secrets: [GEMINI_API_KEY, MAPS_API_KEY], timeoutSeconds: 60 }, (request) =>
    safely("suggestToday", () =>
      suggestTodayHandler(callerOf(request), {
        store: deps.store(),
        // Built only when called, after the input and caller checks.
        textModel: { generateText: (textRequest) => deps.textModel().generateText(textRequest) },
        places: { searchText: (placesRequest) => deps.places().searchText(placesRequest) },
      }),
    ),
  );
  return { suggestToday };
}
