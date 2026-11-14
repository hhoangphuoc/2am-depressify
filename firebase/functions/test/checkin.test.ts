// Finish Check-in's pure parts: input validation and caps, the structured-output request against
// the shape recorded in the #6 spike, parsing the model's reply (including malformed replies), the
// Summary content and the documents a finish writes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_QUOTE_CHARS,
  MAX_TRANSCRIPT_CHARS,
  MAX_TURN_CHARS,
  MAX_VOICE_CUES,
  SUMMARY_SCHEMA,
  buildSummaryRequest,
  finishWrites,
  isPatientQuote,
  newCheckIn,
  parseFinishRequest,
  parseModelSummary,
  summaryContent,
  summarySuggestion,
  transcriptText,
  type CheckInDraft,
  type FinishContent,
  type ModelSummary,
} from "../src/checkIn";
import { TEXT_MODEL } from "../src/models";
import { newPatientDoc, type PatientDoc } from "../src/types";

const SPIKE = join(__dirname, "..", "..", "..", "fixtures", "spike", "interactions");
const recorded = JSON.parse(readFileSync(join(SPIKE, "finish-checkin-structured-v1.json"), "utf8"));
const recordedOutput: string = recorded.response.body.steps.find((s: { type: string }) => s.type === "model_output").content[0].text;

/** The spike's fictional Check-in, as the phone's draft. */
const DRAFT: CheckInDraft = {
  turns: [
    { speaker: "companion", text: "Hi Alex, it's good to hear from you. Did you get a chance to try the walk by the harbour?" },
    { speaker: "patient", text: "Yeah, I went on Saturday. Only twenty minutes, but it was nice to see the water. I felt a bit lighter after." },
    { speaker: "companion", text: "That sounds lovely. How did you sleep last night?" },
    { speaker: "patient", text: "Not great. I woke up around four and couldn't get back to sleep. I'm pretty tired today." },
    { speaker: "patient", text: "Low. Work has been a lot this week, lots of deadlines." },
    { speaker: "patient", text: "Mood maybe a three. Energy a two. Sleep a two as well." },
  ],
  voiceCues: [{ label: "tired voice", intensity: 3, heard: "slow, quiet answers" }],
  suggestions: [],
  crisis: false,
};

const ALL: { ratings: boolean; voiceCues: boolean } = { ratings: true, voiceCues: true };

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const valid = { patientId: "p1", checkInId: "c1", draft: DRAFT, todayLines: ["Sleep was shorter than usual."], lastSuggestionId: "s1" };

describe("parseFinishRequest", () => {
  it("accepts a full request", () => {
    expect(parseFinishRequest(valid)).toEqual(valid);
  });

  it("defaults the optional parts: no Signal lines, no last Suggestion, no crisis", () => {
    expect(parseFinishRequest({ patientId: "p1", checkInId: "c1", draft: {} })).toEqual({
      patientId: "p1",
      checkInId: "c1",
      draft: { turns: [], voiceCues: [], suggestions: [], crisis: false },
      todayLines: [],
      lastSuggestionId: null,
    });
  });

  it("refuses bad ids and a missing or mis-shaped draft", () => {
    for (const data of [
      { ...valid, patientId: "" },
      { ...valid, checkInId: "" },
      { ...valid, checkInId: "a/b" },
      { ...valid, checkInId: "x".repeat(129) },
      { ...valid, checkInId: 7 },
      { ...valid, draft: null },
      { ...valid, draft: [] },
      { ...valid, draft: { turns: "Patient: hello" } },
      { ...valid, draft: { crisis: "yes" } },
      { ...valid, todayLines: "Sleep was short." },
      { ...valid, lastSuggestionId: "a/b" },
      { ...valid, lastSuggestionId: 3 },
    ]) {
      expect(codeOf(() => parseFinishRequest(data))).toBe("invalid-argument");
    }
  });

  it("drops malformed items instead of failing the finish, and cuts long text", () => {
    const parsed = parseFinishRequest({
      ...valid,
      draft: {
        turns: [
          { speaker: "patient", text: "x".repeat(MAX_TURN_CHARS + 50) },
          { speaker: "narrator", text: "dropped" },
          { speaker: "patient", text: "   " },
          { speaker: "companion" },
          "not a turn",
        ],
        voiceCues: [
          { label: "flat tone", intensity: 6, heard: "out of range" },
          { label: "flat tone", intensity: 2.5, heard: "not an integer" },
          { label: "", intensity: 2, heard: "no label" },
          { label: "flat tone", intensity: 2, heard: "kept" },
        ],
        suggestions: [{ details: "" }, { kind: "walk", details: "A short walk at noon", status: "accepted", id: "s9" }, { details: "Some music", kind: "disco", status: "maybe" }],
        crisis: true,
      },
    });
    expect(parsed.draft.turns).toEqual([{ speaker: "patient", text: "x".repeat(MAX_TURN_CHARS) }]);
    expect(parsed.draft.voiceCues).toEqual([{ label: "flat tone", intensity: 2, heard: "kept" }]);
    expect(parsed.draft.suggestions).toEqual([
      { id: "s9", kind: "walk", details: "A short walk at noon", status: "accepted" },
      { id: null, kind: null, details: "Some music", status: "proposed" },
    ]);
    expect(parsed.draft.crisis).toBe(true);
  });

  it("caps the lists", () => {
    const cue = { label: "flat tone", intensity: 2, heard: "short answers" };
    const parsed = parseFinishRequest({ ...valid, draft: { voiceCues: Array(MAX_VOICE_CUES + 5).fill(cue) }, todayLines: Array(40).fill("Steps were usual.") });
    expect(parsed.draft.voiceCues).toHaveLength(MAX_VOICE_CUES);
    expect(parsed.todayLines).toHaveLength(12);
  });

  it("never echoes the transcript in an error", () => {
    try {
      parseFinishRequest({ ...valid, checkInId: "", draft: { turns: [{ speaker: "patient", text: "Quillon-7743" }] } });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("Quillon");
    }
  });
});

describe("the structured-output request", () => {
  const request = buildSummaryRequest(DRAFT, ["Sleep was shorter than usual."], "A short walk by the harbour");

  it("uses the text model with storage off", () => {
    expect(request.model).toBe(TEXT_MODEL);
    expect(request.store).toBe(false);
  });

  it("has the recorded response_format shape, with the recorded schema's fields", () => {
    const recordedFormat = recorded.request.body.response_format;
    expect(request.response_format?.type).toBe(recordedFormat.type);
    expect(request.response_format?.mime_type).toBe(recordedFormat.mime_type);
    const schema = request.response_format!.schema as typeof recordedFormat.schema;
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(recordedFormat.schema.properties).sort());
    expect([...schema.required].sort()).toEqual([...recordedFormat.schema.required].sort());
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.quotes.maxItems).toBe(3);
    // #20: the few quotes are the ones that explain a concern, when there is one.
    expect(request.system_instruction).toMatch(/quotes[^\n]*concern/i);
    expect(schema.properties.mood.type).toEqual(["integer", "null"]);
    expect(schema).toBe(SUMMARY_SCHEMA);
  });

  it("puts the transcript, the Signal lines and the previous Suggestion in the input only", () => {
    expect(request.input).toContain("Patient: Not great. I woke up around four");
    expect(request.input).toContain("Companion: That sounds lovely.");
    expect(request.input).toContain("- Sleep was shorter than usual.");
    expect(request.input).toContain("A short walk by the harbour");
    expect(request.system_instruction).not.toContain("harbour");
  });

  it("forbids diagnosis, advice and invented ratings", () => {
    const text = request.system_instruction.toLowerCase();
    expect(text).toContain("do not diagnose");
    expect(text).toContain("do not give advice");
    expect(text).toMatch(/only if the patient said that number/);
  });

  it("says when there was no previous Suggestion and leaves out empty Signal lines", () => {
    const bare = buildSummaryRequest(DRAFT, [], null);
    expect(bare.input).toContain("no previous Suggestion");
    expect(bare.input).not.toContain("Today's Signals");
  });

  it("keeps the newest turns when the transcript is too long", () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ speaker: "patient" as const, text: `turn-${i} ${"x".repeat(MAX_TURN_CHARS - 20)}` }));
    const text = transcriptText(long);
    expect(text.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(text).toContain("turn-59 ");
    expect(text).not.toContain("turn-0 ");
  });
});

describe("parseModelSummary", () => {
  it("parses the recorded reply from the spike", () => {
    expect(parseModelSummary(recordedOutput)).toEqual({
      mood: 3,
      energy: 2,
      sleepQuality: 2,
      sleepLine: "Woke up around four and couldn't get back to sleep.",
      themes: ["Harbour walk", "Early waking", "Low energy", "Work deadlines"],
      suggestion: "Ten-minute stretch break around three this afternoon",
      previousOutcome: "Went for twenty minutes on Saturday, liked seeing the water, and felt a bit lighter after.",
      previousTried: true,
      previousFelt: null,
      quotes: ["I felt a bit lighter after.", "I woke up around four and couldn't get back to sleep.", "Work has been a lot this week, lots of deadlines."],
    });
  });

  it("gives null for missing or malformed output", () => {
    for (const raw of [null, "", "   ", "not json", "{\"mood\": 3", "[1,2,3]", "42", "null", "\"text\""]) {
      expect(parseModelSummary(raw)).toBeNull();
    }
  });

  it("accepts a reply wrapped in a code fence", () => {
    expect(parseModelSummary("```json\n{\"mood\": 4}\n```")?.mood).toBe(4);
  });

  it("turns ratings outside 1 to 5, non-integers and strings into null", () => {
    const parsed = parseModelSummary(JSON.stringify({ mood: 0, energy: 6, sleepQuality: 2.5, previousFelt: "4" }))!;
    expect([parsed.mood, parsed.energy, parsed.sleepQuality, parsed.previousFelt]).toEqual([null, null, null, null]);
    const edges = parseModelSummary(JSON.stringify({ mood: 1, energy: 5, sleepQuality: 3 }))!;
    expect([edges.mood, edges.energy, edges.sleepQuality]).toEqual([1, 5, 3]);
  });

  it("fills fields of the wrong type with empty values instead of failing", () => {
    expect(parseModelSummary(JSON.stringify({ themes: "sleep", quotes: [1, "", "ok"], sleepLine: 3, suggestion: "", previousTried: "yes" }))).toEqual({
      mood: null,
      energy: null,
      sleepQuality: null,
      sleepLine: "",
      themes: [],
      suggestion: null,
      previousOutcome: null,
      previousTried: null,
      previousFelt: null,
      quotes: ["ok"],
    });
  });

  it("caps themes at four and quotes at three", () => {
    const parsed = parseModelSummary(JSON.stringify({ themes: ["a", "b", "c", "d", "e"], quotes: ["1", "2", "3", "4"] }))!;
    expect(parsed.themes).toEqual(["a", "b", "c", "d"]);
    expect(parsed.quotes).toEqual(["1", "2", "3"]);
  });
});

describe("summaryContent", () => {
  const model = parseModelSummary(recordedOutput)!;

  it("takes the model's fields and the Patient's own quotes", () => {
    const content = summaryContent(model, DRAFT, ALL);
    expect(content).toMatchObject({ mood: 3, energy: 2, sleepQuality: 2, themes: model.themes, sleepLine: model.sleepLine });
    expect(content.quotes).toEqual(model.quotes);
    expect(content.suggestion).toBe("Ten-minute stretch break around three this afternoon");
  });

  it("takes Voice cues and the crisis marker from the draft, never from the model", () => {
    const sneaky = { ...model, voiceCues: [{ label: "invented", intensity: 5, heard: "made up" }], crisis: true } as unknown as ModelSummary;
    const content = summaryContent(sneaky, DRAFT, ALL);
    expect(content.voiceCues).toEqual(DRAFT.voiceCues);
    expect(content.crisis).toBe(false);
    expect(summaryContent(model, { ...DRAFT, crisis: true }, ALL).crisis).toBe(true);
  });

  it("drops quotes the Patient did not say, and cuts long ones to 200 characters", () => {
    const longSaid = `I went ${"really ".repeat(40)}far today`;
    const draft: CheckInDraft = { ...DRAFT, turns: [...DRAFT.turns, { speaker: "patient", text: longSaid }] };
    const content = summaryContent(
      { ...model, quotes: ["Everyone would be better off.", "Did you get a chance to try the walk by the harbour?", longSaid] },
      draft,
      ALL,
    );
    expect(content.quotes).toHaveLength(1);
    expect(content.quotes[0]!.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
    expect(content.quotes[0]!.startsWith("I went really")).toBe(true);
  });

  it("matches quotes despite punctuation and case", () => {
    expect(isPatientQuote("i felt a bit lighter after", DRAFT)).toBe(true);
    expect(isPatientQuote("“Not great.”", DRAFT)).toBe(true);
    expect(isPatientQuote("", DRAFT)).toBe(false);
    expect(isPatientQuote("That sounds lovely", DRAFT)).toBe(false);
  });

  it("is the minimal Summary without model output: empty themes, no ratings, Voice cues still from the draft", () => {
    expect(summaryContent(null, DRAFT, ALL)).toEqual({
      mood: null,
      energy: null,
      sleepQuality: null,
      sleepLine: "",
      themes: [],
      voiceCues: DRAFT.voiceCues,
      suggestion: null,
      previousOutcome: null,
      quotes: [],
      crisis: false,
    });
  });

  it("leaves ratings and Voice cues out when the Patient left them out", () => {
    const content = summaryContent(model, DRAFT, { ratings: false, voiceCues: false });
    expect([content.mood, content.energy, content.sleepQuality]).toEqual([null, null, null]);
    expect(content.voiceCues).toEqual([]);
    expect(content.themes).toEqual(model.themes);
  });
});

describe("summarySuggestion", () => {
  const s = (details: string, status: "proposed" | "accepted" | "declined") => ({ id: null, kind: null, details, status });

  it("prefers the draft's accepted Suggestion, then its open proposal, over the model's line", () => {
    expect(summarySuggestion({ ...DRAFT, suggestions: [s("walk", "accepted"), s("music", "proposed")] }, "model line")).toBe("walk");
    expect(summarySuggestion({ ...DRAFT, suggestions: [s("walk", "declined"), s("music", "proposed")] }, "model line")).toBe("music");
  });

  it("is none when every Suggestion was declined, and the model's line when the draft has none", () => {
    expect(summarySuggestion({ ...DRAFT, suggestions: [s("walk", "declined")] }, "model line")).toBeNull();
    expect(summarySuggestion(DRAFT, "model line")).toBe("model line");
    expect(summarySuggestion(DRAFT, null)).toBeNull();
  });
});

describe("finishWrites", () => {
  const sharing: Partial<PatientDoc> = { ...newPatientDoc("P", "c@example.com"), sharingConsent: "granted", lastCheckInAtMillis: 100, lastSeenAtMillis: 100 };
  const notSharing: Partial<PatientDoc> = { ...sharing, sharingConsent: "declined" };
  const content: FinishContent = summaryContent(parseModelSummary(recordedOutput), DRAFT, ALL);
  const checkIn = newCheckIn("c1", sharing, 500);

  it("writes a Summary keyed by the Check-in, shared when the Check-in is and the Patient shares now", () => {
    const writes = finishWrites({ patient: sharing, checkIn, summary: undefined }, "c1", content, 1_000);
    expect(writes.summary).toEqual({
      checkInId: "c1",
      createdAtMillis: 1_000,
      mood: 3,
      energy: 2,
      sleepQuality: 2,
      sleepLine: content.sleepLine,
      themes: content.themes,
      voiceCues: DRAFT.voiceCues,
      suggestion: content.suggestion,
      previousOutcome: content.previousOutcome,
      quotes: content.quotes,
      sharedWithClinician: true,
    });
    expect(finishWrites({ patient: notSharing, checkIn, summary: undefined }, "c1", content, 1_000).summary.sharedWithClinician).toBe(false);
    // A Check-in started while not sharing stays unshared even if the Patient shares by the end.
    const unshared = newCheckIn("c1", notSharing, 500);
    expect(finishWrites({ patient: sharing, checkIn: unshared, summary: undefined }, "c1", content, 1_000).summary.sharedWithClinician).toBe(false);
  });

  it("on a retry keeps the existing stamp and creation time, and overwrites the content", () => {
    const first = finishWrites({ patient: notSharing, checkIn, summary: undefined }, "c1", content, 1_000).summary;
    const retry = finishWrites({ patient: sharing, checkIn, summary: first }, "c1", { ...content, themes: ["Retry theme"] }, 2_000).summary;
    expect(retry.sharedWithClinician).toBe(false);
    expect(retry.createdAtMillis).toBe(1_000);
    expect(retry.themes).toEqual(["Retry theme"]);
  });

  it("sets the ratings, Voice cues, crisis marker, assessment and end time on the Check-in, and nothing else", () => {
    const writes = finishWrites({ patient: sharing, checkIn, summary: undefined }, "c1", { ...content, crisis: true }, 1_000);
    expect(writes.checkIn).toEqual({
      mood: 3, energy: 2, sleepQuality: 2, voiceCues: DRAFT.voiceCues, crisis: true, endedAtMillis: 1_000, assessment: null, previousTried: null,
    });
    expect(writes.flags).toEqual([]);
    expect(Object.keys(writes.checkIn)).not.toContain("sharedWithClinician");
    expect(Object.keys(writes.checkIn)).not.toContain("startedAtMillis");
  });

  it("keeps an end time the phone already set, and never clears a crisis marker", () => {
    const ended = { ...checkIn, endedAtMillis: 900, crisis: true };
    const writes = finishWrites({ patient: sharing, checkIn: ended, summary: undefined }, "c1", content, 1_000);
    expect(writes.checkIn.endedAtMillis).toBe(900);
    expect(writes.checkIn.crisis).toBe(true);
    expect(writes.patient.lastCheckInAtMillis).toBe(900);
  });

  it("moves the Patient's last Check-in and sign of life forward, never back", () => {
    expect(finishWrites({ patient: sharing, checkIn, summary: undefined }, "c1", content, 1_000).patient).toEqual({ lastCheckInAtMillis: 1_000, lastSeenAtMillis: 1_000 });
    const ahead = { ...sharing, lastCheckInAtMillis: 5_000, lastSeenAtMillis: 6_000 };
    expect(finishWrites({ patient: ahead, checkIn, summary: undefined }, "c1", content, 1_000).patient).toEqual({ lastCheckInAtMillis: 5_000, lastSeenAtMillis: 6_000 });
    const fresh = { ...sharing, lastCheckInAtMillis: null, lastSeenAtMillis: null };
    expect(finishWrites({ patient: fresh, checkIn, summary: undefined }, "c1", content, 1_000).patient).toEqual({ lastCheckInAtMillis: 1_000, lastSeenAtMillis: 1_000 });
  });
});

describe("newCheckIn", () => {
  it("starts with every function-only field empty, stamped as the Patient shares now", () => {
    expect(newCheckIn("c1", { sharingConsent: "granted" }, 42)).toEqual({
      id: "c1",
      startedAtMillis: 42,
      endedAtMillis: null,
      mood: null,
      energy: null,
      sleepQuality: null,
      voiceCues: [],
      crisis: false,
      assessment: null,
      previousTried: null,
      sharedWithClinician: true,
    });
    expect(newCheckIn("c1", { sharingConsent: "undecided" }, 42).sharedWithClinician).toBe(false);
  });
});
