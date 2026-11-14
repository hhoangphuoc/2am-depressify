// "What seems to help" (slot `overview-what-helps`; see the slot contract in views/patient.js): each
// kind of Suggestion the Patient answered about in the last 28 days, how many times, and how they
// said it felt. Kinds are ordered by their Outcomes, then by count; the Outcome score itself is
// never shown, and there is no effectiveness percentage. The arithmetic is in js/lib/what-helps.js.
// Listens to `suggestions` only, and stops in destroy().
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { shortDate } from "../lib/dates.js";
import { feelingText, whatHelps, whatHelpsWindow } from "../lib/what-helps.js";

const COPY = {
  heading: "What seems to help",
  about: (days, start, end) =>
    `Kinds of Suggestion the Patient answered about in the last ${days} days (${start} to ${end}), with how they said it ` +
    "felt afterwards. Kinds with better reported Outcomes come first, then the ones answered about more often. These " +
    "are counts of the Patient's own answers, not a measure of the Patient.",
  loading: "Loading Suggestions…",
  failed: "Could not load the Suggestions. Reload the page to try again.",
  none: "No answered Suggestions in this window yet.",
  waiting: (n) => `${n} more ${n === 1 ? "Suggestion is" : "Suggestions are"} waiting for the Patient's answer and not counted.`,
  caption: "Suggestions answered about, by kind",
  kind: "Kind of Suggestion",
  count: "Times answered",
  feeling: "Reported feeling",
};

let counter = 0;

/** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string }} ctx
 */
export function mountWhatHelps(container, { db, patientId }) {
  const id = `what-helps-${++counter}`;
  const block = el("section", { class: "panel what-helps", "aria-labelledby": `${id}-heading` });
  const about = el("p", { class: "muted" });
  const status = el("p", { class: "muted", role: "status" });
  const tableWrap = el("div");
  const waiting = el("p", { class: "muted hint" });
  block.append(el("h4", { id: `${id}-heading` }, COPY.heading), about, status, tableWrap, waiting);
  container.replaceChildren(block);

  /** @type {object | null} */
  let view = null;
  /** @type {object[] | null} */
  let suggestions = null;
  let failed = false;

  const stop = onSnapshot(
    collection(db, COLLECTIONS.patients, patientId, COLLECTIONS.suggestions),
    (snapshot) => {
      suggestions = snapshot.docs.map((d) => d.data());
      failed = false;
      render();
    },
    (error) => {
      suggestions = [];
      // Withdrawn sharing is shown by the page; anything else is said here.
      failed = error?.code !== "permission-denied";
      render();
    },
  );

  function render() {
    if (!view) return;
    const { today, timeZone } = view;
    const window = whatHelpsWindow(today);
    about.textContent = COPY.about(window.days, shortDate(window.start, today), shortDate(window.end, today));
    if (suggestions === null) {
      status.textContent = COPY.loading;
      return;
    }
    const { rows, waiting: open } = whatHelps(suggestions, { ...window, timeZone });
    status.textContent = failed ? COPY.failed : rows.length ? "" : COPY.none;
    waiting.textContent = open ? COPY.waiting(open) : "";
    if (!rows.length) {
      tableWrap.replaceChildren();
      return;
    }
    const table = el("table", { class: "what-helps-table" });
    table.append(el("caption", { class: "visually-hidden" }, COPY.caption));
    const head = el("thead");
    const headRow = el("tr");
    const headings = [COPY.kind, COPY.count, COPY.feeling];
    for (const text of headings) headRow.append(el("th", { scope: "col" }, text));
    head.append(headRow);
    const body = el("tbody");
    for (const row of rows) {
      const tr = el("tr");
      tr.append(el("th", { scope: "row" }, row.label));
      const count = el("td", {}, String(row.n));
      count.dataset.label = headings[1];
      const feeling = el("td", {}, feelingText(row.feelings));
      feeling.dataset.label = headings[2];
      tr.append(count, feeling);
      body.append(tr);
    }
    table.append(head, body);
    tableWrap.replaceChildren(table);
  }

  return {
    update(next) {
      view = next;
      render();
    },
    destroy() {
      stop();
      block.remove();
    },
  };
}
