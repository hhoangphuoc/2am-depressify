// Suggest today: the model request, the tolerant parsers, and the handler with fakes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CallerAuth } from "../src/clinician";
import { MAX_PLACES, buildSuggestRequest, parseModelSuggestions, parsePlaces, type PlacesRequest } from "../src/suggest";
import { suggestTodayHandler, type SuggestStore } from "../src/suggestFunctions";
import { newPatientDoc, type PatientDoc, type Summary } from "../src/types";
import { CLINICIAN_EMAIL, FakeTextModel, PATIENT_ID, failingTextModel } from "./fakes";

// The Places text search recorded in the #6 spike.
const recorded = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "spike", "maps", "places-searchText.json"), "utf8"));
const KALLIO = { label: "An apartment by Karhupuisto, Kallio, Helsinki", latitude: 60.1842, longitude: 24.9531 };
const NOW = Date.UTC(2026, 10, 14, 13, 0); // Saturday 15:00 in Helsinki
const DEMO_ID = "demo-declining";
const demo: PatientDoc = {
  ...newPatientDoc("Mikko (demo)", CLINICIAN_EMAIL),
  synthetic: true,
  intakeHighlights: "Finds walks by the sea helpful, usually Tokoinranta. Listens to Bill Evans.",
  location: KALLIO,
};
const live: PatientDoc = newPatientDoc("Live patient", CLINICIAN_EMAIL);
const summary: Summary = {
  checkInId: "c1", createdAtMillis: NOW - 86_400_000, mood: 2, energy: 2, sleepQuality: 1, sleepLine: "Slept about 4 hours last night.",
  themes: ["broken sleep", "staying in"], voiceCues: [], suggestion: null, previousOutcome: null,
  quotes: ["I haven't been outside since Tuesday, I think."], sharedWithClinician: true,
};
const MODEL_JSON = JSON.stringify({
  suggestions: [
    { kind: "walk", details: "Walk down to Tokoinranta for ten minutes.", reason: "You said the water sets the day up.", placeQuery: "Tokoinranta", music: [] },
    { kind: "music", details: "Put on a record before bed.", reason: "Music has helped before.", placeQuery: null, music: [{ title: "Waltz for Debby", artist: "Bill Evans" }, { title: "No artist" }] },
    { kind: "dancing", details: "Not a kind of Suggestion.", reason: "", placeQuery: null, music: [] },
  ],
});

const store: SuggestStore = {
  getPatient: async (id) => ({ [DEMO_ID]: demo, [PATIENT_ID]: live })[id],
  recentSummaries: async () => [summary],
  recentDays: async () => [],
  recentSuggestions: async () => [],
};
const anyone: CallerAuth = { uid: "someone-else", token: {} };

function suggest(patientId: string, auth: CallerAuth | undefined, options: { textModel?: FakeTextModel; placesFail?: boolean } = {}) {
  const searches: PlacesRequest[] = [];
  const places = {
    searchText: async (request: PlacesRequest) => {
      searches.push(request);
      if (options.placesFail) throw Object.assign(new Error("denied"), { status: 403 });
      return recorded.response.body;
    },
  };
  const textModel = options.textModel ?? new FakeTextModel(MODEL_JSON);
  return { searches, textModel, result: suggestTodayHandler({ data: { patientId }, auth }, { store, textModel, places, clock: () => NOW }) };
}

describe("the request to the text model", () => {
  const request = buildSuggestRequest({ patient: demo, summaries: [summary], days: [], suggestions: [], nowMillis: NOW });

  it("keeps no copy at Gemini and asks for structured output", () => {
    expect(request.store).toBe(false);
    expect(request.response_format?.mime_type).toBe("application/json");
  });

  it("carries the Context, the time of day and the location's label", () => {
    expect(request.input).toContain("Saturday afternoon");
    expect(request.input).toContain(KALLIO.label);
    expect(request.input).toContain("Tokoinranta");
    expect(request.input).toContain("I haven't been outside since Tuesday");
  });

  it("carries no name, Clinician or coordinates", () => {
    for (const secret of [demo.displayName, CLINICIAN_EMAIL, String(KALLIO.latitude), String(KALLIO.longitude)]) {
      expect(request.input).not.toContain(secret);
    }
  });

  it("says so when the Patient has no location", () => {
    expect(buildSuggestRequest({ patient: live, summaries: [], days: [], suggestions: [], nowMillis: NOW }).input).toContain("No location is given.");
  });
});

describe("parsing", () => {
  it("keeps Suggestions of a known kind and music picks with a title and an artist", () => {
    const parsed = parseModelSuggestions("```json\n" + MODEL_JSON + "\n```");
    expect(parsed.map((s) => s.kind)).toEqual(["walk", "music"]);
    expect(parsed[1]!.music).toEqual([{ title: "Waltz for Debby", artist: "Bill Evans" }]);
  });

  it("gives no Suggestions for missing or malformed output", () => {
    for (const raw of [null, "", "not json", "[]", '{"suggestions": "none"}']) expect(parseModelSuggestions(raw)).toEqual([]);
  });

  it("reads the recorded Places response, and drops a place without an https Maps link", () => {
    const places = parsePlaces(recorded.response.body);
    expect(places).toHaveLength(MAX_PLACES);
    expect(places[0]).toMatchObject({ name: "Old Church Park", address: "Bulevardi, 00120 Helsinki", latitude: 60.16599289999999 });
    expect(places[0]!.mapsUrl).toMatch(/^https:\/\/maps\.google\.com\//);
    const [first] = recorded.response.body.places;
    expect(parsePlaces({ places: [{ ...first, googleMapsUri: "javascript:alert(1)" }] })).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
  });
});

describe("suggestToday", () => {
  it("gives anyone signed in a Demo Patient's Suggestions, with places near the Patient for the one that names somewhere", async () => {
    const { result, searches } = suggest(DEMO_ID, anyone);
    const response = await result;
    expect(response.location).toEqual(KALLIO);
    expect(response.suggestions.map((s) => [s.kind, s.places.length])).toEqual([["walk", MAX_PLACES], ["music", 0]]);
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({ textQuery: "Tokoinranta", locationBias: { circle: { center: { latitude: KALLIO.latitude, longitude: KALLIO.longitude } } } });
  });

  it("searches nowhere for a Patient without a location", async () => {
    const { result, searches } = suggest(PATIENT_ID, { uid: PATIENT_ID, token: {} });
    const response = await result;
    expect(response.location).toBeNull();
    expect(response.suggestions.map((s) => s.places)).toEqual([[], []]);
    expect(searches).toEqual([]);
  });

  it("still gives the Suggestions when the place search fails", async () => {
    const response = await suggest(DEMO_ID, anyone, { placesFail: true }).result;
    expect(response.suggestions.map((s) => [s.placeQuery, s.places])).toEqual([["Tokoinranta", []], [null, []]]);
  });

  it("refuses a signed-out caller and anyone else on a live Patient, before any model call", async () => {
    const signedOut = suggest(PATIENT_ID, undefined);
    await expect(signedOut.result).rejects.toMatchObject({ code: "unauthenticated" });
    const stranger = suggest(PATIENT_ID, anyone);
    await expect(stranger.result).rejects.toMatchObject({ code: "permission-denied" });
    expect([...signedOut.textModel.requests, ...stranger.textModel.requests]).toEqual([]);
  });

  it("is unavailable when the model fails or proposes nothing", async () => {
    await expect(suggest(DEMO_ID, anyone, { textModel: failingTextModel() }).result).rejects.toMatchObject({ code: "unavailable" });
    await expect(suggest(DEMO_ID, anyone, { textModel: new FakeTextModel("{}") }).result).rejects.toMatchObject({ code: "unavailable" });
  });
});
