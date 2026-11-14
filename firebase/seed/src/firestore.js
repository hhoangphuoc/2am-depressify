// The Firestore side of the seed: delete every Demo Patient, then write the generated ones. Uses
// the Admin SDK, which bypasses the security rules (clients may not create synthetic records).

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */
/** @typedef {import("firebase-admin/firestore").DocumentData} DocumentData */
/** @typedef {import("./generate.js").DemoPatient} DemoPatient */
/** @typedef {import("./generate.js").SeedOptions} SeedOptions */

import { generateDemoPatients } from "./generate.js";

export const PATIENTS = "patients";

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
 * Deletes the previous Demo Patients and writes new ones for `options.today`.
 * @param {Firestore} db
 * @param {SeedOptions} options
 */
export async function reseed(db, options) {
  const patients = generateDemoPatients(options);
  const deleted = await deleteDemoPatients(db);
  const documents = await writeDemoPatients(db, patients);
  return { deleted, created: patients.map((p) => p.id), documents };
}
