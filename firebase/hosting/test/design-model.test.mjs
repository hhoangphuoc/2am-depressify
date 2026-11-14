// The design adapter (js/lib/design-model.js) on fixtures built by the seed generator: the three
// Demo Patients as the Clinician reads them (only documents stamped `sharedWithClinician`). Where the
// design prototype has a pure helper (design/clinician/src/data.mjs), the adapter's output is run
// through it too, so the prototype's components can take live data unchanged.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as design from "../../../design/clinician/src/data.mjs";
import { generateDemoPatients } from "../../seed/src/generate.js";
import { zonedMillis } from "../../seed/src/dates.js";
import { baselineFor } from "../js/lib/baseline.js";
import { flagSource } from "../js/lib/flag-detail.js";
import { phases } from "../js/lib/timeline.js";
import { whatHelps, whatHelpsWindow } from "../js/lib/what-helps.js";
import {
  DESIGN_LEVELS,
  DESIGN_SIGNALS,
  designAttention,
  designDigest,
  designHistory,
  designPatient,
  designSummaries,
  designWhatHelps,
  highlightsList,
  highlightsText,
  initialsOf,
  intakeFileProblem,
  latestAssessment,
  orderRoster,
  rosterView,
  shortDateTime,
  validateDesignTms,
  validateDesignVisit,
  withdrawnPatient,
} from "../js/lib/design-model.js";

const TZ = "Europe/Helsinki";
// The design's frozen clock: Friday 13 November 2026, 14:20 in Helsinki.
const TODAY = design.TODAY;
const NOW = zonedMillis(TODAY, 14, 20, TZ);
const CLOCK = { nowMillis: NOW, timeZone: TZ };
const demo = generateDemoPatients({ today: TODAY, nowMillis: NOW });

/** @param {{ id: string, data: object }[]} entries @param {boolean} stamped */
const docs = (entries, stamped = true) => entries.filter((e) => !stamped || e.data.sharedWithClinician !== false).map((e) => ({ id: e.id, ...e.data }));

/** One Demo Patient's documents as the dashboard's queries return them to the Clinician. */
function sourcesOf(key, overrides = {}) {
  const p = demo.find((d) => d.profile === key);
  assert.ok(p, `no Demo Patient ${key}`);
  return {
    id: p.id,
    patient: p.patient,
    flags: docs(p.flags),
    daily: docs(p.daily),
    checkIns: docs(p.checkIns),
    summaries: docs(p.summaries),
    suggestions: docs(p.suggestions),
    visits: docs(p.visits, false),
    consents: docs(p.consents, false),
    digests: [],
    ...overrides,
  };
}

const steady = () => designPatient(sourcesOf("steady"), CLOCK);
const declining = () => designPatient(sourcesOf("declining"), CLOCK);
const sparse = () => designPatient(sourcesOf("sparse"), CLOCK);

describe("level words", () => {
  test("are the design's words, with no number and no claim of safety (ADR 0001, 0009)", () => {
    assert.deepEqual(DESIGN_LEVELS, design.levels);
    for (const word of Object.values(DESIGN_LEVELS)) {
      assert.doesNotMatch(word, /\d|%|score|risk|safe|recovered/i);
    }
  });
});

describe("designPatient on the Demo Patients", () => {
  test("has every field of the design's patient object", () => {
    const prototype = design.createPatients()[0];
    for (const patient of [steady(), declining(), sparse()]) {
      for (const key of Object.keys(prototype)) assert.ok(key in patient, `${patient.id} lacks ${key}`);
    }
  });

  test("the declining Patient is red with every open reason, highest first, and the design agrees", () => {
    const p = declining();
    assert.equal(p.level, "red");
    assert.equal(p.levelWord, "Red · Needs attention");
    assert.deepEqual(p.activeFlags.map((f) => f.level), ["red", "amber", "amber", "amber"]);
    assert.equal(p.reason, p.activeFlags[0].reason);
    assert.equal(p.source, flagSource("sleep_collapse"));
    assert.match(p.observed, /^\d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/);
    assert.equal(design.attentionFor(p).level, p.level, "the design's attentionFor reads the same level");
  });

  test("steady is green, sparse is amber, and alerts are off for Demo Patients (no email)", () => {
    assert.equal(steady().level, "green");
    assert.equal(steady().reason, "No current Attention flag.");
    assert.equal(sparse().level, "amber");
    for (const p of [steady(), declining(), sparse()]) assert.equal(p.alertsEnabled, false);
    const live = designPatient(sourcesOf("steady", { patient: { ...sourcesOf("steady").patient, synthetic: false } }), CLOCK);
    assert.equal(live.alertsEnabled, true);
  });

  test("the name, initials, last Check-in and phone freshness", () => {
    const p = declining();
    assert.equal(p.name, "Mikko (demo)");
    assert.equal(p.initials, "M");
    assert.equal(initialsOf("Elias Niemi"), "EN");
    assert.equal(initialsOf(""), "—");
    assert.match(p.checkIn, /^(Today|Yesterday), \d{2}:\d{2}$|days ago/);
    assert.equal(typeof p.freshness.stale, "boolean");
    assert.ok(typeof p.lastPhone === "string");
  });

  test("daily rows run from the TMS end date to today, one per date, like the design's 43 days", () => {
    const p = declining();
    assert.equal(p.daily.length, 43);
    assert.equal(p.daily[0].date, design.START);
    assert.equal(p.daily.at(-1).date, TODAY);
    for (let i = 1; i < p.daily.length; i++) assert.equal(design.daysBetween(p.daily[i - 1].date, p.daily[i].date), 1);
    assert.deepEqual(Object.keys(p.daily[1]).sort(), ["calendar", "date", "heart", "home", "hrv", "mood", "radius", "rhr", "screen", "sleep", "steps"].sort());
  });

  test("Signals are in the design's units: minutes become hours; a missing value is null, never 0", () => {
    const source = sourcesOf("sparse");
    const p = designPatient(source, CLOCK);
    for (const doc of source.daily) {
      const row = p.daily.find((r) => r.date === doc.date);
      const minutes = doc.values.sleepMinutes;
      assert.equal(row.sleep, minutes === null ? null : Math.round((minutes / 60) * 100) / 100);
      assert.equal(row.steps, doc.values.steps);
      if (doc.values.hrv === null) assert.equal(row.hrv, null);
    }
    assert.ok(p.daily.some((r) => r.sleep === null), "the sparse Patient has nights without the watch");
    assert.equal(p.daily[0].sleep, null, "the TMS end date has no record: a gap, not 0");
  });

  test("records saved while the Patient was not sharing are gaps on the Clinician's charts", () => {
    const p = steady();
    for (const date of ["2026-10-14", "2026-10-15", "2026-10-16"]) {
      const row = p.daily.find((r) => r.date === date);
      for (const s of DESIGN_SIGNALS) assert.equal(row[s.key], null, `${date} ${s.key}`);
    }
  });

  test("the Mood lane agrees with the Summaries (the design's own invariant)", () => {
    for (const p of [steady(), declining(), sparse()]) {
      for (const s of p.summaries) assert.equal(p.daily.find((d) => d.date === s.date).mood, s.mood, `${p.id} ${s.date}`);
    }
  });

  test("Signal Consent off hides that Signal's values and says so", () => {
    const source = sourcesOf("steady");
    const consents = source.consents.map((c) => (c.subject === "hrv" ? { ...c, granted: false } : c));
    const p = designPatient({ ...source, consents }, CLOCK);
    assert.ok(p.daily.every((r) => r.hrv === null));
    assert.equal(p.signals.find((s) => s.key === "hrv").state, "no_consent");
    assert.equal(p.signals.find((s) => s.key === "hrv").latest, null);
  });
});

describe("Signals and Baseline", () => {
  test("eight design trends plus the backend's late-night screen time, labelled synthetic for Demo Patients", () => {
    const p = declining();
    assert.deepEqual(p.signals.filter((s) => !s.extra).map((s) => s.key), design.signalDefinitions.map((s) => s.key));
    assert.deepEqual(p.signals.filter((s) => s.extra).map((s) => s.key), ["screen"]);
    for (const s of p.signals) assert.equal(s.sourceLabel, "Synthetic demo data");
  });

  test("the Baseline is the shared rule's median, in design units, and matches the design's own baseline()", () => {
    const source = sourcesOf("declining");
    const p = designPatient(source, CLOCK);
    const sleep = p.signals.find((s) => s.key === "sleep");
    const expected = baselineFor(source.daily.map((d) => ({ date: d.date, value: d.values.sleepMinutes })), TODAY);
    assert.equal(sleep.baseline.value, Math.round((expected.centre / 60) * 100) / 100);
    assert.equal(sleep.baseline.status, "ready");
    const theirs = design.baseline(p.daily, "steps", TODAY);
    const steps = p.signals.find((s) => s.key === "steps");
    assert.equal(steps.baseline.value, theirs.value);
    assert.equal(steps.baseline.validDays, theirs.validDays);
  });

  test("fewer than five valid days is a Baseline still being built, with the count", () => {
    const source = sourcesOf("steady");
    const daily = source.daily.filter((d) => d.date > "2026-11-09");
    const p = designPatient({ ...source, daily }, CLOCK);
    const sleep = p.signals.find((s) => s.key === "sleep");
    assert.equal(sleep.baseline.status, "building");
    assert.equal(sleep.baseline.value, null);
    assert.ok(sleep.baseline.validDays < 5);
  });

  test("no records at all is 'no data', not zero", () => {
    const p = designPatient(sourcesOf("steady", { daily: [] }), CLOCK);
    for (const s of p.signals) {
      assert.equal(s.state, "no_data");
      assert.equal(s.latest, null);
    }
    assert.ok(p.daily.every((r) => DESIGN_SIGNALS.every((s) => r[s.key] === null)));
  });
});

describe("Summaries", () => {
  test("newest first, with the Check-in time, the generated time and the stored sentences only", () => {
    const source = sourcesOf("declining");
    const p = designPatient(source, CLOCK);
    assert.deepEqual(
      p.summaries.map((s) => s.createdAtMillis),
      [...p.summaries.map((s) => s.createdAtMillis)].sort((a, b) => b - a),
    );
    const latest = p.summaries[0];
    const stored = source.summaries.find((s) => s.checkInId === latest.id);
    const checkIn = source.checkIns.find((c) => c.id === latest.id);
    assert.equal(latest.time, new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(checkIn.startedAtMillis));
    assert.equal(latest.text, [stored.sleepLine, stored.previousOutcome, stored.suggestion].filter(Boolean).join(" "));
    assert.equal(latest.mood, stored.mood);
    assert.equal(latest.sleep, stored.sleepQuality);
    assert.deepEqual(latest.themes, stored.themes);
    assert.ok(!("transcript" in latest));
  });

  test("the previous Outcome comes from the Suggestion made before the Check-in", () => {
    const source = sourcesOf("steady");
    const p = designPatient(source, CLOCK);
    const withOutcome = p.summaries.find((s) => s.tried !== null);
    assert.ok(withOutcome);
    const checkIn = source.checkIns.find((c) => c.id === withOutcome.id);
    const previous = source.suggestions
      .filter((s) => s.suggestedAtMillis < checkIn.startedAtMillis)
      .sort((a, b) => b.suggestedAtMillis - a.suggestedAtMillis)[0];
    assert.equal(withOutcome.previousKind, previous.kind);
    assert.equal(withOutcome.tried, previous.tried);
    assert.equal(withOutcome.feeling, previous.felt);
  });

  test("a Suggestion's outcomeCheckInId (PR #65) wins over the time order", () => {
    const summaries = [{ checkInId: "c2", createdAtMillis: 2_000 }];
    const checkIns = [{ id: "c2", startedAtMillis: 1_900 }];
    const suggestions = [
      { id: "a", kind: "walk", suggestedAtMillis: 1_000, tried: true, felt: 2 },
      { id: "b", kind: "music", suggestedAtMillis: 500, tried: true, felt: 5, outcomeCheckInId: "c2" },
    ];
    const [s] = designSummaries(summaries, { checkIns, suggestions, timeZone: TZ });
    assert.deepEqual([s.previousKind, s.tried, s.feeling], ["music", true, 5]);
  });

  test("Voice cues read as observations", () => {
    const [s] = designSummaries([{ checkInId: "c", createdAtMillis: 1, voiceCues: [{ label: "long pauses", intensity: 3, heard: "paused often" }] }]);
    assert.equal(s.voice, "Long pauses, noticed at 3 of 5: paused often");
  });
});

describe("timeline, Visits and Intake", () => {
  test("Phases come from timeline.js; week since TMS; PHQ-9 on its own lane", () => {
    const source = sourcesOf("declining");
    const p = designPatient(source, CLOCK);
    assert.equal(p.tms, "2026-10-02");
    assert.equal(p.timeline.weekSinceTms, 6);
    assert.deepEqual(
      p.timeline.phases.map((x) => [x.start, x.end]),
      phases(p.tms, source.visits, TODAY).map((x) => [x.start, x.end]),
    );
    assert.deepEqual(p.timeline.phases.map((x) => x.label), ["Phase 1", "Phase 2"]);
    assert.deepEqual(Object.keys(p.timeline.questionnaires), ["PHQ-9"]);
    assert.equal(p.visits[0].type, "PHQ-9");
    assert.ok(p.timeline.moodWeeks.some((w) => w.mean === null || w.mean >= 1));
  });

  test("Visits map to the design's types; no score is 'none'", () => {
    const p = designPatient(
      sourcesOf("steady", {
        visits: [
          { id: "v1", date: "2026-10-23", questionnaire: "phq2", score: 3 },
          { id: "v2", date: "2026-11-05", questionnaire: null, score: null },
        ],
      }),
      CLOCK,
    );
    assert.deepEqual(p.visits, [
      { id: "v2", date: "2026-11-05", type: "none", score: null },
      { id: "v1", date: "2026-10-23", type: "PHQ-2", score: 3 },
    ]);
    assert.deepEqual(design.timelinePhases(p.tms, p.visits).length, 3, "the design's own Phase helper accepts them");
  });

  test("Intake highlights become a list; the saved date is not stored", () => {
    const p = declining();
    assert.ok(p.intake.highlights.length > 1);
    assert.equal(p.intake.highlights[0], "Synthetic demo data.");
    assert.equal(p.intake.date, null);
    assert.deepEqual(highlightsList("- Walks help\n- Music\n"), ["Walks help", "Music"]);
    assert.equal(highlightsText(["Walks help", "Music"]), "- Walks help\n- Music");
    assert.equal(designPatient(sourcesOf("steady", { patient: { ...sourcesOf("steady").patient, intakeHighlights: "" } }), CLOCK).intake, null);
  });

  test("the TMS end date missing: no week count and no Phases", () => {
    const p = designPatient(sourcesOf("steady", { patient: { ...sourcesOf("steady").patient, tmsEndDate: null } }), CLOCK);
    assert.equal(p.tms, null);
    assert.equal(p.timeline.weekSinceTms, null);
    assert.deepEqual(p.timeline.phases, []);
  });
});

describe("Weekly Digest", () => {
  const source = sourcesOf("declining");
  const ids = source.summaries.filter((s) => s.createdAtMillis >= zonedMillis("2026-11-09", 0, 0, TZ)).sort((a, b) => a.createdAtMillis - b.createdAtMillis).map((s) => s.checkInId);
  const digest = {
    isoWeek: "2026-W46", weekStart: "2026-11-09", weekEnd: TODAY, summaryCount: ids.length, sourceCheckInIds: ids,
    text: "A short week.", generatedAtMillis: NOW, sharedWithClinician: true,
  };

  test("lists its source Summaries from sourceCheckInIds", () => {
    const p = designPatient({ ...source, digests: [digest] }, CLOCK);
    assert.deepEqual(p.digest.ids, ids);
    assert.deepEqual(p.digest.sources.map((s) => s.id), ids);
    assert.equal(p.digest.missingSources, 0);
    assert.equal(p.digest.time, "13 Nov, 14:20");
    assert.equal(p.digest.source, `Drawn from ${ids.length} Summaries`);
    assert.match(p.digest.coverage, /the week so far/);
    assert.equal(p.digest.stale, false);
  });

  test("a Digest written before the field existed shows the count only", () => {
    const { sourceCheckInIds, ...legacy } = digest;
    const d = designDigest(legacy, { summaries: [], today: TODAY });
    assert.equal(d.ids, null);
    assert.deepEqual(d.sources, []);
    assert.equal(d.summaryCount, ids.length);
  });

  test("an earlier week's Digest is stale; no Digest is null", () => {
    const old = { ...digest, isoWeek: "2026-W45", weekStart: "2026-11-02", weekEnd: "2026-11-08" };
    assert.equal(designDigest(old, { today: TODAY }).stale, true);
    assert.equal(designDigest(null, { today: TODAY }), null);
  });
});

describe("what seems to help", () => {
  test("keeps whatHelps' rows and adds the mean of the Patient's own answers", () => {
    const source = sourcesOf("steady");
    const p = designPatient(source, CLOCK);
    const reference = whatHelps(source.suggestions, { ...whatHelpsWindow(TODAY), timeZone: TZ });
    assert.deepEqual(p.whatHelps.rows.map((r) => [r.kind, r.outcomes]), reference.rows.map((r) => [r.kind, r.n]));
    for (const row of p.whatHelps.rows) {
      assert.ok(row.feltMean === null || (row.feltMean >= 1 && row.feltMean <= 5));
      assert.ok(!("mean" in row), "the Outcome score's mean is never exposed");
    }
  });

  test("an empty history has no rows", () => {
    assert.deepEqual(designWhatHelps([], { today: TODAY }).rows, []);
  });
});

describe("Attention states", () => {
  const base = sourcesOf("steady");

  test("assessment unavailable with nothing open shows 'unknown', never green (PR #62's field)", () => {
    const checkIns = [...base.checkIns, { id: "late", startedAtMillis: NOW - 3_600_000, assessment: "unavailable" }];
    const p = designPatient({ ...base, checkIns }, CLOCK);
    assert.equal(p.level, "unknown");
    assert.equal(p.storedLevel, "green");
    assert.equal(p.assessmentStatus, "unavailable");
    assert.match(p.reason, /not a green result/);
    assert.equal(design.attentionFor({ ...p, activeFlags: [] }).level, "unknown");
  });

  test("assessment unavailable keeps an open flag's level", () => {
    const d = sourcesOf("declining");
    const checkIns = [...d.checkIns, { id: "late", startedAtMillis: NOW - 3_600_000, assessment: "unavailable" }];
    const p = designPatient({ ...d, checkIns }, CLOCK);
    assert.equal(p.level, "red");
    assert.equal(p.assessmentStatus, "unavailable");
  });

  test("only the latest Check-in counts; no field means unknown", () => {
    assert.deepEqual(latestAssessment([{ startedAtMillis: 1, assessment: "unavailable" }, { startedAtMillis: 2, assessment: "assessed" }]).assessment, "assessed");
    assert.equal(latestAssessment([{ startedAtMillis: 1 }]).assessment, null);
    assert.equal(latestAssessment(null).assessment, null);
  });

  test("a new amber while red stays red, and both reasons show", () => {
    const d = sourcesOf("declining");
    const flags = [...d.flags, { id: "drift-new", level: "amber", kind: "drift", reason: "steps fell", raisedAtMillis: NOW, clearedAtMillis: null, sharedWithClinician: true }];
    const p = designPatient({ ...d, flags }, CLOCK);
    assert.equal(p.level, "red");
    assert.equal(p.activeFlags[0].level, "red");
    assert.ok(p.activeFlags.some((f) => f.reason === "Steps fell."));
  });

  test("until flags load, the record's level and reasons stand in", () => {
    const a = designAttention(sourcesOf("declining").patient, null);
    assert.equal(a.level, "red");
    assert.equal(a.flagsLoaded, false);
    assert.ok(a.activeFlags.length > 0);
    assert.equal(a.activeFlags[0].source, null);
  });

  test("history keeps every raised and cleared reason, newest first, with the email policy", () => {
    const flags = [
      { id: "a", level: "red", kind: "silent", reason: "The phone has been quiet.", raisedAtMillis: 1_000, clearedAtMillis: 5_000 },
      { id: "b", level: "amber", kind: "drift", reason: "drift", raisedAtMillis: 3_000, clearedAtMillis: null },
    ];
    const live = designHistory(flags, { synthetic: false, timeZone: TZ });
    assert.deepEqual(live.map((h) => `${h.action} ${h.flagId}`), ["Cleared a", "Raised b", "Raised a"]);
    assert.equal(live.find((h) => h.id === "a-raised").emailStatus, "requested");
    assert.equal(live.find((h) => h.id === "a-raised").source, flagSource("silent"));
    assert.equal(live.find((h) => h.id === "b-raised").email, "Not applicable");
    assert.equal(designHistory(flags, { synthetic: true })[2].emailStatus, "demo");
  });

  test("a quiet phone is a red flag with the silence check's source and no inference", () => {
    const flags = [{ id: "silent-1", level: "red", kind: "silent", reason: "The phone has been quiet: it has not connected for over 24 hours.", raisedAtMillis: NOW, clearedAtMillis: null, sharedWithClinician: true }];
    const p = designPatient({ ...base, flags }, CLOCK);
    assert.equal(p.level, "red");
    assert.equal(p.source, "From the hourly check for a quiet phone");
    assert.doesNotMatch(p.reason, /harm|suicid|risk/i);
  });
});

describe("sharing withdrawn", () => {
  test("a Patient not sharing has no name and no data, only the hidden state", () => {
    const source = sourcesOf("declining");
    const p = designPatient({ ...source, patient: { ...source.patient, sharingConsent: "declined" } }, CLOCK);
    assert.deepEqual(p, withdrawnPatient(source.id));
    assert.equal(p.level, "hidden");
    assert.equal(p.name, "Patient sharing withdrawn");
    assert.deepEqual([p.daily, p.summaries, p.activeFlags, p.history, p.visits], [[], [], [], [], []]);
    assert.equal(p.alertsEnabled, false);
    assert.doesNotMatch(p.note, /deleted|removed/i, "records are hidden, not deleted (future-only sharing)");
    assert.equal(design.attentionFor(p).level, "hidden");
  });
});

describe("the roster", () => {
  const unassessed = designPatient(
    { ...sourcesOf("steady"), id: "demo-unassessed", patient: { ...sourcesOf("steady").patient, displayName: "Zed (demo)" }, checkIns: [{ id: "x", startedAtMillis: NOW, assessment: "unavailable" }] },
    CLOCK,
  );
  const all = [steady(), withdrawnPatient("gone"), sparse(), unassessed, declining()];

  test("orders red, amber, unassessed, green, withdrawn, like the design's orderPatients", () => {
    const ordered = orderRoster(all);
    assert.deepEqual(ordered.map((p) => p.level), ["red", "amber", "unknown", "green", "hidden"]);
    assert.deepEqual(design.orderPatients(all).map((p) => p.level), ordered.map((p) => p.level));
    assert.deepEqual(all.map((p) => p.id)[0], "demo-steady", "sorting does not mutate the input");
  });

  test("counts every level before filtering; filters and search never hide the red banner", () => {
    const view = rosterView({ patients: all }, { search: "sara", filter: "amber" });
    assert.deepEqual(view.counts, { all: 5, red: 1, amber: 1, unknown: 1, green: 1, hidden: 1 });
    assert.deepEqual(view.patients.map((p) => p.id), ["demo-sparse"]);
    assert.equal(view.banner.items[0].patientId, "demo-declining");
    assert.deepEqual(view.reds.map((p) => p.id), ["demo-declining"]);
    assert.deepEqual(view.filters, ["all", "red", "amber", "unknown", "green", "hidden"]);
  });

  test("the Unassessed filter, no matches and the empty caseload", () => {
    assert.deepEqual(rosterView({ patients: all }, { filter: "unknown" }).patients.map((p) => p.id), ["demo-unassessed"]);
    assert.equal(rosterView({ patients: all }, { search: "nobody" }).message.kind, "noMatch");
    assert.equal(rosterView({ patients: [] }).message.kind, "empty");
    assert.deepEqual(rosterView({ patients: [steady()] }).filters, ["all", "red", "amber", "green"]);
  });
});

describe("form checks", () => {
  const context = { today: TODAY, tms: "2026-10-02", visits: [{ id: "v", date: "2026-10-23" }] };

  test("Record a Visit: the design's ranges and its two extra rules", () => {
    assert.deepEqual(validateDesignVisit({ date: TODAY, type: "PHQ-2", score: "6" }, context), { ok: true, visit: { date: TODAY, questionnaire: "phq2", score: 6 } });
    for (const score of ["7", "-1", "2.5", "", " ", null, "abc"]) assert.equal(validateDesignVisit({ date: TODAY, type: "PHQ-2", score }, context).ok, false, String(score));
    assert.equal(validateDesignVisit({ date: TODAY, type: "PHQ-9", score: "27" }, context).ok, true);
    assert.equal(validateDesignVisit({ date: TODAY, type: "PHQ-9", score: "28" }, context).ok, false);
    assert.equal(validateDesignVisit({ date: "2026-11-14", type: "none", score: "" }, context).ok, false, "future");
    assert.equal(validateDesignVisit({ date: "2026-02-30", type: "none", score: "" }, context).ok, false, "not a date");
    assert.deepEqual(validateDesignVisit({ date: TODAY, type: "none", score: "5" }, context), { ok: true, visit: { date: TODAY, questionnaire: null, score: null } });
    assert.equal(validateDesignVisit({ date: "2026-10-01", type: "none" }, context).message, "The Visit must be on or after the TMS end date.");
    assert.match(validateDesignVisit({ date: "2026-10-23", type: "none" }, context).message, /already recorded/);
    assert.equal(validateDesignVisit({ date: "2026-10-23", type: "none" }, { ...context, editingId: "v" }).ok, true);
  });

  test("agrees with the design's validateVisit on its own cases", () => {
    const cases = [
      { date: "2026-11-13", type: "PHQ-2", score: "6" },
      { date: "2026-11-13", type: "PHQ-2", score: "7" },
      { date: "2026-11-13", type: "PHQ-9", score: "27" },
      { date: "2026-11-14", type: "none", score: "" },
      { date: "2026-02-30", type: "none", score: "" },
      { date: "2026-11-13", type: "none", score: "" },
    ];
    for (const form of cases) assert.equal(validateDesignVisit(form, { today: TODAY }).ok, design.validateVisit(form) === "", JSON.stringify(form));
  });

  test("the TMS end date is not in the future and not after a Visit", () => {
    assert.deepEqual(validateDesignTms("2026-10-02", context), { ok: true, date: "2026-10-02" });
    assert.equal(validateDesignTms("2026-11-14", context).ok, false);
    assert.equal(validateDesignTms("2026-10-24", context).message, "TMS must end on or before the first recorded Visit.");
  });

  test("an Intake file is .txt or .md, at most 100 KB", () => {
    assert.equal(intakeFileProblem({ name: "report.txt", size: 100_000 }), null);
    assert.equal(intakeFileProblem({ name: "REPORT.MD", size: 10 }), null);
    assert.ok(intakeFileProblem({ name: "report.txt", size: 100_001 }));
    assert.ok(intakeFileProblem({ name: "report.pdf", size: 10 }));
    assert.ok(intakeFileProblem(null));
  });
});

test("shortDateTime is the design's '13 Nov, 14:20' in Helsinki time", () => {
  assert.equal(shortDateTime(NOW, TZ), "13 Nov, 14:20");
  assert.equal(shortDateTime(null), null);
});
