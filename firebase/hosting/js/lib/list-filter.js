// Search by name and the level filter on the Patient list. Pure, so `node --test` can run it.
//
// Filters change which rows are shown, never the red banner: listViewModel builds the banner from
// every listed Patient before any filter applies.
import { bannerModel } from "./banner.js";
import { levelWord } from "./list-row.js";

/** The level filter's values, in the order the select shows them. */
export const LEVEL_FILTERS = Object.freeze(["all", "red", "amber", "green"]);

/** @param {string} text */
function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .trim();
}

/**
 * True when the search is empty or appears anywhere in the name, ignoring case and accents.
 * @param {string} displayName
 * @param {string} search
 */
export function nameMatches(displayName, search) {
  const needle = fold(search);
  return needle === "" || fold(displayName).includes(needle);
}

/** @param {string | undefined} level */
const activeLevel = (level) => (level === "red" || level === "amber" || level === "green" ? level : null);

/**
 * The rows that match, in the order given.
 * @template {{ displayName: string, flagLevel: string }} T
 * @param {T[]} rows
 * @param {{ search?: string, level?: string }} filter
 * @returns {T[]}
 */
export function filterRows(rows, { search = "", level = "all" }) {
  const wanted = activeLevel(level);
  return rows.filter((row) => (wanted === null || row.flagLevel === wanted) && nameMatches(row.displayName, search));
}

/**
 * The line under the controls: the empty state, a no-match state, a count while filtering, or nothing.
 * @param {{ total: number, shown: number, search?: string, level?: string }} counts
 * @returns {{ kind: "empty" | "noMatch" | "filtered" | "ok", text: string }}
 */
export function listMessage({ total, shown, search = "", level = "all" }) {
  if (total === 0) {
    return { kind: "empty", text: "No Patients yet. A Patient appears here once they choose to share their progress with you." };
  }
  const needle = String(search ?? "").trim();
  const wanted = activeLevel(level);
  if (shown === 0) {
    if (needle && wanted) return { kind: "noMatch", text: `No ${levelWord(wanted)} Patient matches “${needle}”.` };
    if (wanted) return { kind: "noMatch", text: `No Patients are at ${levelWord(wanted)} right now.` };
    return { kind: "noMatch", text: `No Patient's name matches “${needle}”.` };
  }
  if (needle || wanted) return { kind: "filtered", text: `Showing ${shown} of ${total} Patients.` };
  return { kind: "ok", text: "" };
}

/**
 * Everything the list view draws from one state: the banner (from every listed Patient), the
 * filtered rows and the message.
 * @template {{ id: string, displayName: string, flagLevel: string }} T
 * @param {{ rows: T[], flagsByPatient: Record<string, import("./banner.js").ListedFlag[]>, search?: string, level?: string }} input
 */
export function listViewModel({ rows, flagsByPatient, search = "", level = "all" }) {
  /** @type {Record<string, string>} */
  const namesById = {};
  for (const row of rows) namesById[row.id] = row.displayName;
  const flags = rows.flatMap((row) => (flagsByPatient[row.id] ?? []).map((f) => ({ ...f, patientId: row.id })));
  const shown = filterRows(rows, { search, level });
  return {
    banner: bannerModel(flags, namesById),
    rows: shown,
    message: listMessage({ total: rows.length, shown: shown.length, search, level }),
  };
}
