// The design's live data, bound to the browser SDK this dashboard loads (no build step). The logic is
// in js/lib/design-live.js and js/lib/design-model.js, which take the Firestore functions as an
// argument; this file only passes the browser SDK's. A React or Vite port imports the lib files
// directly and passes `import * as fs from "firebase/firestore"` instead.
//
//   import { initFirebase } from "../firebase.js";
//   import { designData } from "./data/design-data.js";
//   const { auth, db } = await initFirebase();
//   const data = designData({ db, app: auth.app });
//   const stop = data.subscribeRoster({ clinicianEmail: auth.currentUser.email }, (roster) => render(rosterView(roster, { search, filter })));
import * as firestore from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { digestCalls, intakeCalls } from "../functions.js";
import * as live from "../lib/design-live.js";

export { rosterView, DESIGN_LEVELS, DESIGN_LEVEL_ORDER, DESIGN_SIGNALS } from "../lib/design-model.js";

/**
 * The subscriptions, writes and calls for one signed-in dashboard.
 * @param {{ db: import("firebase/firestore").Firestore, app: import("firebase/app").FirebaseApp }} firebase
 */
export function designData({ db, app }) {
  const fs = /** @type {any} */ (firestore);
  const digest = digestCalls(app);
  const intake = intakeCalls(app);
  return {
    /** @param {Parameters<typeof live.subscribeRoster>[2]} options @param {Parameters<typeof live.subscribeRoster>[3]} onChange */
    subscribeRoster: (options, onChange) => live.subscribeRoster(fs, db, options, onChange),
    /** @param {string} patientId @param {Parameters<typeof live.subscribePatient>[3]} options @param {Parameters<typeof live.subscribePatient>[4]} onChange */
    subscribePatient: (patientId, options, onChange) => live.subscribePatient(fs, db, patientId, options, onChange),
    subscribeAttention: (/** @type {string} */ patientId, /** @type {any} */ options, /** @type {any} */ onChange) => live.subscribeAttention(fs, db, patientId, options, onChange),
    subscribeOverview: (/** @type {string} */ patientId, /** @type {any} */ options, /** @type {any} */ onChange) => live.subscribeOverview(fs, db, patientId, options, onChange),
    subscribeSummaries: (/** @type {string} */ patientId, /** @type {any} */ options, /** @type {any} */ onChange) => live.subscribeSummaries(fs, db, patientId, options, onChange),
    subscribeSignals: (/** @type {string} */ patientId, /** @type {any} */ options, /** @type {any} */ onChange) => live.subscribeSignals(fs, db, patientId, options, onChange),
    subscribeIntakeVisits: (/** @type {string} */ patientId, /** @type {any} */ options, /** @type {any} */ onChange) => live.subscribeIntakeVisits(fs, db, patientId, options, onChange),
    subscribeDigest: (/** @type {string} */ patientId, /** @type {any} */ options, /** @type {any} */ onChange) => live.subscribeDigest(fs, db, patientId, options, onChange),
    recordVisit: (/** @type {string} */ patientId, /** @type {any} */ form, /** @type {any} */ context) => live.recordVisit(fs, db, patientId, form, context),
    setTmsEndDate: (/** @type {string} */ patientId, /** @type {string} */ date, /** @type {any} */ context) => live.setTmsEndDate(fs, db, patientId, date, context),
    clearAttention: (/** @type {Parameters<typeof live.clearAttention>[2]} */ request) => live.clearAttention(fs, db, request),
    generateDigestNow: (/** @type {string} */ patientId) => live.generateDigestNow(digest, patientId),
    extractIntake: (/** @type {string} */ patientId, /** @type {string} */ text) => live.extractIntake(intake, patientId, text),
    saveIntake: (/** @type {string} */ patientId, /** @type {string[] | string} */ highlights) => live.saveIntake(intake, patientId, highlights),
  };
}
