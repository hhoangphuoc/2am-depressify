// The live Patient list. app.js owns the Patients query and passes each snapshot to update(); this
// module also listens to each listed Patient's flags (for the newest-flag order), renders the
// rows and refreshes the relative times every minute. Formatting and sorting are pure helpers in
// lib/list-row.js and lib/sort.js.
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "./lib/contract.js";
import { patientListRows } from "./lib/list-row.js";
import { patientHref } from "./lib/route.js";
import { newestOpenFlagAt } from "./lib/sort.js";

const COPY = {
  empty: "No Patients yet. A Patient appears here when they first open the app.",
  failed: "Could not load the Patient list. Reload the page to try again.",
};
const REFRESH_MILLIS = 60_000;

/**
 * @param {import("firebase/firestore").Firestore} db
 * @param {{ body: HTMLElement, table: HTMLElement, status: HTMLElement }} elements
 */
export function createPatientList(db, { body, table, status }) {
  /** @type {{ id: string, data: object }[] | null} null until the first snapshot: still loading */
  let docs = null;
  /** @type {Record<string, number | null>} */
  const latestFlagAtById = {};
  /** @type {Map<string, () => void>} */
  const flagListeners = new Map();
  const timer = setInterval(render, REFRESH_MILLIS);

  function watchFlags(id) {
    const flags = collection(db, COLLECTIONS.patients, id, COLLECTIONS.flags);
    return onSnapshot(
      flags,
      (snapshot) => {
        latestFlagAtById[id] = newestOpenFlagAt(snapshot.docs.map((d) => d.data()));
        render();
      },
      () => {
        // Access ended (for example, sharing withdrawn): order without it rather than fail the list.
        latestFlagAtById[id] = null;
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
    }
    for (const id of ids) if (!flagListeners.has(id)) flagListeners.set(id, watchFlags(id));
  }

  function cell(text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function render() {
    if (docs === null) return;
    const rows = patientListRows(docs, latestFlagAtById, { nowMillis: Date.now() });
    body.replaceChildren(
      ...rows.map((row) => {
        const tr = document.createElement("tr");
        tr.dataset.level = row.flagLevel;
        const name = document.createElement("th");
        name.scope = "row";
        const link = document.createElement("a");
        link.href = patientHref(row.id);
        link.textContent = row.displayName;
        name.append(link);
        const level = document.createElement("td");
        const chip = document.createElement("span");
        chip.className = `level level-${row.flagLevel}`;
        chip.textContent = row.levelWord;
        level.append(chip);
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
        tr.append(name, level, reasons, cell(row.latestCheckIn), cell(row.freshness, row.stale ? "stale" : ""));
        return tr;
      }),
    );
    table.hidden = rows.length === 0;
    status.textContent = rows.length ? "" : COPY.empty;
  }

  return {
    /** @param {{ id: string, data: object }[]} next the Patients query's documents */
    update(next) {
      docs = next;
      syncFlagListeners(new Set(next.map((d) => d.id)));
      render();
    },
    fail() {
      docs = null;
      syncFlagListeners(new Set());
      table.hidden = true;
      status.textContent = COPY.failed;
    },
    stop() {
      clearInterval(timer);
      syncFlagListeners(new Set());
    },
  };
}
