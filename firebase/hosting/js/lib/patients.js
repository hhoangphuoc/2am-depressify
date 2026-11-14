// Pure helpers for the Patient list. No Firebase imports, so `node --test` can run them.

/**
 * @typedef {{ id: string, data: Partial<import("./contract.js").PatientDoc> }} PatientSnapshot
 * @typedef {{ id: string, displayName: string, flagLevel: string, flagReasons: string[], lastCheckInAtMillis: number | null }} PatientRow
 */

/**
 * Turns Patient documents into list rows, sorted by display name then id.
 * Sorting by Attention flag comes with the full Patient list ticket.
 * @param {PatientSnapshot[]} docs
 * @returns {PatientRow[]}
 */
export function toPatientRows(docs) {
  return docs
    .map(({ id, data }) => ({
      id,
      displayName: data.displayName || "Unnamed patient",
      flagLevel: data.flagLevel ?? "green",
      flagReasons: Array.isArray(data.flagReasons) ? data.flagReasons : [],
      lastCheckInAtMillis: data.lastCheckInAtMillis ?? null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
}
