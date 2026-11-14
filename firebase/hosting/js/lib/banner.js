// The red banner on the Patient list, and which red flags count as new. Pure, so `node --test` can
// run it.
//
// The banner shows every uncleared red flag of the Clinician's listed Patients. It stays until the
// flag is cleared, never just because the Patient was viewed, and search and the level filter
// never touch it. A flag is "new" (and may play the sound) only when it arrives after the dashboard
// loaded: the first snapshot of a Patient's flags is the starting point, never news.
import { patientHref } from "./route.js";

/**
 * A flag as the list holds it: the document's fields plus its id and its Patient's id.
 * @typedef {object} ListedFlag
 * @property {string} id
 * @property {string} [patientId]
 * @property {string} level
 * @property {string} [kind]
 * @property {string} reason
 * @property {number} raisedAtMillis
 * @property {number | null} [clearedAtMillis]
 */

/**
 * @typedef {object} BannerItem
 * @property {string} patientId
 * @property {string} displayName
 * @property {string} reason the newest open red reason for this Patient
 * @property {number} more how many other open red flags this Patient has
 * @property {string} href the Patient's page
 * @property {number} raisedAtMillis
 */

/** @typedef {{ count: number, heading: string, items: BannerItem[] }} BannerModel */

/** @param {{ clearedAtMillis?: number | null }} flag */
export const isOpen = (flag) => flag.clearedAtMillis === null || flag.clearedAtMillis === undefined;

/** @param {{ level?: string, clearedAtMillis?: number | null }} flag */
const isOpenRed = (flag) => flag.level === "red" && isOpen(flag);

/** @param {unknown} millis */
const timeOf = (millis) => (typeof millis === "number" ? millis : 0);

/**
 * Uncleared red flags, newest first.
 * @template {ListedFlag} T
 * @param {T[]} flags
 * @returns {T[]}
 */
export function bannerFlags(flags) {
  return flags.filter(isOpenRed).sort((a, b) => timeOf(b.raisedAtMillis) - timeOf(a.raisedAtMillis));
}

/** @param {unknown} reason */
function conciseReason(reason) {
  const text = typeof reason === "string" ? reason.trim() : "";
  return text || "No reason recorded.";
}

/** @param {number} n */
const redFlags = (n) => (n === 1 ? "Red flag" : `${n} red flags`);

/**
 * What the banner shows, or null when no listed Patient has an open red flag.
 * @param {ListedFlag[]} flags every listed Patient's flags, each with its `patientId`
 * @param {Record<string, string>} namesById display names of the listed Patients; a flag of a
 *   Patient not in it (for example one who withdrew sharing) is left out
 * @returns {BannerModel | null}
 */
export function bannerModel(flags, namesById) {
  const reds = bannerFlags(flags.filter((f) => f.patientId !== undefined && Object.hasOwn(namesById, f.patientId)));
  if (reds.length === 0) return null;
  /** @type {Map<string, BannerItem>} */
  const byPatient = new Map();
  for (const flag of reds) {
    const patientId = /** @type {string} */ (flag.patientId);
    const item = byPatient.get(patientId);
    if (item) {
      item.more += 1;
      continue;
    }
    byPatient.set(patientId, {
      patientId,
      displayName: namesById[patientId] || "Unnamed patient",
      reason: conciseReason(flag.reason),
      more: 0,
      href: patientHref(patientId),
      raisedAtMillis: flag.raisedAtMillis,
    });
  }
  const items = [...byPatient.values()];
  const heading =
    items.length === 1
      ? `${redFlags(reds.length)}: ${items[0].displayName}`
      : `${redFlags(reds.length)} across ${items.length} Patients`;
  return { count: reds.length, heading, items };
}

/**
 * The red flags in `current` that are new since `previous`, one Patient's flags at a time.
 *
 * `previous` is null for the Patient's first snapshot. For a Patient who was listed when the
 * dashboard loaded, that first snapshot is the starting point and nothing in it is new, so the first
 * load never plays a sound. For a Patient who joined the list later (`joinedLate`, for example
 * sharing granted while the dashboard was open), a red raised after the dashboard loaded is new.
 *
 * @template {ListedFlag} T
 * @param {T[] | null} previous
 * @param {T[]} current
 * @param {{ loadedAtMillis: number, joinedLate?: boolean }} options
 * @returns {T[]}
 */
export function newRedFlags(previous, current, { loadedAtMillis, joinedLate = false }) {
  if (previous === null) {
    return joinedLate ? current.filter((f) => isOpenRed(f) && timeOf(f.raisedAtMillis) > loadedAtMillis) : [];
  }
  const seen = new Set(previous.map((f) => f.id));
  return current.filter((f) => isOpenRed(f) && !seen.has(f.id));
}
