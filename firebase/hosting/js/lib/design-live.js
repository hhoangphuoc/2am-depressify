// Live data for the dashboard design: subscriptions that hand the UI design-model objects
// (js/lib/design-model.js), and the few writes and calls the design makes. Framework-agnostic: plain
// callbacks, no DOM. Like clear.js, every function takes the Firestore functions it uses (`fs`), so
// the page passes the browser SDK (js/data/design-data.js), a React port passes
// `import * as fs from "firebase/firestore"`, and the emulator tests pass the npm SDK.
//
// What the rules require is kept here, not left to the UI:
//   - the Patient list carries the sharing filter (`clinicianListFilters`), or the query is refused;
//   - every query on a stamped collection goes through `patientCollectionQuery`, which reads only
//     what was saved while the Patient was sharing;
//   - a Patient who stops sharing becomes the withdrawn state at once (`sharingStateFromSnapshot`
//     for a Demo Patient, `sharingStateFromError` for everyone else), and their collection
//     listeners are stopped, so no data stays on screen.
//
// Each subscription reports `fromCache` from the snapshot metadata: true means the data is the
// SDK's saved copy (offline or not yet confirmed), the design's "Offline · showing saved data".
import { isOpen, newRedFlags } from "./banner.js";
import { clearErrorMessage, clearFlags, reviewOf } from "./clear.js";
import { digestErrorMessage } from "./digest.js";
import { highlightsProblem, intakeErrorMessage, reportProblem } from "./intake.js";
import { clinicianListFilters, patientCollectionQuery, sharingStateFromError, sharingStateFromSnapshot } from "./sharing.js";
import {
  DESIGN_TIME_ZONE,
  designPatient,
  highlightsList,
  highlightsText,
  orderRoster,
  validateDesignTms,
  validateDesignVisit,
  withdrawnPatient,
} from "./design-model.js";

/** The roster reads this many of each Patient's latest daily records: 14 for the sparkline, 14 for its Baseline. */
export const ROSTER_DAILY_DAYS = 28;

/** The collections each Patient section needs, besides the Patient record. */
export const SECTION_COLLECTIONS = Object.freeze({
  attention: Object.freeze(["flags", "checkIns"]),
  overview: Object.freeze(["flags", "checkIns", "summaries", "suggestions", "visits", "digests"]),
  summaries: Object.freeze(["checkIns", "summaries", "suggestions", "digests"]),
  signals: Object.freeze(["daily", "consents", "visits"]),
  intakeVisits: Object.freeze(["visits"]),
  digest: Object.freeze(["digests", "summaries", "checkIns"]),
  all: Object.freeze(["flags", "daily", "checkIns", "summaries", "suggestions", "visits", "digests", "consents"]),
});

export const LIVE_COPY = Object.freeze({
  saveFailed: "That did not save. Your changes are still here. Try again.",
  noAccess: "You can no longer change this Patient's record. The Patient may have stopped sharing with you.",
  expired: "Your sign-in has ended. Sign in again, then try again.",
  changed: "A new reason arrived while you were reviewing. Review it before clearing.",
  nothingOpen: "There is no open Attention flag to clear.",
});

/**
 * @typedef {object} FirestoreFns the Firestore functions this module uses
 * @property {Function} collection
 * @property {Function} doc
 * @property {Function} query
 * @property {Function} where
 * @property {Function} orderBy
 * @property {Function} limit
 * @property {Function} onSnapshot
 * @property {Function} [addDoc]
 * @property {Function} [updateDoc]
 * @property {Function} [getDocs]
 * @property {Function} [runTransaction]
 */

/** @typedef {() => { nowMillis: number, timeZone?: string }} ClockFn */

/** @type {ClockFn} */
const systemClock = () => ({ nowMillis: Date.now(), timeZone: DESIGN_TIME_ZONE });

/** @param {unknown} error */
const codeOf = (error) => String(/** @type {any} */ (error)?.code ?? "").replace(/^(firestore|functions)\//, "");

/**
 * What the roster shows when its query fails: denied access, an ended sign-in, or an error. The raw
 * error text is never shown.
 * @param {unknown} error
 * @returns {"denied" | "expired" | "error"}
 */
export function rosterStatusFromError(error) {
  const code = codeOf(error);
  if (code === "permission-denied") return "denied";
  if (code === "unauthenticated") return "expired";
  return "error";
}

/** @param {unknown} error */
function writeErrorMessage(error) {
  const code = codeOf(error);
  if (code === "permission-denied") return LIVE_COPY.noAccess;
  if (code === "unauthenticated") return LIVE_COPY.expired;
  return LIVE_COPY.saveFailed;
}

/**
 * onSnapshot with metadata changes, so a change between cached and confirmed data is reported.
 * @param {FirestoreFns} fs @param {unknown} target @param {(snapshot: any) => void} next @param {(error: unknown) => void} error
 * @returns {() => void}
 */
function listen(fs, target, next, error) {
  return fs.onSnapshot(target, { includeMetadataChanges: true }, next, error);
}

/** @param {any} snapshot */
const docsOf = (snapshot) => snapshot.docs.map((/** @type {any} */ d) => ({ id: d.id, ...d.data() }));

/** @param {any} snapshot */
const cached = (snapshot) => snapshot?.metadata?.fromCache === true;

// ---------------------------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} RosterState
 * @property {"loading" | "ok" | "denied" | "expired" | "error"} status
 * @property {boolean} fromCache true while any part is the SDK's saved copy
 * @property {ReturnType<typeof designPatient>[]} patients in the design's order; pass to `rosterView`
 * @property {{ patientId: string, displayName: string, reason: string }[]} newRed red flags that arrived
 *   since the last update (never on the first load); for the sound and the announcement
 * @property {number} updatedAtMillis
 */

/**
 * The Clinician's Patients, live, as design-model patient objects with the attention level, the
 * last 28 days of Signals (for the sleep sparkline) and the latest Check-in's assessment.
 * @param {FirestoreFns} fs
 * @param {unknown} db
 * @param {{ clinicianEmail: string, clock?: ClockFn, withSleep?: boolean, withAssessment?: boolean, keepWithdrawn?: boolean }} options
 *   `keepWithdrawn`: a Patient who leaves the list in this session (sharing withdrawn) stays as an
 *   anonymous "sharing withdrawn" row with no data, until the page reloads
 * @param {(state: RosterState) => void} onChange
 * @returns {() => void} stops every listener
 */
export function subscribeRoster(fs, db, options, onChange) {
  const { clinicianEmail, clock = systemClock, withSleep = true, withAssessment = true, keepWithdrawn = false } = options;
  const loadedAtMillis = clock().nowMillis;
  /** @type {RosterState["status"]} */
  let status = "loading";
  /** @type {{ id: string, data: any }[] | null} */
  let docs = null;
  let listFromCache = false;
  /** @type {Set<string> | null} */
  let firstIds = null;
  /** @type {Map<string, { flags: any[] | null, daily: any[], checkIns: any[], fromCache: Record<string, boolean>, stops: (() => void)[] }>} */
  const perPatient = new Map();
  /** @type {Set<string>} */
  const withdrawn = new Set();
  /** @type {RosterState["newRed"]} */
  let newRed = [];
  let stopped = false;

  function emit() {
    if (stopped) return;
    const { nowMillis, timeZone } = clock();
    const live = (docs ?? []).map(({ id, data }) => {
      const p = perPatient.get(id);
      return designPatient({ id, patient: data, flags: p?.flags ?? null, daily: p?.daily ?? [], checkIns: p?.checkIns ?? [] }, { nowMillis, timeZone }, { maxDays: ROSTER_DAILY_DAYS });
    });
    const patients = orderRoster([...live, ...[...withdrawn].map(withdrawnPatient)]);
    const fromCache = listFromCache || [...perPatient.values()].some((p) => Object.values(p.fromCache).some(Boolean));
    const changes = newRed;
    newRed = [];
    onChange({ status, fromCache, patients, newRed: changes, updatedAtMillis: nowMillis });
  }

  /** @param {string} id */
  function watch(id) {
    /** @type {{ flags: any[] | null, daily: any[], checkIns: any[], fromCache: Record<string, boolean>, stops: (() => void)[] }} */
    const entry = { flags: null, daily: [], checkIns: [], fromCache: {}, stops: [] };
    perPatient.set(id, entry);
    entry.stops.push(
      listen(
        fs,
        patientCollectionQuery(fs, db, id, "flags"),
        (snapshot) => {
          const current = docsOf(snapshot);
          const fresh = newRedFlags(entry.flags, current, { loadedAtMillis, joinedLate: !(firstIds?.has(id) ?? false) });
          entry.flags = current;
          entry.fromCache.flags = cached(snapshot);
          const name = docs?.find((d) => d.id === id)?.data?.displayName || "Unnamed patient";
          for (const f of fresh) newRed.push({ patientId: id, displayName: name, reason: f.reason });
          emit();
        },
        // Access ended (sharing withdrawn): the list drops the Patient; show the record until then.
        () => {
          entry.flags = null;
          emit();
        },
      ),
    );
    if (withSleep) {
      entry.stops.push(
        listen(
          fs,
          patientCollectionQuery(fs, db, id, "daily", fs.orderBy("date", "desc"), fs.limit(ROSTER_DAILY_DAYS)),
          (snapshot) => {
            entry.daily = docsOf(snapshot);
            entry.fromCache.daily = cached(snapshot);
            emit();
          },
          () => {
            entry.daily = [];
            emit();
          },
        ),
      );
    }
    if (withAssessment) {
      entry.stops.push(
        listen(
          fs,
          patientCollectionQuery(fs, db, id, "checkIns", fs.orderBy("startedAtMillis", "desc"), fs.limit(1)),
          (snapshot) => {
            entry.checkIns = docsOf(snapshot);
            entry.fromCache.checkIns = cached(snapshot);
            emit();
          },
          () => {
            entry.checkIns = [];
            emit();
          },
        ),
      );
    }
  }

  /** @param {string} id */
  function unwatch(id) {
    for (const stop of perPatient.get(id)?.stops ?? []) stop();
    perPatient.delete(id);
  }

  const patientsQuery = fs.query(
    fs.collection(db, "patients"),
    ...clinicianListFilters(clinicianEmail).map(([field, op, value]) => fs.where(field, op, value)),
  );
  const stopList = listen(
    fs,
    patientsQuery,
    (snapshot) => {
      const next = snapshot.docs.map((/** @type {any} */ d) => ({ id: d.id, data: d.data() }));
      const ids = new Set(next.map((/** @type {{ id: string }} */ d) => d.id));
      for (const id of [...perPatient.keys()]) {
        if (ids.has(id)) continue;
        unwatch(id);
        if (keepWithdrawn) withdrawn.add(id);
      }
      for (const id of ids) {
        withdrawn.delete(id);
        if (!perPatient.has(id)) watch(id);
      }
      docs = next;
      firstIds ??= ids;
      listFromCache = cached(snapshot);
      status = "ok";
      emit();
    },
    (error) => {
      for (const id of [...perPatient.keys()]) unwatch(id);
      docs = null;
      status = rosterStatusFromError(error);
      emit();
    },
  );

  emit();
  return () => {
    stopped = true;
    stopList();
    for (const id of [...perPatient.keys()]) unwatch(id);
  };
}

// ---------------------------------------------------------------------------------------------
// One Patient
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} PatientState
 * @property {"loading" | "ok" | "withdrawn" | "error"} status
 * @property {boolean} fromCache
 * @property {Record<string, boolean>} loaded which collections have answered
 * @property {ReturnType<typeof designPatient> | null} patient the design's object; the withdrawn
 *   placeholder while not sharing; null while loading or on error
 * @property {{ patient: object, flags: object[] | null } | null} raw the record and flags as stored,
 *   for `clearAttention`; null unless ok
 */

/** @param {string | string[]} sections */
function collectionsFor(sections) {
  const names = Array.isArray(sections) ? sections : [sections];
  /** @type {Set<string>} */
  const out = new Set();
  for (const name of names) {
    const collections = SECTION_COLLECTIONS[/** @type {keyof typeof SECTION_COLLECTIONS} */ (name)];
    if (!collections) throw new Error(`Unknown section: ${name}`);
    for (const c of collections) out.add(c);
  }
  return [...out];
}

/**
 * One Patient, live, as the design's patient object. Listens to the record and to the collections
 * the sections need (`SECTION_COLLECTIONS`); a collection not listened to is empty in the object.
 * While the Patient does not share, the collection listeners are stopped and the state is
 * "withdrawn" with the anonymous placeholder; they start again if the Patient shares again.
 * @param {FirestoreFns} fs
 * @param {unknown} db
 * @param {string} patientId
 * @param {{ sections?: string | string[], clock?: ClockFn }} options
 * @param {(state: PatientState) => void} onChange
 * @returns {() => void}
 */
export function subscribePatient(fs, db, patientId, options, onChange) {
  const { sections = "all", clock = systemClock } = options ?? {};
  const collections = collectionsFor(sections);
  /** @type {PatientState["status"]} */
  let status = "loading";
  /** @type {any} */
  let record = null;
  let recordFromCache = false;
  /** @type {Record<string, any[] | undefined>} */
  let data = {};
  /** @type {Record<string, boolean>} */
  let fromCache = {};
  /** @type {(() => void)[]} */
  let stops = [];
  let stopped = false;

  function emit() {
    if (stopped) return;
    /** @type {Record<string, boolean>} */
    const loaded = {};
    for (const c of collections) loaded[c] = data[c] !== undefined;
    const anyCache = recordFromCache || Object.values(fromCache).some(Boolean);
    if (status !== "ok") {
      onChange({ status, fromCache: anyCache, loaded, patient: status === "withdrawn" ? withdrawnPatient(patientId) : null, raw: null });
      return;
    }
    const patient = designPatient(
      {
        id: patientId,
        patient: record,
        // Until the flags load (or when a section does not listen to them), the record's level and
        // reasons stand in.
        flags: data.flags ?? null,
        daily: data.daily ?? [],
        checkIns: data.checkIns ?? [],
        summaries: data.summaries ?? [],
        suggestions: data.suggestions ?? [],
        visits: data.visits ?? [],
        digests: data.digests ?? [],
        consents: data.consents ?? null,
      },
      clock(),
    );
    onChange({ status, fromCache: anyCache, loaded, patient, raw: { patient: record, flags: data.flags ?? null } });
  }

  function start() {
    for (const name of collections) {
      const target =
        name === "digests"
          ? patientCollectionQuery(fs, db, patientId, name, fs.orderBy("isoWeek", "desc"), fs.limit(1))
          : patientCollectionQuery(fs, db, patientId, name);
      stops.push(
        listen(
          fs,
          target,
          (snapshot) => {
            data[name] = docsOf(snapshot);
            fromCache[name] = cached(snapshot);
            emit();
          },
          // Withdrawal reaches the record's listener too, which shows the withdrawn state.
          () => {
            data[name] = [];
            emit();
          },
        ),
      );
    }
  }

  function stopCollections() {
    for (const stop of stops) stop();
    stops = [];
    data = {};
    fromCache = {};
  }

  /** @param {import("./sharing.js").SharingViewState} state */
  function onRecord(state) {
    if (state.status === "ok") {
      record = state.patient;
      if (status !== "ok") start();
      status = "ok";
    } else {
      stopCollections();
      record = null;
      status = state.status;
    }
    emit();
  }

  const stopRecord = listen(
    fs,
    fs.doc(db, "patients", patientId),
    (snapshot) => {
      recordFromCache = cached(snapshot);
      onRecord(sharingStateFromSnapshot({ exists: snapshot.exists(), data: snapshot.data() }));
    },
    // The rules deny the read once the Patient stops sharing: the withdrawn state, not an error.
    (error) => onRecord(sharingStateFromError(/** @type {any} */ (error))),
  );

  emit();
  return () => {
    stopped = true;
    stopRecord();
    stopCollections();
  };
}

/** @param {"attention" | "overview" | "summaries" | "signals" | "intakeVisits" | "digest"} section */
const sectionSubscription =
  (section) =>
  /**
   * @param {FirestoreFns} fs @param {unknown} db @param {string} patientId
   * @param {{ clock?: ClockFn }} options @param {(state: PatientState) => void} onChange
   */
  (fs, db, patientId, options, onChange) =>
    subscribePatient(fs, db, patientId, { ...options, sections: section }, onChange);

/** The Attention block: level, open reasons, history, assessment. */
export const subscribeAttention = sectionSubscription("attention");
/** Overview: attention, timeline, latest Summary, what helps, the latest Digest. */
export const subscribeOverview = sectionSubscription("overview");
/** Summaries, the Digest and what helps. */
export const subscribeSummaries = sectionSubscription("summaries");
/** Signals: daily records, Consents and the Visit markers. */
export const subscribeSignals = sectionSubscription("signals");
/** Intake (from the record) and Visits. */
export const subscribeIntakeVisits = sectionSubscription("intakeVisits");
/** The latest Digest with its source Summaries. */
export const subscribeDigest = sectionSubscription("digest");

// ---------------------------------------------------------------------------------------------
// Writes and calls
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{ ok: true } & Record<string, unknown> | { ok: false, message: string, code?: string, invalid?: boolean, changed?: boolean }} ActionResult
 */

/**
 * Record a Visit from the design's form (`validateDesignVisit`), as the Clinician. The rules allow
 * the date, the kind and an integer score; nothing else changes, so the flag is untouched.
 * @param {FirestoreFns} fs @param {unknown} db @param {string} patientId
 * @param {{ date: string, type: string, score?: string | number | null }} form
 * @param {{ today: string, tms?: string | null, visits?: { id?: string, date: string }[] }} context
 * @returns {Promise<ActionResult>}
 */
export async function recordVisit(fs, db, patientId, form, context) {
  const checked = validateDesignVisit(form, context);
  if (!checked.ok) return { ok: false, message: checked.message, invalid: true };
  try {
    const ref = await /** @type {Function} */ (fs.addDoc)(fs.collection(db, "patients", patientId, "visits"), checked.visit);
    return { ok: true, id: ref.id, visit: checked.visit };
  } catch (error) {
    return { ok: false, message: writeErrorMessage(error), code: codeOf(error) };
  }
}

/**
 * Set the TMS end date (`validateDesignTms`), as the Clinician (rules: `clinicianUpdate`).
 * @param {FirestoreFns} fs @param {unknown} db @param {string} patientId @param {string} date
 * @param {{ today: string, visits?: { date: string }[] }} context
 * @returns {Promise<ActionResult>}
 */
export async function setTmsEndDate(fs, db, patientId, date, context) {
  const checked = validateDesignTms(date, context);
  if (!checked.ok) return { ok: false, message: checked.message, invalid: true };
  try {
    await /** @type {Function} */ (fs.updateDoc)(fs.doc(db, "patients", patientId), { tmsEndDate: checked.date });
    return { ok: true, date: checked.date };
  } catch (error) {
    return { ok: false, message: writeErrorMessage(error), code: codeOf(error) };
  }
}

/**
 * "Clear flag after action": clears the open flags the Clinician reviewed (all of them by default,
 * as the design does) in one transaction (`clearFlags` in clear.js). History is kept. A reason
 * raised during the review refuses the clear with `changed: true`, so the UI shows the new reason
 * for a new review instead of clearing it unseen. No note is stored (see the sync note).
 * @param {FirestoreFns} fs @param {unknown} db
 * @param {{ patientId: string, raw: { patient: any, flags: any[] | null }, flagIds?: string[], nowMillis: number }} request
 *   `raw` from the PatientState the Clinician reviewed
 * @returns {Promise<ActionResult>}
 */
export async function clearAttention(fs, db, { patientId, raw, flagIds, nowMillis }) {
  const flags = raw?.flags ?? [];
  const ids = flagIds ?? flags.filter(isOpen).map((f) => f.id);
  if (ids.length === 0) return { ok: false, message: LIVE_COPY.nothingOpen, invalid: true };
  try {
    const next = await clearFlags(/** @type {any} */ (fs), db, { patientId, flagIds: ids, reviewed: reviewOf(raw.patient, flags), nowMillis });
    return { ok: true, cleared: ids, ...next };
  } catch (error) {
    if (codeOf(error) === "flag/changed" || codeOf(error) === "flag/not-open") return { ok: false, changed: true, message: LIVE_COPY.changed, code: codeOf(error) };
    return { ok: false, message: clearErrorMessage(/** @type {any} */ (error)), code: codeOf(error) };
  }
}

/**
 * "Generate now". `calls` is `digestCalls(app)` from js/functions.js.
 * @param {{ generateDigest: (patientId: string) => Promise<{ digest: object }> }} calls
 * @param {string} patientId
 * @returns {Promise<ActionResult>}
 */
export async function generateDigestNow(calls, patientId) {
  try {
    const { digest } = await calls.generateDigest(patientId);
    return { ok: true, digest };
  } catch (error) {
    return { ok: false, message: digestErrorMessage(/** @type {any} */ (error)), code: codeOf(error) };
  }
}

/**
 * Extract Intake highlights from pasted text or a file's text (the report is never stored).
 * `calls` is `intakeCalls(app)` from js/functions.js.
 * @param {{ extract: (patientId: string, text: string) => Promise<{ highlights: string, trimmed: boolean }> }} calls
 * @param {string} patientId @param {string} reportText
 * @returns {Promise<ActionResult>}
 */
export async function extractIntake(calls, patientId, reportText) {
  const problem = reportProblem(reportText);
  if (problem) return { ok: false, message: problem, invalid: true };
  try {
    const result = await calls.extract(patientId, reportText);
    return { ok: true, highlights: highlightsList(result.highlights), text: result.highlights, trimmed: Boolean(result.trimmed) };
  } catch (error) {
    return { ok: false, message: intakeErrorMessage("extract", /** @type {any} */ (error)), code: codeOf(error) };
  }
}

/**
 * Save reviewed highlights, as a list (the design's preview) or as text.
 * @param {{ save: (patientId: string, highlights: string) => Promise<{ intakeHighlights: string }> }} calls
 * @param {string} patientId @param {string[] | string} highlights
 * @returns {Promise<ActionResult>}
 */
export async function saveIntake(calls, patientId, highlights) {
  const text = Array.isArray(highlights) ? highlightsText(highlights) : String(highlights ?? "");
  const problem = highlightsProblem(text);
  if (problem) return { ok: false, message: problem, invalid: true };
  try {
    const result = await calls.save(patientId, text);
    return { ok: true, highlights: highlightsList(result.intakeHighlights), text: result.intakeHighlights };
  } catch (error) {
    return { ok: false, message: intakeErrorMessage("save", /** @type {any} */ (error)), code: codeOf(error) };
  }
}
