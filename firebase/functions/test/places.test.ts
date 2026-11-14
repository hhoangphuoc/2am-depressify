// Find places: the request builder and parser against the #6 spike fixture, and the handler's caller rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlacesSearch, findPlacesHandler, parsePlaces, type PlacesClient } from "../src/places";
import { FakeCheckInStore, PATIENT_ID } from "./fakes";

const recorded = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "spike", "maps", "places-searchText.json"), "utf8"));
const HELSINKI = { latitude: 60.1699, longitude: 24.9384 };
const DATA = { patientId: PATIENT_ID, query: " park ", ...HELSINKI };

/** Returns `body`, or throws it when it is an Error, and records what was sent. */
function places(body: unknown = recorded.response.body) {
  const bodies: unknown[] = [];
  const client: PlacesClient = {
    async searchText(sent) {
      bodies.push(sent);
      if (body instanceof Error) throw body;
      return body;
    },
  };
  return { client, bodies };
}
const call = (data: unknown, uid: string | null = PATIENT_ID, fake = places()) =>
  findPlacesHandler({ data, auth: uid ? { uid, token: {} } : undefined }, { store: new FakeCheckInStore(), places: fake.client });

describe("findPlaces", () => {
  it("builds the Text Search the spike recorded, with a wider radius and no region", () => {
    const { regionCode: _, ...body } = recorded.request.body;
    body.locationBias.circle.radius = 3000;
    expect(buildPlacesSearch({ query: "park", ...HELSINKI })).toEqual(body);
  });

  it("returns up to five places with a name, a Maps link and a distance, nearest first", () => {
    const found = parsePlaces(recorded.response.body, HELSINKI);
    expect(found).toHaveLength(5);
    expect(found.every((p) => p.name !== "" && p.mapsUrl.startsWith("https://maps.google.com/"))).toBe(true);
    expect(found.map((p) => p.distanceMeters)).toEqual([...found.map((p) => p.distanceMeters)].sort((a, b) => a - b));
    // Old Church Park is about 450 m from the search centre.
    const oldChurchPark = found.find((p) => p.name === "Old Church Park")!;
    expect(oldChurchPark.distanceMeters).toBeGreaterThan(350);
    expect(oldChurchPark.distanceMeters).toBeLessThan(550);
    expect(parsePlaces({ places: [{ displayName: { text: "No link" } }] }, HELSINKI)).toEqual([]);
    expect(parsePlaces({}, HELSINKI)).toEqual([]);
  });

  it("serves the Patient with the trimmed query", async () => {
    const fake = places();
    expect((await call(DATA, PATIENT_ID, fake)).places).toHaveLength(5);
    expect(fake.bodies).toEqual([buildPlacesSearch({ query: "park", ...HELSINKI })]);
  });

  it("rejects signed-out callers, other users and bad input before calling Places", async () => {
    const fake = places();
    await expect(call(DATA, null, fake)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(call(DATA, "someone-else", fake)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(call({ ...DATA, query: "" }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call({ ...DATA, latitude: 91 }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call({ ...DATA, longitude: "24" }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(fake.bodies).toEqual([]);
  });

  it("turns a failed lookup into a named error without the query", async () => {
    const failure = call(DATA, PATIENT_ID, places(Object.assign(new Error("failed for park at 60.1699"), { status: 403 })));
    await expect(failure).rejects.toMatchObject({ code: "unavailable", message: "Could not look up places. Try again." });
  });
});
