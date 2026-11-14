// Pure helpers for sharing Consent on the dashboard (issue #29). No Firebase imports, so
// `node --test` can run them.
//
// The Clinician sees a Patient only while the Patient's `sharingConsent` is "granted"; the
// security rules enforce it (`clinicianCanRead` in firestore.rules). Two consequences here:
//   - The Patient list query must filter on it too, or Firestore rejects the whole query.
//     Withdrawing then drops the Patient from the live list at once.
//   - A listener that is already open on a Patient (the Patient page, a Summary list) gets a
//     `permission-denied` error the moment sharing is withdrawn. That is not a fault: the page shows
//     the "sharing withdrawn" state with `sharingStateFromError`, never an error message.

export const SHARING_GRANTED = "granted";

/**
 * The `where` clauses of the Clinician's Patient list, as [field, op, value] triples:
 * `query(collection(db, "patients"), ...clinicianListFilters(email).map((f) => where(...f)))`.
 * @param {string} clinicianEmail
 * @returns {[string, "==", string][]}
 */
export function clinicianListFilters(clinicianEmail) {
  return [
    ["clinicianEmail", "==", clinicianEmail],
    ["sharingConsent", "==", SHARING_GRANTED],
  ];
}

/**
 * What a Patient page (or any view of one Patient) shows.
 * @typedef {{ status: "ok", patient: Partial<import("./contract.js").PatientDoc> }
 *   | { status: "withdrawn" }
 *   | { status: "error" }} SharingViewState
 */

export const SHARING_COPY = Object.freeze({
  withdrawn: "This Patient is not sharing their progress with you right now. They can choose to share again from their app.",
  error: "Could not load this Patient. Reload the page to try again.",
});

/**
 * Maps a Patient document snapshot to what the page shows. A Demo Patient is readable through the
 * demo shortcut even when not sharing, so the page checks the field too and stays in step with the
 * list, which only shows Patients who share.
 * @param {{ exists: boolean, data?: Partial<import("./contract.js").PatientDoc> } | null | undefined} snapshot
 *   `{ exists: snap.exists(), data: snap.data() }`
 * @returns {SharingViewState}
 */
export function sharingStateFromSnapshot(snapshot) {
  if (!snapshot?.exists || !snapshot.data) return { status: "error" };
  if (snapshot.data.sharingConsent !== SHARING_GRANTED) return { status: "withdrawn" };
  return { status: "ok", patient: snapshot.data };
}

/**
 * Maps a listener or read error to what the page shows. `permission-denied` is what the rules say
 * once the Patient is not sharing (or was never this Clinician's), so it is the withdrawn state.
 * Anything else is a real error. The raw error text is never shown.
 * @param {{ code?: string } | null | undefined} error
 * @returns {SharingViewState}
 */
export function sharingStateFromError(error) {
  const code = error?.code ?? "";
  return code === "permission-denied" || code === "firestore/permission-denied"
    ? { status: "withdrawn" }
    : { status: "error" };
}

/**
 * The text to show for a non-ok state, or null when the Patient's data can be shown.
 * @param {SharingViewState} state
 * @returns {string | null}
 */
export function sharingMessage(state) {
  switch (state.status) {
    case "ok":
      return null;
    case "withdrawn":
      return SHARING_COPY.withdrawn;
    default:
      return SHARING_COPY.error;
  }
}
