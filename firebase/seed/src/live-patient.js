// The live demo Patient: one real test account (not synthetic) given six weeks of invented history
// by the shared generator, so the Companion and "what seems to help" have context. Unlike the Demo
// Patients, this record is only readable by its owner and their Clinician, and alerts apply.
//
// How the mock history is marked, so `--reset` deletes exactly it and never what the app or the
// functions write later:
//   - daily records carry the contract's `demoOverride: true` (the app writes `false`);
//   - Check-ins, Summaries, Suggestions, flags and Visits have ids starting `demo-` (the app and
//     functions use random ids, `crisis-<millis>` and `silent-<millis>`);
//   - Consents and the Patient record are rewritten on every run, never deleted;
//   - digests are never written or deleted here (the Digest function makes them).
import { levelAfterClearing } from "../../hosting/js/lib/clear.js";
import { CLINICIANS, PATIENTS, SEEDED_COLLECTIONS } from "./firestore.js";
import { MOCK_ID_PREFIX, makePatient } from "./generate.js";
import { PROFILES } from "./profiles.js";

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */
/** @typedef {import("firebase-admin/firestore").DocumentData} DocumentData */
/** @typedef {import("firebase-admin/firestore").DocumentReference} DocumentReference */
/** @typedef {import("firebase-admin/auth").Auth} Auth */
/** @typedef {import("../../functions/src/types.ts").Flag} Flag */
/** @typedef {import("../../functions/src/types.ts").PatientDoc} PatientDoc */
/** @typedef {import("./generate.js").DemoPatient} DemoPatient */
/** @typedef {(typeof SEEDED_COLLECTIONS)[number]} SeededCollection */

export { MOCK_ID_PREFIX };

/** Neutral and invented; `--display-name` gives another. */
export const LIVE_DEFAULT_DISPLAY_NAME = PROFILES.live.displayName;

/** The collections whose mock documents carry an id prefix. */
const PREFIXED = new Set(["checkIns", "summaries", "suggestions", "flags", "visits"]);

/**
 * @typedef {object} LiveOptions
 * @property {string} patientId the account's auth uid
 * @property {string} clinicianEmail
 * @property {string} today yyyy-MM-dd, the last day of history
 * @property {number} [nowMillis] defaults to noon on `today`
 * @property {number} [seed]
 * @property {string} [displayName]
 */

/**
 * The live demo Patient's documents. Pure: same inputs, same output.
 * @param {LiveOptions} options
 * @returns {DemoPatient}
 */
export function makeLivePatient(options) {
  const { patientId, clinicianEmail, today, nowMillis, seed, displayName } = options;
  return makePatient("live", { patientId, clinicianEmail, today, nowMillis, seed, displayName: displayName ?? LIVE_DEFAULT_DISPLAY_NAME });
}

/**
 * Whether a stored document is part of the mock history (and so deleted by `--reset`).
 * @param {string} collection
 * @param {string} id
 * @param {DocumentData | undefined} data
 */
export function isMockEntry(collection, id, data) {
  if (collection === "daily") return data?.demoOverride === true;
  return PREFIXED.has(collection) && id.startsWith(MOCK_ID_PREFIX);
}

/** @param {unknown} value @returns {value is number} */
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * What the app or the functions wrote for this Patient, outside the mock history.
 * @typedef {object} AppWritten
 * @property {(Partial<Flag> & { id: string })[]} flags
 * @property {{ endedAtMillis?: unknown }[]} checkIns
 */

/**
 * The Patient record to write: the generated one, with the level and reasons of every open flag
 * the Clinician can see (the app's too, such as a crisis flag) and the latest Check-in kept.
 * @param {DemoPatient} generated
 * @param {AppWritten} app
 * @returns {PatientDoc}
 */
export function recordAfterSeeding(generated, app) {
  const flags = [...generated.flags.map((f) => ({ id: f.id, ...f.data })), ...app.flags].filter((f) => f.sharedWithClinician === true);
  const { flagLevel, flagReasons } = levelAfterClearing(flags, []);
  const ends = app.checkIns.map((c) => c.endedAtMillis).filter(isNumber);
  const seeded = generated.patient.lastCheckInAtMillis;
  const lastCheckInAtMillis = ends.length === 0 ? seeded : Math.max(seeded ?? 0, ...ends);
  return { ...generated.patient, flagLevel, flagReasons, lastCheckInAtMillis };
}

/**
 * An email for a log line, with only its first letters: "p•••@e•••.com".
 * @param {string} email
 */
export function maskEmail(email) {
  const [local = "", domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}•••@${name.slice(0, 1)}•••${tld}`;
}

// ---------------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------------

/**
 * Finds the Patient's account by email, or creates it with a verified email and no password (the
 * Patient signs in with Google, or sets a password with a reset email). Sets no custom claims.
 * On an existing account it marks the email verified and sets the display name when they differ,
 * so a rerun with --display-name keeps the account and the Patient record in step.
 * @param {Auth} auth
 * @param {string} email
 * @param {string} displayName
 * @returns {Promise<{ uid: string, created: boolean, verifiedNow: boolean, renamed: boolean }>}
 */
export async function ensurePatientUser(auth, email, displayName) {
  /** @type {import("firebase-admin/auth").UserRecord | null} */
  let user = null;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code !== "auth/user-not-found") throw error;
  }
  if (user === null) {
    const created = await auth.createUser({ email, emailVerified: true, displayName });
    return { uid: created.uid, created: true, verifiedNow: false, renamed: false };
  }
  if (user.customClaims?.role === "clinician") {
    throw new Error("That account has the Clinician role; a Clinician's account is never made a Patient.");
  }
  /** @type {{ emailVerified?: boolean, displayName?: string }} */
  const update = {};
  if (!user.emailVerified) update.emailVerified = true;
  if (user.displayName !== displayName) update.displayName = displayName;
  if (Object.keys(update).length > 0) await auth.updateUser(user.uid, update);
  return { uid: user.uid, created: false, verifiedNow: !user.emailVerified, renamed: "displayName" in update };
}

// ---------------------------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------------------------

/**
 * Whether the Clinician is allowed, and whether the Patient's email is itself an allowed Clinician.
 * @param {Firestore} db
 * @param {string} patientEmail
 * @param {string} clinicianEmail
 */
export async function allowlistState(db, patientEmail, clinicianEmail) {
  const [clinician, patient] = await Promise.all([
    db.collection(CLINICIANS).doc(clinicianEmail).get(),
    db.collection(CLINICIANS).doc(patientEmail).get(),
  ]);
  return { clinicianAllowed: clinician.exists, patientIsClinician: patient.exists };
}

/** @returns {Record<SeededCollection, number>} */
const zeroCounts = () => /** @type {Record<SeededCollection, number>} */ (Object.fromEntries(SEEDED_COLLECTIONS.map((name) => [name, 0])));

/**
 * What is stored for the Patient now: the record, the mock history, and what the app wrote.
 * @param {Firestore} db
 * @param {string} patientId
 */
export async function readPatientState(db, patientId) {
  const ref = db.collection(PATIENTS).doc(patientId);
  const record = await ref.get();
  /** @type {{ name: SeededCollection, ref: DocumentReference }[]} */
  const mock = [];
  /** @type {AppWritten & { dailyDates: Set<string> }} */
  const app = { flags: [], checkIns: [], dailyDates: new Set() };
  for (const name of SEEDED_COLLECTIONS) {
    if (name === "consents") continue;
    const snapshot = await ref.collection(name).get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (isMockEntry(name, doc.id, data)) mock.push({ name, ref: doc.ref });
      else if (name === "flags") app.flags.push({ id: doc.id, ...data });
      else if (name === "checkIns") app.checkIns.push(data);
      else if (name === "daily") app.dailyDates.add(doc.id);
    }
  }
  return { record: record.exists ? /** @type {Partial<PatientDoc>} */ (record.data()) : undefined, mock, app };
}

/**
 * A red flag on a real Patient emails the Clinician. The tests keep the default seed free of them;
 * an unlucky --seed is refused rather than written.
 * @param {DemoPatient} generated
 */
export function refuseRedFlags(generated) {
  if (generated.flags.some((f) => f.data.level === "red")) {
    throw new Error("This --seed gives a red flag, which would email the Clinician; use another --seed.");
  }
}

/**
 * Writes the live demo Patient. Refuses a history with a red flag and a Demo Patient's record, and
 * refuses to write over mock history unless `reset` is set, in which case that history is deleted first. Daily records the
 * app wrote (`demoOverride: false`) are kept, and the generated record for that date is skipped.
 * @param {Firestore} db
 * @param {DemoPatient} generated
 * @param {{ reset: boolean }} options
 */
export async function seedLivePatient(db, generated, { reset }) {
  refuseRedFlags(generated);
  const state = await readPatientState(db, generated.id);
  if (state.record?.synthetic === true) throw new Error(`Patient ${generated.id} is a Demo Patient (synthetic); refusing.`);
  if (state.mock.length > 0 && !reset) {
    throw new Error(`Patient ${generated.id} already has mock history (${state.mock.length} documents). Pass --reset to delete and recreate it.`);
  }

  const deleted = zeroCounts();
  if (state.mock.length > 0) {
    const writer = db.bulkWriter();
    for (const { name, ref } of state.mock) {
      writer.delete(ref);
      deleted[name]++;
    }
    await writer.close();
  }

  const written = zeroCounts();
  let keptDaily = 0;
  const ref = db.collection(PATIENTS).doc(generated.id);
  const writer = db.bulkWriter();
  const record = recordAfterSeeding(generated, state.app);
  writer.set(ref, /** @type {DocumentData} */ (/** @type {unknown} */ (record)), { merge: true });
  for (const name of SEEDED_COLLECTIONS) {
    for (const entry of generated[name]) {
      if (name === "daily" && state.app.dailyDates.has(entry.id)) {
        keptDaily++;
        continue;
      }
      writer.set(ref.collection(name).doc(entry.id), /** @type {DocumentData} */ (/** @type {unknown} */ (entry.data)));
      written[name]++;
    }
  }
  await writer.close();
  return {
    deleted,
    written,
    keptDaily,
    appFlags: state.app.flags.length,
    appCheckIns: state.app.checkIns.length,
    flagLevel: record.flagLevel,
    openFlagIds: generated.flags.filter((f) => f.data.clearedAtMillis === null).map((f) => f.id),
  };
}
