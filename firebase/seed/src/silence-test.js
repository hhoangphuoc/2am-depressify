// The silence test (#28, for the demo controls in #31): makes the next hourly silence check raise
// red for one chosen live Patient by setting that Patient's last sign of life (`lastSeenAtMillis`)
// to 25 hours ago, with the Admin SDK. It writes nothing else: the flag, the Patient's level and the
// email come from the real `silenceCheck` and `redFlagAlert` functions, unchanged.
//
// It refuses what the silence check would skip anyway, so the demo never waits for a flag that
// cannot come: a Demo Patient (synthetic Patients are never silent) and a Patient who is not
// sharing. It is a command for whoever holds the project's credentials, not something the deployed
// backend offers: no function, rule or callable was added for it.

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */
/** @typedef {import("../../functions/src/types.ts").PatientDoc} PatientDoc */

/** How far back the last sign of life is set: past the silence check's 24 hours. */
export const SILENCE_TEST_HOURS = 25;

/** The silence check's Cloud Scheduler region (`SCHEDULER_REGION` in functions/src/region.ts). */
export const SILENCE_CHECK_REGION = "europe-west1";

/**
 * The update that makes the Patient silent, or an Error saying why the check would skip them.
 * @param {Partial<PatientDoc> | undefined} patient
 * @param {number} nowMillis
 * @returns {{ lastSeenAtMillis: number }}
 */
export function silenceTestUpdate(patient, nowMillis) {
  if (!patient) throw new Error("No Patient record with that id.");
  if (patient.synthetic === true) {
    throw new Error("That is a Demo Patient (synthetic): synthetic Patients are never silent. Pick a live Patient, for example the phone's.");
  }
  if (patient.sharingConsent !== "granted") {
    throw new Error("That Patient is not sharing with the Clinician, so the silence check skips them. Share first, in the app's Settings.");
  }
  return { lastSeenAtMillis: nowMillis - SILENCE_TEST_HOURS * 60 * 60 * 1000 };
}

/**
 * Sets the Patient's last sign of life to 25 hours ago, in a transaction with the checks above.
 * @param {Firestore} db
 * @param {string} patientId
 * @param {number} nowMillis
 * @returns {Promise<{ lastSeenAtMillis: number }>}
 */
export async function startSilenceTest(db, patientId, nowMillis) {
  const ref = db.collection("patients").doc(patientId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const update = silenceTestUpdate(snapshot.exists ? /** @type {Partial<PatientDoc>} */ (snapshot.data()) : undefined, nowMillis);
    transaction.update(ref, update);
    return update;
  });
}

/**
 * The command that runs the deployed `silenceCheck` once now ("Force run" on its Cloud Scheduler
 * job), instead of waiting for the top of the hour.
 * @param {string} projectId
 */
export function runSilenceCheckCommand(projectId) {
  return `gcloud scheduler jobs run firebase-schedule-silenceCheck-${SILENCE_CHECK_REGION} --location=${SILENCE_CHECK_REGION} --project=${projectId}`;
}
