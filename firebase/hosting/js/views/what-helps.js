// "What seems to help" (slot `overview-what-helps`; see the slot contract in views/patient.js), laid
// out as the design's `WhatHelps` rows (design/clinician/src/App.jsx): each
// kind of Suggestion the Patient answered about in the last 28 days, how many times, and how they
// said it felt. Kinds are ordered by their Outcomes, then by count; the Outcome score itself is
// never shown, and there is no effectiveness percentage or mean feeling (the design's "Felt x/5 on
// average" is left out: docs/design/dashboard-backend-sync.md, Conflicts 4). The arithmetic is in js/lib/what-helps.js.
// Listens to `suggestions` only, and stops in destroy().
import { shortDate } from "../lib/dates.js";
import { feelingText, whatHelps, whatHelpsWindow } from "../lib/what-helps.js";

const COPY = {
  heading: "What seems to help",
  sub: "Patient reported Outcomes",
  about: (days, start, end) =>
    `Kinds of Suggestion the Patient answered about in the last ${days} days (${start} to ${end}), with how they said it felt afterwards. Kinds with better reported Outcomes come first.`,
  loading: "Loading Suggestions…",
  failed: "Could not load the Suggestions. Reload the page to try again.",
  none: "No answered Suggestions in this window yet.",
  waiting: (n) => `${n} more ${n === 1 ? "Suggestion is" : "Suggestions are"} waiting for the Patient's answer and not counted.`,
  count: (n) => `${n} reported ${n === 1 ? "Outcome" : "Outcomes"}`,
  association: "These reports show an association, not an effect caused by the activity, and are not a measure of the Patient.",
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
 * The Suggestions come from the page's one subscription (`view.docs.suggestions`).
 */
export function mountWhatHelps(container) {
  const id = `what-helps-${++counter}`;
  const block = el("section", { class: "content-section helps", "aria-labelledby": `${id}-heading` });
  const about = el("p", { class: "small muted" });
  const status = el("p", { class: "muted", role: "status" });
  const rowsWrap = el("ul", { class: "help-rows" });
  const waiting = el("p", { class: "small muted" });
  block.append(el("h2", { id: `${id}-heading` }, COPY.heading), el("p", { class: "small muted" }, COPY.sub), status, rowsWrap, waiting, about, el("p", { class: "small muted" }, COPY.association));
  container.replaceChildren(block);

  /** @type {object | null} */
  let view = null;
  /** @type {object[] | null} */
  let suggestions = null;
  let failed = false;


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
    status.hidden = status.textContent === "";
    waiting.textContent = open ? COPY.waiting(open) : "";
    waiting.hidden = !open;
    rowsWrap.replaceChildren(
      ...rows.map((row) => {
        const item = el("li", { class: "help-row" });
        const right = el("span", {}, COPY.count(row.n));
        right.append(el("small", {}, feelingText(row.feelings)));
        item.append(el("span", {}, row.label), right);
        return item;
      }),
    );
    rowsWrap.hidden = rows.length === 0;
  }

  return {
    update(next) {
      view = next;
      // Withdrawn sharing is shown by the page; any other failed read is said here.
      failed = next.errors?.suggestions === "error";
      suggestions = next.docs?.suggestions ?? (failed ? [] : null);
      render();
    },
    destroy() {
      block.remove();
    },
  };
}
