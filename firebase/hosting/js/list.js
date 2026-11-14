// The live Patient list. app.js owns the Patients query and passes each snapshot to update(); this
// module also listens to each listed Patient's flags (for the newest-flag order, the red banner and
// new-flag alerts), renders the banner and the rows, applies search and the level filter, and
// refreshes the relative times every minute. Formatting, sorting, the banner and filtering are pure
// helpers in lib/list-row.js, lib/sort.js, lib/banner.js and lib/list-filter.js.
//
// The banner is built from every listed Patient before any filter applies, so search and the level
// filter never hide it, and it stays until the flag is cleared.
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { newRedFlags } from "./lib/banner.js";
import { COLLECTIONS } from "./lib/contract.js";
import { listViewModel } from "./lib/list-filter.js";
import { patientListRows } from "./lib/list-row.js";
import { patientHref } from "./lib/route.js";
import { newestOpenFlagAt } from "./lib/sort.js";

const COPY = {
  failed: "Could not load the Patient list. Reload the page to try again.",
  review: "Review Patient",
  more: (/** @type {number} */ n) => `and ${n} more red ${n === 1 ? "flag" : "flags"}`,
  workQueue: "Attention is a work queue for follow-up, not a judgement about the Patient. Each red flag stays here until it is cleared after follow-up.",
};
const REFRESH_MILLIS = 60_000;

/**
 * @typedef {object} ListElements
 * @property {HTMLElement} body
 * @property {HTMLElement} table
 * @property {HTMLElement} status
 * @property {HTMLElement} banner
 * @property {HTMLElement} controls
 * @property {HTMLInputElement} search
 * @property {HTMLSelectElement} level
 * @property {HTMLButtonElement} clearFilters
 */

/**
 * @param {import("firebase/firestore").Firestore} db
 * @param {ListElements} elements
 * @param {{ onNewRed?: (flags: { patientId: string, displayName: string, reason: string }[]) => void }} [options]
 */
export function createPatientList(db, elements, { onNewRed = () => {} } = {}) {
  const { body, table, status, banner, controls, search, level, clearFilters } = elements;
  const loadedAtMillis = Date.now();
  /** @type {{ id: string, data: object }[] | null} null until the first snapshot: still loading */
  let docs = null;
  /** Patients in the first snapshot; flags of Patients who join later are checked against load time. */
  /** @type {Set<string> | null} */
  let firstIds = null;
  /** @type {Record<string, number | null>} */
  const latestFlagAtById = {};
  /** @type {Record<string, import("./lib/banner.js").ListedFlag[]>} */
  const flagsById = {};
  /** @type {Map<string, () => void>} */
  const flagListeners = new Map();
  const timer = setInterval(render, REFRESH_MILLIS);

  function displayNameOf(id) {
    const found = docs?.find((d) => d.id === id);
    return /** @type {any} */ (found?.data)?.displayName || "Unnamed patient";
  }

  function watchFlags(id) {
    const flags = collection(db, COLLECTIONS.patients, id, COLLECTIONS.flags);
    return onSnapshot(
      flags,
      (snapshot) => {
        const current = snapshot.docs.map((d) => ({ ...d.data(), id: d.id, patientId: id }));
        const fresh = newRedFlags(flagsById[id] ?? null, current, {
          loadedAtMillis,
          joinedLate: !(firstIds?.has(id) ?? false),
        });
        flagsById[id] = current;
        latestFlagAtById[id] = newestOpenFlagAt(current);
        render();
        if (fresh.length) {
          onNewRed(fresh.map((f) => ({ patientId: id, displayName: displayNameOf(id), reason: f.reason })));
        }
      },
      () => {
        // Access ended (for example, sharing withdrawn): order without it rather than fail the list.
        latestFlagAtById[id] = null;
        delete flagsById[id];
        render();
      },
    );
  }

  function syncFlagListeners(ids) {
    for (const [id, stop] of flagListeners) {
      if (ids.has(id)) continue;
      stop();
      flagListeners.delete(id);
      delete latestFlagAtById[id];
      delete flagsById[id];
    }
    for (const id of ids) if (!flagListeners.has(id)) flagListeners.set(id, watchFlags(id));
  }

  function cell(text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  /** @param {import("./lib/banner.js").BannerModel | null} model */
  function renderBanner(model) {
    banner.hidden = model === null;
    if (model === null) {
      banner.replaceChildren();
      return;
    }
    const heading = document.createElement("h2");
    heading.id = "banner-heading";
    heading.textContent = model.heading;
    const about = document.createElement("p");
    about.className = "banner-about";
    about.textContent = COPY.workQueue;
    const list = document.createElement("ul");
    list.className = "banner-items";
    for (const item of model.items) {
      const li = document.createElement("li");
      const who = document.createElement("strong");
      who.textContent = item.displayName;
      const reason = document.createElement("span");
      reason.textContent = item.reason;
      const text = document.createElement("p");
      text.append(who, " ", reason);
      if (item.more) {
        const more = document.createElement("span");
        more.className = "banner-more";
        more.textContent = ` ${COPY.more(item.more)}`;
        text.append(more);
      }
      const link = document.createElement("a");
      link.className = "button-link";
      link.href = item.href;
      const hidden = document.createElement("span");
      hidden.className = "visually-hidden";
      hidden.textContent = `: ${item.displayName}`;
      link.append(COPY.review, hidden);
      li.append(text, link);
      list.append(li);
    }
    banner.replaceChildren(heading, about, list);
  }

  function render() {
    if (docs === null) return;
    const all = patientListRows(docs, latestFlagAtById, { nowMillis: Date.now() });
    const view = listViewModel({ rows: all, flagsByPatient: flagsById, search: search.value, level: level.value });
    renderBanner(view.banner);
    controls.hidden = all.length === 0;
    body.replaceChildren(
      ...view.rows.map((row) => {
        const tr = document.createElement("tr");
        tr.dataset.level = row.flagLevel;
        const name = document.createElement("th");
        name.scope = "row";
        const link = document.createElement("a");
        link.href = patientHref(row.id);
        link.textContent = row.displayName;
        name.append(link);
        const levelCell = document.createElement("td");
        const chip = document.createElement("span");
        chip.className = `level level-${row.flagLevel}`;
        chip.textContent = row.levelWord;
        levelCell.append(chip);
        const reasons = document.createElement("td");
        const list = document.createElement("ul");
        list.className = "reasons";
        list.append(
          ...row.reasons.map((reason) => {
            const li = document.createElement("li");
            li.textContent = reason;
            return li;
          }),
        );
        reasons.append(list);
        tr.append(name, levelCell, reasons, cell(row.latestCheckIn), cell(row.freshness, row.stale ? "stale" : ""));
        return tr;
      }),
    );
    table.hidden = view.rows.length === 0;
    status.textContent = view.message.text;
    clearFilters.hidden = view.message.kind !== "noMatch";
  }

  function onClearFilters() {
    search.value = "";
    level.value = "all";
    render();
    search.focus();
  }

  search.addEventListener("input", render);
  level.addEventListener("change", render);
  clearFilters.addEventListener("click", onClearFilters);

  return {
    /** @param {{ id: string, data: object }[]} next the Patients query's documents */
    update(next) {
      docs = next;
      firstIds ??= new Set(next.map((d) => d.id));
      syncFlagListeners(new Set(next.map((d) => d.id)));
      render();
    },
    fail() {
      docs = null;
      syncFlagListeners(new Set());
      table.hidden = true;
      controls.hidden = true;
      clearFilters.hidden = true;
      renderBanner(null);
      status.textContent = COPY.failed;
    },
    stop() {
      clearInterval(timer);
      syncFlagListeners(new Set());
      search.removeEventListener("input", render);
      level.removeEventListener("change", render);
      clearFilters.removeEventListener("click", onClearFilters);
      renderBanner(null);
    },
  };
}
