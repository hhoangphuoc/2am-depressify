// The dashboard's queries on a Patient's collections, bound to the browser SDK. The filter itself
// lives once, in lib/sharing.js (`patientCollectionQuery`): a stamped collection is read only where
// `sharedWithClinician == true`, as the security rules require.
import { collection, query, where } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { patientCollectionQuery } from "./lib/sharing.js";

/** The browser SDK's functions, in the shape lib/sharing.js and lib/clear.js take. */
export const QUERY_FUNCTIONS = Object.freeze({ collection, query, where });

/**
 * @param {import("firebase/firestore").Firestore} db
 * @param {string} patientId
 * @param {string} collectionName one of COLLECTIONS in lib/contract.js
 * @param {...import("firebase/firestore").QueryConstraint} constraints
 */
export function patientQuery(db, patientId, collectionName, ...constraints) {
  return patientCollectionQuery(QUERY_FUNCTIONS, db, patientId, collectionName, ...constraints);
}
