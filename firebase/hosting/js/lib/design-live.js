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
  ROSTER_DAILY_DAYS,
  ROSTER_SIGNAL,
  designPatient,
  designRosterPatient,
  highlightsList,
  highlightsText,
  orderRoster,
  validateDesignTms,
  validateDesignVisit,
  withdrawnPatient,
} from "./design-model.js";

/** The roster reads this many of each Patient's latest daily records: 14 for the sparkline, 14 for its Baseline. */
export { ROSTER_DAILY_DAYS };

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
  notOpen: "This flag is no longer open, so there is nothing to clear.",
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
 * @property {Function} [setDoc]
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
 * True when a query snapshot repeats what was already applied: no document changed and `fromCache`
 * is the same (a metadata-only snapshot, which `includeMetadataChanges` also delivers). A snapshot
 * without `docChanges` (a document, or a stand-in) is never skipped here.
 * @param {any} snapshot @param {boolean} loaded @param {boolean | undefined} previousFromCache
 */
function repeats(snapshot, loaded, previousFromCache) {
  if (!loaded || typeof snapshot?.docChanges !== "function") return false;
  return snapshot.docChanges().length === 0 && cached(snapshot) === previousFromCache;
}

/**
 * @typedef {object} RosterState
 * @property {"loading" | "ok" | "denied" | "expired" | "error"} status
 * @property {boolean} fromCache true while any part is the SDK's saved copy
 * @property {ReturnType<typeof designRosterPatient>[]} patients light roster rows
 *   (`designRosterPatient`) in the design's order; pass to `rosterView`. A Patient whose data did not
 *   change keeps the same object from one state to the next.
 * @property {{ patientId: string, displayName: string, reason: string }[]} newRed red flags that arrived
 *   since the last update (never on the first load); for the sound and the announcement
 * @property {number} updatedAtMillis
 */

/**
 * @typedef {object} RosterEntry one listed Patient's sources and its cached roster row
 * @property {any} record the Patient record's data
 * @property {string} recordKey the record as JSON, to see whether a list snapshot changed it
 * @property {any[] | null} flags null until loaded, or after an error (the record stands in)
 * @property {any[]} daily
 * @property {any[]} checkIns
 * @property {{ granted?: unknown } | null | undefined} sleepConsent undefined until loaded
 * @property {string | undefined} sleepConsentKey
 * @property {Record<string, boolean>} fromCache
 * @property {Record<string, boolean>} loaded
 * @property {(() => void)[]} stops
 * @property {ReturnType<typeof designRosterPatient> | null} model the cached row; null to rebuild
 * @property {number} modelAtMillis
 */

/**
 * The Clinician's Patients, live, as light roster rows (`designRosterPatient`): the attention level,
 * the open flags, the last 28 days of sleep (only while the Patient's sleep Consent is granted) and
 * the latest Check-in's assessment. Only the Patient whose snapshot changed is rebuilt; the rows of
 * the others are reused, and metadata-only snapshots that do not change `fromCache` are skipped.
 * @param {FirestoreFns} fs
 * @param {unknown} db
 * @param {{ clinicianEmail: string, clock?: ClockFn, withSleep?: boolean, withAssessment?: boolean, keepWithdrawn?: boolean, refreshMillis?: number }} options
 *   `keepWithdrawn`: a Patient who leaves the list in this session (sharing withdrawn) stays as an
 *   anonymous "sharing withdrawn" row with no data, until the page reloads.
 *   `refreshMillis`: a cached row older than this is rebuilt on the next update, so its relative
 *   times ("2 hours ago") and dates move on (default one minute).
 * @param {(state: RosterState) => void} onChange
 * @returns {() => void} stops every listener
 */
export function subscribeRoster(fs, db, options, onChange) {
  const { clinicianEmail, clock = systemClock, withSleep = true, withAssessment = true, keepWithdrawn = false, refreshMillis = 60_000 } = options;
  const loadedAtMillis = clock().nowMillis;
  /** @type {RosterState["status"]} */
  let status = "loading";
  /** @type {string[]} the listed Patients, in the list's order */
  let order = [];
  let listLoaded = false;
  let listFromCache = false;
  /** @type {Set<string> | null} */
  let firstIds = null;
  /** @type {Map<string, RosterEntry>} */
  const perPatient = new Map();
  /** @type {Map<string, ReturnType<typeof withdrawnPatient>>} */
  const withdrawn = new Map();
  /** @type {RosterState["newRed"]} */
  let newRed = [];
  let stopped = false;

  /** @param {string} id @param {number} nowMillis @param {string | undefined} timeZone */
  function rowOf(id, nowMillis, timeZone) {
    const entry = /** @type {RosterEntry} */ (perPatient.get(id));
    if (!entry.model || nowMillis - entry.modelAtMillis >= refreshMillis) {
      entry.model = designRosterPatient(
        {
          id,
          patient: entry.record,
          flags: entry.flags,
          daily: entry.daily,
          checkIns: entry.checkIns,
          // Without the sleep listeners there is no sparkline: treat it as not granted.
          sleepConsent: withSleep ? entry.sleepConsent : null,
        },
        { nowMillis, timeZone },
        { maxDays: ROSTER_DAILY_DAYS },
      );
      entry.modelAtMillis = nowMillis;
    }
    return entry.model;
  }

  function emit() {
    if (stopped) return;
    const { nowMillis, timeZone } = clock();
    const live = status === "ok" ? order.map((id) => rowOf(id, nowMillis, timeZone)) : [];
    const patients = orderRoster([...live, ...withdrawn.values()]);
    const fromCache = listFromCache || [...perPatient.values()].some((p) => Object.values(p.fromCache).some(Boolean));
    const changes = newRed;
    newRed = [];
    onChange({ status, fromCache, patients, newRed: changes, updatedAtMillis: nowMillis });
  }

  /**
   * Listens to one collection query of one Patient. Metadata-only snapshots are skipped; on an
   * error, `failed` decides what the entry keeps.
   * @param {RosterEntry} entry @param {string} name @param {unknown} target
   * @param {(snapshot: any) => void} apply @param {() => void} failed
   */
  function listenPart(entry, name, target, apply, failed) {
    entry.stops.push(
      listen(
        fs,
        target,
        (snapshot) => {
          if (repeats(snapshot, entry.loaded[name], entry.fromCache[name])) return;
          apply(snapshot);
          entry.loaded[name] = true;
          entry.fromCache[name] = cached(snapshot);
          entry.model = null;
          emit();
        },
        // Access ended (sharing withdrawn), or another error: the list drops a withdrawn Patient;
        // until then show the record, never data that may no longer be shared.
        () => {
          failed();
          entry.loaded[name] = false;
          entry.fromCache[name] = false;
          entry.model = null;
          emit();
        },
      ),
    );
  }

  /** @param {string} id @param {any} record */
  function watch(id, record) {
    /** @type {RosterEntry} */
    const entry = { record, recordKey: JSON.stringify(record), flags: null, daily: [], checkIns: [], sleepConsent: undefined, sleepConsentKey: undefined, fromCache: {}, loaded: {}, stops: [], model: null, modelAtMillis: 0 };
    perPatient.set(id, entry);
    listenPart(
      entry,
      "flags",
      patientCollectionQuery(fs, db, id, "flags"),
      (snapshot) => {
        const current = docsOf(snapshot);
        const fresh = newRedFlags(entry.flags, current, { loadedAtMillis, joinedLate: !(firstIds?.has(id) ?? false) });
        entry.flags = current;
        const name = entry.record?.displayName || "Unnamed patient";
        for (const f of fresh) newRed.push({ patientId: id, displayName: name, reason: f.reason });
      },
      () => {
        entry.flags = null;
      },
    );
    if (withSleep) {
      listenPart(
        entry,
        "daily",
        patientCollectionQuery(fs, db, id, "daily", fs.orderBy("date", "desc"), fs.limit(ROSTER_DAILY_DAYS)),
        (snapshot) => {
          entry.daily = docsOf(snapshot);
        },
        () => {
          entry.daily = [];
        },
      );
      // The sleep Signal's Consent (`consents/{subject}`, not stamped): sleep shows only while it is
      // granted. No document means not granted; until it answers, the Consent is unknown.
      entry.stops.push(
        listen(
          fs,
          fs.doc(db, "patients", id, "consents", ROSTER_SIGNAL),
          (snapshot) => {
            const consent = snapshot.exists() ? (snapshot.data() ?? null) : null;
            const key = JSON.stringify(consent);
            const fromCache = cached(snapshot);
            if (key === entry.sleepConsentKey && fromCache === entry.fromCache.consent) return;
            entry.sleepConsent = consent;
            entry.sleepConsentKey = key;
            entry.fromCache.consent = fromCache;
            entry.model = null;
            emit();
          },
          () => {
            entry.sleepConsent = null;
            entry.sleepConsentKey = undefined;
            entry.fromCache.consent = false;
            entry.model = null;
            emit();
          },
        ),
      );
    }
    if (withAssessment) {
      listenPart(
        entry,
        "checkIns",
        patientCollectionQuery(fs, db, id, "checkIns", fs.orderBy("startedAtMillis", "desc"), fs.limit(1)),
        (snapshot) => {
          entry.checkIns = docsOf(snapshot);
        },
        () => {
          entry.checkIns = [];
        },
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
      if (repeats(snapshot, listLoaded, listFromCache)) return;
      const next = snapshot.docs.map((/** @type {any} */ d) => ({ id: d.id, data: d.data() }));
      const ids = new Set(next.map((/** @type {{ id: string }} */ d) => d.id));
      for (const id of [...perPatient.keys()]) {
        if (ids.has(id)) continue;
        unwatch(id);
        if (keepWithdrawn) withdrawn.set(id, withdrawnPatient(id));
      }
      for (const { id, data } of next) {
        withdrawn.delete(id);
        const entry = perPatient.get(id);
        if (!entry) {
          watch(id, data);
          continue;
        }
        const key = JSON.stringify(data);
        if (key !== entry.recordKey) {
          entry.record = data;
          entry.recordKey = key;
          entry.model = null;
        }
      }
      order = next.map((/** @type {{ id: string }} */ d) => d.id);
      firstIds ??= ids;
      listLoaded = true;
      listFromCache = cached(snapshot);
      status = "ok";
      emit();
    },
    (error) => {
      for (const id of [...perPatient.keys()]) unwatch(id);
      order = [];
      listLoaded = false;
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

/** After the rules refuse the record (sharing withdrawn), check again after these delays; the last repeats. */
export const RECHECK_DELAYS_MILLIS = Object.freeze([5_000, 15_000, 60_000]);

/**
 * @typedef {object} PatientState
 * @property {"loading" | "ok" | "withdrawn" | "error"} status
 * @property {boolean} fromCache
 * @property {Record<string, boolean>} loaded which collections have answered
 * @property {Record<string, "denied" | "error">} errors collections whose listener failed: "denied"
 *   is the rules refusing the read (sharing withdrawn; the record's listener shows that), "error"
 *   anything else. A failed collection stays unloaded (null in `docs`), never empty.
 * @property {Record<string, object[] | null>} docs each listened collection's documents as stored
 *   (`{ id, ...data }`), null until loaded or after an error; for blocks that work on documents
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

/** @typedef {{ setTimeout: (fn: () => void, ms: number) => unknown, clearTimeout: (id: any) => void }} Timers */

/** @type {Timers} */
const systemTimers = { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };

/**
 * One Patient, live, as the design's patient object. Listens to the record and to the collections
 * the sections need (`SECTION_COLLECTIONS`); a collection not listened to is empty in the object.
 * While the Patient does not share, the collection listeners are stopped and the state is
 * "withdrawn" with the anonymous placeholder; they start again if the Patient shares again. A Demo
 * Patient's record stays readable, so its listener sees that at once. For any other Patient the
 * rules refuse the record and the SDK ends the listener, so it listens again after
 * `RECHECK_DELAYS_MILLIS` (5 s, 15 s, then every minute) until the Patient shares or `stop()`.
 *
 * A collection listener that fails leaves its collection unloaded and sets `errors[name]`; a failed
 * flags query never reads as "no flags": the record's stored level and reasons stand in, and
 * `patient.flagsError` is true unless the failure was a withdrawal.
 * @param {FirestoreFns} fs
 * @param {unknown} db
 * @param {string} patientId
 * @param {{ sections?: string | string[], clock?: ClockFn, timers?: Timers, recheckDelaysMillis?: readonly number[] }} options
 * @param {(state: PatientState) => void} onChange
 * @returns {() => void}
 */
export function subscribePatient(fs, db, patientId, options, onChange) {
  const { sections = "all", clock = systemClock, timers = systemTimers, recheckDelaysMillis = RECHECK_DELAYS_MILLIS } = options ?? {};
  const collections = collectionsFor(sections);
  /** @type {PatientState["status"]} */
  let status = "loading";
  /** @type {any} */
  let record = null;
  /** @type {string | undefined} */
  let recordKey;
  let recordFromCache = false;
  /** @type {Record<string, any[] | undefined>} */
  let data = {};
  /** @type {Record<string, boolean>} */
  let fromCache = {};
  /** @type {Record<string, "denied" | "error">} */
  let errors = {};
  /** @type {(() => void)[]} */
  let stops = [];
  let stopped = false;
  /** @type {(() => void) | null} */
  let stopRecord = null;
  /** @type {unknown} */
  let recheckTimer = null;
  let rechecks = 0;

  function emit() {
    if (stopped) return;
    /** @type {Record<string, boolean>} */
    const loaded = {};
    /** @type {Record<string, object[] | null>} */
    const docs = {};
    for (const c of collections) {
      loaded[c] = data[c] !== undefined;
      docs[c] = data[c] ?? null;
    }
    const anyCache = recordFromCache || Object.values(fromCache).some(Boolean);
    const errorsNow = { ...errors };
    if (status !== "ok") {
      onChange({ status, fromCache: anyCache, loaded, errors: errorsNow, docs, patient: status === "withdrawn" ? withdrawnPatient(patientId) : null, raw: null });
      return;
    }
    const patient = designPatient(
      {
        id: patientId,
        patient: record,
        // Until the flags load, after a failed load, or when a section does not listen to them, the
        // record's level and reasons stand in.
        flags: data.flags ?? null,
        flagsError: errors.flags === "error",
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
    onChange({ status, fromCache: anyCache, loaded, errors: errorsNow, docs, patient, raw: { patient: record, flags: data.flags ?? null } });
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
            if (repeats(snapshot, data[name] !== undefined, fromCache[name])) return;
            data[name] = docsOf(snapshot);
            fromCache[name] = cached(snapshot);
            delete errors[name];
            emit();
          },
          // Only permission-denied is a withdrawal (the record's listener then shows it). Either
          // way the collection is unloaded, never empty: no flags must not read as green.
          (error) => {
            delete data[name];
            delete fromCache[name];
            errors[name] = codeOf(error) === "permission-denied" ? "denied" : "error";
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
    errors = {};
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
      recordKey = undefined;
      status = state.status;
    }
    emit();
  }

  function listenRecord() {
    recheckTimer = null;
    stopRecord = listen(
      fs,
      fs.doc(db, "patients", patientId),
      (snapshot) => {
        const exists = snapshot.exists();
        const value = snapshot.data();
        const key = JSON.stringify([exists, value]);
        const fromCacheNow = cached(snapshot);
        // A metadata-only snapshot of an unchanged record.
        if (status !== "loading" && key === recordKey && fromCacheNow === recordFromCache) return;
        recordKey = key;
        recordFromCache = fromCacheNow;
        const state = sharingStateFromSnapshot({ exists, data: value });
        if (state.status === "ok") rechecks = 0;
        onRecord(state);
      },
      // The rules deny the read once the Patient stops sharing: the withdrawn state, not an error.
      // The SDK has ended this listener, so check again later in case the Patient shares again.
      (error) => {
        stopRecord = null;
        const state = sharingStateFromError(/** @type {any} */ (error));
        onRecord(state);
        if (state.status === "withdrawn" && !stopped) {
          const delay = recheckDelaysMillis[Math.min(rechecks, recheckDelaysMillis.length - 1)];
          rechecks += 1;
          recheckTimer = timers.setTimeout(() => {
            if (!stopped) listenRecord();
          }, delay);
        }
      },
    );
  }

  listenRecord();
  emit();
  return () => {
    stopped = true;
    if (recheckTimer !== null) timers.clearTimeout(recheckTimer);
    recheckTimer = null;
    stopRecord?.();
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
 * @typedef {{ ok: true } & Record<string, unknown> | { ok: false, message: string, code?: string, invalid?: boolean, errors?: Record<string, string>, changed?: boolean, notOpen?: boolean }} ActionResult
 */

/**
 * Record a Visit from the design's form (`validateDesignVisit`), as the Clinician, or edit one
 * (`context.editingId`). The rules allow the date, the kind and an integer score; nothing else
 * changes, so the flag is untouched. An invalid form returns `invalid: true` and `errors` by field
 * (`date`, `questionnaire`, `score`), so the form can focus the field.
 * @param {FirestoreFns} fs @param {unknown} db @param {string} patientId
 * @param {{ date: string, type: string, score?: string | number | null }} form
 * @param {{ today: string, tms?: string | null, visits?: { id?: string, date: string }[], editingId?: string | null }} context
 * @returns {Promise<ActionResult>}
 */
export async function recordVisit(fs, db, patientId, form, context) {
  const checked = validateDesignVisit(form, context);
  if (!checked.ok) return { ok: false, message: checked.message, invalid: true, errors: checked.errors ?? {} };
  try {
    const editingId = context?.editingId ?? null;
    if (editingId) {
      await /** @type {Function} */ (fs.setDoc)(fs.doc(db, "patients", patientId, "visits", editingId), checked.visit);
      return { ok: true, id: editingId, visit: checked.visit };
    }
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
 * as the design does, or `flagIds`) in one transaction (`clearFlags` in clear.js). History is kept.
 * A reason raised during the review refuses the clear with `changed: true`, so the UI shows the new
 * reason for a new review instead of clearing it unseen. A flag that is no longer open refuses with
 * `notOpen: true`. No note is stored (see the sync note).
 * @param {FirestoreFns} fs @param {unknown} db
 * @param {{ patientId: string, raw: { patient: any, flags: any[] | null }, flagIds?: string[], reviewed?: import("./clear.js").Review, nowMillis: number }} request
 *   `raw` from the PatientState the Clinician reviewed; `reviewed` the review the Clinician
 *   confirmed (`reviewOf`), when it was taken earlier than `raw` (a dialog open during updates)
 * @returns {Promise<ActionResult>}
 */
export async function clearAttention(fs, db, { patientId, raw, flagIds, reviewed, nowMillis }) {
  const flags = raw?.flags ?? [];
  const ids = flagIds ?? flags.filter(isOpen).map((f) => f.id);
  if (ids.length === 0) return { ok: false, message: LIVE_COPY.nothingOpen, invalid: true };
  try {
    const next = await clearFlags(/** @type {any} */ (fs), db, { patientId, flagIds: ids, reviewed: reviewed ?? reviewOf(raw?.patient ?? {}, flags), nowMillis });
    return { ok: true, cleared: ids, ...next };
  } catch (error) {
    const code = codeOf(error);
    if (code === "flag/changed") return { ok: false, changed: true, message: LIVE_COPY.changed, code };
    if (code === "flag/not-open") return { ok: false, notOpen: true, message: LIVE_COPY.notOpen, code };
    return { ok: false, message: clearErrorMessage(/** @type {any} */ (error)), code };
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
