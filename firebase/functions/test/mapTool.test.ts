// The Map tool: request builders and parsers against the recorded Maps agent tools fixtures, and the handler's caller rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlacesSearch,
  buildWalkingRoute,
  buildWeatherLookup,
  mapToolHandler,
  parsePlaces,
  parseWalkMinutes,
  parseWeather,
  type MapsClient,
  type MapsMethod,
} from "../src/mapTool";
import { FakeCheckInStore, PATIENT_ID } from "./fakes";

const fixture = (method: MapsMethod) =>
  JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "spike", "maps", "mapstools-" + method + ".json"), "utf8"));
const SEARCH = fixture("searchText");
const WEATHER = fixture("lookupWeather");
const ROUTE = fixture("computeRoutes");
/** The sample location the fixtures were recorded from (Otaniemi). */
const HERE = { latitude: 60.185, longitude: 24.8324 };
const PLACES = { patientId: PATIENT_ID, tool: "find_places", query: " yoga studio ", ...HERE };

/** Answers each method from the fixtures (or `override`; an Error is thrown) and records the calls. */
function maps(override: Partial<Record<MapsMethod, unknown>> = {}) {
  const calls: { method: MapsMethod; body: unknown }[] = [];
  const bodies: Record<MapsMethod, unknown> = { searchText: SEARCH.response.body, lookupWeather: WEATHER.response.body, computeRoutes: ROUTE.response.body, ...override };
  const client: MapsClient = {
    async call(method, body) {
      calls.push({ method, body });
      if (bodies[method] instanceof Error) throw bodies[method];
      return bodies[method];
    },
  };
  return { client, calls };
}
const call = (data: unknown, uid: string | null = PATIENT_ID, fake = maps()) =>
  mapToolHandler({ data, auth: uid ? { uid, token: {} } : undefined }, { store: new FakeCheckInStore(), maps: fake.client });

describe("mapTool", () => {
  it("builds the three requests that were recorded", () => {
    expect(buildPlacesSearch("yoga studio", HERE)).toEqual(SEARCH.request.body);
    expect(buildWeatherLookup(HERE)).toEqual(WEATHER.request.body);
    expect(buildWalkingRoute(HERE, { latitude: 60.1878332, longitude: 24.8039369 })).toEqual(ROUTE.request.body);
  });

  it("returns places with a name, the Maps place link and a distance, nearest first", () => {
    const found = parsePlaces(SEARCH.response.body, HERE);
    expect(found.map((p) => p.name)).toEqual(["WellStudio", "Flowel yoga", "Yoga Nordic Espoo", "Gentle Yoga Studio", "Purna Yoga Helsinki"]);
    expect(found.every((p) => p.mapsUrl.startsWith("https://www.google.com/maps/place/"))).toBe(true);
    expect(found[1].distanceMeters).toBeGreaterThan(1500);
    expect(found[1].distanceMeters).toBeLessThan(1700);
    expect(parsePlaces({ places: [{ attribution: { title: "No link - Google Maps" } }] }, HERE)).toEqual([]);
    expect(parsePlaces({}, HERE)).toEqual([]);
  });

  it("drops places too far to be nearby", () => {
    // From Tallinn every recorded place is about 85 km away.
    expect(parsePlaces(SEARCH.response.body, { latitude: 59.437, longitude: 24.7536 })).toEqual([]);
  });

  it("reads walking minutes and the weather", () => {
    expect(parseWalkMinutes(ROUTE.response.body)).toBe(28);
    expect(parseWalkMinutes({ routes: [] })).toBeNull();
    expect(parseWeather(WEATHER.response.body)).toEqual({
      conditions: "Cloudy",
      temperatureC: 3,
      feelsLikeC: -3,
      precipitationPercent: 10,
      windKmh: 26,
      goodForAWalk: true,
      sourceTitle: "Weather for Espoo, Suomi - Google",
      sourceUrl: "https://www.google.com/search?q=Weather+for+Espoo%2C%20Suomi",
    });
    const rainy = structuredClone(WEATHER.response.body);
    rainy.weather.precipitation.probability.percent = 80;
    expect(parseWeather(rainy)?.goodForAWalk).toBe(false);
    expect(parseWeather({})).toBeNull();
  });

  it("finds places with a walking time each, and leaves it null when the route fails", async () => {
    const fake = maps();
    const result = await call(PLACES, PATIENT_ID, fake);
    expect(result).toMatchObject({ places: [{ name: "WellStudio", walkMinutes: 28 }, {}, {}, {}, {}] });
    expect(fake.calls[0]).toEqual({ method: "searchText", body: buildPlacesSearch("yoga studio", HERE) });
    expect(fake.calls.filter((c) => c.method === "computeRoutes")).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain("location");

    const noRoutes = await call(PLACES, PATIENT_ID, maps({ computeRoutes: new Error("routes down") }));
    expect(noRoutes).toMatchObject({ places: [{ name: "WellStudio", walkMinutes: null }, {}, {}, {}, {}] });
  });

  it("looks up the weather", async () => {
    const fake = maps();
    expect(await call({ patientId: PATIENT_ID, tool: "get_weather", ...HERE }, PATIENT_ID, fake)).toMatchObject({ weather: { conditions: "Cloudy" } });
    expect(fake.calls).toEqual([{ method: "lookupWeather", body: buildWeatherLookup(HERE) }]);
  });

  it("rejects signed-out callers, other users, unknown tools and bad input before calling Maps", async () => {
    const fake = maps();
    await expect(call(PLACES, null, fake)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(call(PLACES, "someone-else", fake)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(call({ ...PLACES, tool: "compute_routes" }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call({ ...PLACES, query: "" }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call({ ...PLACES, latitude: 91 }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call({ ...PLACES, longitude: "24" }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(fake.calls).toEqual([]);
  });

  it("turns a failed lookup into a named error without the query", async () => {
    const failed = Object.assign(new Error("failed for yoga studio at 60.185"), { status: 403 });
    const message = "Could not look that up. Try again.";
    await expect(call(PLACES, PATIENT_ID, maps({ searchText: failed }))).rejects.toMatchObject({ code: "unavailable", message });
    await expect(call({ ...PLACES, tool: "get_weather" }, PATIENT_ID, maps({ lookupWeather: {} }))).rejects.toMatchObject({ code: "unavailable", message });
  });
});
