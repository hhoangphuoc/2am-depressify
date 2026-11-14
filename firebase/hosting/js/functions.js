// Callable functions for the dashboard. Served locally (localhost), it talks to the Functions
// emulator; deployed, to the project's functions in their region (REGION in firebase/functions/src/region.ts,
// kept in step by firebase/functions/test/region.test.ts).
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-functions.js";
import { emulatorHostFor } from "./lib/auth.js";

export const FUNCTIONS_REGION = "europe-north1";

let functions = null;

function functionsFor(app) {
  if (!functions) {
    functions = getFunctions(app, FUNCTIONS_REGION);
    const emulatorHost = emulatorHostFor(window.location.hostname);
    if (emulatorHost) connectFunctionsEmulator(functions, emulatorHost, 5001);
  }
  return functions;
}

/**
 * The Intake callables. Both reject with a Firebase Functions error whose `code` the page maps to
 * vetted copy (js/lib/intake.js); the raw message is never shown.
 * @param {import("firebase/app").FirebaseApp} app
 */
export function intakeCalls(app) {
  const extractIntake = httpsCallable(functionsFor(app), "extractIntake");
  const saveIntake = httpsCallable(functionsFor(app), "saveIntake");
  return {
    /** @returns {Promise<{ highlights: string, wordCount: number, trimmed: boolean }>} */
    extract: async (patientId, reportText) => (await extractIntake({ patientId, reportText })).data,
    /** @returns {Promise<{ intakeHighlights: string, wordCount: number }>} */
    save: async (patientId, highlights) => (await saveIntake({ patientId, highlights })).data,
  };
}

/**
 * The weekly Digest's "Generate now" (Clinician only). Writes this ISO week's Digest so far and
 * returns it. Rejects with a Firebase Functions error whose `code` js/lib/digest.js maps to vetted copy.
 * @param {import("firebase/app").FirebaseApp} app
 */
export function digestCalls(app) {
  const generateDigest = httpsCallable(functionsFor(app), "generateDigest");
  return {
    /** @returns {Promise<{ digest: import("./lib/contract.js").Digest }>} */
    generateDigest: async (patientId) => (await generateDigest({ patientId })).data,
  };
}
