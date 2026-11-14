// Callable functions for the dashboard. Served locally (localhost), it talks to the Functions
// emulator; deployed, to the project's functions in the same region as firebase/functions/src/index.ts.
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-functions.js";
import { emulatorHostFor } from "./lib/auth.js";

export const FUNCTIONS_REGION = "europe-west1";

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
