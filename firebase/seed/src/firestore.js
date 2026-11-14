// The Firestore side of the seed: delete every Demo Patient, then write the generated ones. Uses
// the Admin SDK, which bypasses the security rules (clients may not create synthetic records).

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */
/** @typedef {import("firebase-admin/firestore").DocumentData} DocumentData */
/** @typedef {import("./generate.js").DemoPatient} DemoPatient */
/** @typedef {import("./generate.js").SeedOptions} SeedOptions */

import { DEMO_CLINICIAN_EMAIL, generateDemoPatients } from "./generate.js";

export const PATIENTS = "patients";
/** The allowlist of Clinicians a new Patient may link to, keyed by email. */
export const CLINICIANS = "clinicians";

/** The collections under a Patient record that the seed writes, by DemoPatient field. */
export const SEEDED_COLLECTIONS = /** @type {const} */ ([
  "daily",
  "consents",
  "checkIns",
  "summaries",
  "suggestions",
  "flags",
  "visits",
]);

/**
 * Deletes every Patient marked synthetic, with everything under it. Live Patients are untouched.
 * @param {Firestore} db
 * @returns {Promise<string[]>} the deleted Patient ids
 */
export async function deleteDemoPatients(db) {
  const snapshot = await db.collection(PATIENTS).where("synthetic", "==", true).get();
  for (const doc of snapshot.docs) await db.recursiveDelete(doc.ref);
  return snapshot.docs.map((doc) => doc.id).sort();
}

/**
 * @param {Firestore} db
 * @param {DemoPatient[]} patients
 * @returns {Promise<number>} documents written
 */
export async function writeDemoPatients(db, patients) {
  const writer = db.bulkWriter();
  let written = 0;
  for (const demo of patients) {
    const ref = db.collection(PATIENTS).doc(demo.id);
    writer.set(ref, demo.patient);
    written++;
    for (const name of SEEDED_COLLECTIONS) {
      for (const entry of demo[name]) {
        writer.set(ref.collection(name).doc(entry.id), /** @type {DocumentData} */ (/** @type {unknown} */ (entry.data)));
        written++;
      }
    }
  }
  await writer.close();
  return written;
}

/**
 * Adds a Clinician to the allowlist, so the rules let a new Patient link to them. Writing it again
 * changes nothing.
 * @param {Firestore} db
 * @param {string} email trimmed and lower case (see `clinicianEmail` in cli.js)
 */
export async function allowClinician(db, email) {
  await db.collection(CLINICIANS).doc(email).set({ email });
}

/**
 * Deletes the previous Demo Patients, writes new ones for `options.today`, and allows their
 * Clinician.
 * @param {Firestore} db
 * @param {SeedOptions} options
 */
export async function reseed(db, options) {
  const clinicianEmail = options.clinicianEmail ?? DEMO_CLINICIAN_EMAIL;
  const patients = generateDemoPatients({ ...options, clinicianEmail });
  const deleted = await deleteDemoPatients(db);
  const documents = await writeDemoPatients(db, patients);
  await allowClinician(db, clinicianEmail);
  return { deleted, created: patients.map((p) => p.id), documents, allowed: clinicianEmail };
}
