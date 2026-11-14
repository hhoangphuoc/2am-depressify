import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { adminAlertStore, createAlertFunctions, dashboardUrlFromParams } from "./alertFunctions";
import { GEMINI_API_KEY, genaiTextClient } from "./gemini";
import { adminDigestStore, createDigestFunctions } from "./digestFunctions";
import { healthStatus } from "./health";
import { adminPatientStore, createIntakeFunctions } from "./intakeFunctions";
import { REGION } from "./region";

// All functions run in the Firestore database's region (src/region.ts).
setGlobalOptions({ region: REGION });

/**
 * The Admin SDK's Firestore on the default app, initialised on first use. Checks for the default
 * app by name: firebase-functions creates its own named app to build a Firestore trigger's
 * snapshot, so "any app exists" does not mean the default one does.
 */
function adminDb() {
  if (!getApps().some((app) => app.name === "[DEFAULT]")) initializeApp();
  return getFirestore();
}

/** Trivial liveness check for the walking skeleton. Logs nothing. */
export const health = onRequest((_request, response) => {
  response.json(healthStatus(Date.now()));
});

/** Intake (Clinician only): extract highlights from a pasted report, then save the reviewed ones. */
export const { extractIntake, saveIntake } = createIntakeFunctions({
  patients: () => adminPatientStore(adminDb()),
  textModel: () => genaiTextClient(GEMINI_API_KEY.value()),
});

/**
 * Weekly Digest: `weeklyDigest` runs Mondays 07:00 Europe/Helsinki for the previous ISO week;
 * `generateDigest` ("Generate now", Clinician only) covers the current week so far.
 */
export const { weeklyDigest, generateDigest } = createDigestFunctions({
  store: () => adminDigestStore(adminDb()),
  textModel: () => genaiTextClient(GEMINI_API_KEY.value()),
});

/**
 * Red flag alert: when a red flag the Clinician may see is created for a sharing Patient, writes
 * one email to `mail` for the Trigger Email extension to send.
 */
export const { redFlagAlert } = createAlertFunctions({
  store: () => adminAlertStore(adminDb()),
  dashboardUrl: dashboardUrlFromParams,
});
