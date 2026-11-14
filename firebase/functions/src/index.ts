import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { createCheckInFunctions } from "./checkInFunctions";
import { GEMINI_API_KEY, genaiTextClient, genaiTokenClient } from "./gemini";
import { adminDigestStore, createDigestFunctions } from "./digestFunctions";
import { healthStatus } from "./health";
import { adminPatientStore, createIntakeFunctions } from "./intakeFunctions";
import { REGION } from "./region";

// All functions run in the Firestore database's region (src/region.ts).
setGlobalOptions({ region: REGION });

/** The Admin SDK's Firestore, initialised on first use. */
function adminDb() {
  if (getApps().length === 0) initializeApp();
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

/** Start Check-in (the Patient): a single-use Gemini Live token locked to the Companion's setup. */
export const { startCheckIn } = createCheckInFunctions({
  patients: () => adminPatientStore(adminDb()),
  tokens: () => genaiTokenClient(GEMINI_API_KEY.value()),
});

/**
 * Weekly Digest: `weeklyDigest` runs Mondays 07:00 Europe/Helsinki for the previous ISO week;
 * `generateDigest` ("Generate now", Clinician only) covers the current week so far.
 */
export const { weeklyDigest, generateDigest } = createDigestFunctions({
  store: () => adminDigestStore(adminDb()),
  textModel: () => genaiTextClient(GEMINI_API_KEY.value()),
});
