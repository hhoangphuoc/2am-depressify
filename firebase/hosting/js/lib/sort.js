// Sorting the Patient list by Attention flag. Pure, so `node --test` can run it.

/** @typedef {{ id: string, displayName: string, flagLevel?: string }} SortablePatient */

const LEVEL_RANK = Object.freeze({ red: 0, amber: 1, green: 2 });

/**
 * Red first, then amber, then green. An unknown or missing level sorts with green: it is never
 * allowed to rise above a real flag.
 * @param {string | undefined} level
 * @returns {number}
 */
export function levelRank(level) {
  return level !== undefined && Object.hasOwn(LEVEL_RANK, level) ? LEVEL_RANK[/** @type {keyof LEVEL_RANK} */ (level)] : LEVEL_RANK.green;
}

/**
 * When the newest flag that is not yet cleared was raised, or null if none is open.
 * @param {{ raisedAtMillis: number, clearedAtMillis: number | null }[]} flags
 * @returns {number | null}
 */
export function newestOpenFlagAt(flags) {
  let newest = null;
  for (const flag of flags) {
    if (flag.clearedAtMillis !== null && flag.clearedAtMillis !== undefined) continue;
    if (typeof flag.raisedAtMillis !== "number") continue;
    if (newest === null || flag.raisedAtMillis > newest) newest = flag.raisedAtMillis;
  }
  return newest;
}

/**
 * Sorted copy: red, amber, green; then the newest open flag first (none last); then by name; then
 * by id, so Patients that tie keep a stable place.
 * @template {SortablePatient} T
 * @param {T[]} patients
 * @param {Record<string, number | null | undefined>} [latestFlagAtById]
 * @returns {T[]}
 */
export function sortPatients(patients, latestFlagAtById = {}) {
  const flagAt = (/** @type {string} */ id) => latestFlagAtById[id] ?? null;
  return [...patients].sort((a, b) => {
    const byLevel = levelRank(a.flagLevel) - levelRank(b.flagLevel);
    if (byLevel) return byLevel;
    const fa = flagAt(a.id);
    const fb = flagAt(b.id);
    if (fa !== fb) {
      if (fa === null) return 1;
      if (fb === null) return -1;
      return fb - fa;
    }
    return a.displayName.localeCompare(b.displayName, "en") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
