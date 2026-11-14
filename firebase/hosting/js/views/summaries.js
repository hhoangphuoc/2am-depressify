// Summary blocks of the Patient page (see the slot contract in views/patient.js):
//   mountSummaries      slot `summaries-body`: every Summary, newest first, and the selected one in full
//   mountLatestSummary  slot `overview-latest-summary`: the newest Summary on the Overview
//
// A Summary is the same one the Patient reads (ADR 0005): ratings, the sleep line, themes, the
// Suggestion, the previous Outcome, Voice cues worded as observations and at most three short
// quotes. There is no transcript or audio to show: js/lib/summaries.js picks out only those fields.
// Each block listens to `summaries` only, and stops in destroy().
import { onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { patientQuery } from "../queries.js";
import { COLLECTIONS } from "../lib/contract.js";
import { selectSummary, sortSummaries, summaryView, summaryWhen } from "../lib/summaries.js";

const COPY = {
  heading: "All Summaries",
  about: "The same Summaries the Patient reads, newest first. Each was written by AI when the Check-in ended. No transcript or audio is kept.",
  latest: "Latest Summary",
  list: "Summaries, newest first",
  loading: "Loading Summaries…",
  failed: "Could not load the Summaries. Reload the page to try again.",
  none: "No Summaries yet. One appears here when the Patient finishes a Check-in.",
  all: "All Summaries",
  ratings: "Ratings (the Patient's own, 1 to 5)",
  sleep: "Sleep",
  themes: "Themes",
  noThemes: "None noted.",
  suggestion: "Suggestion",
  noSuggestion: "No Suggestion this time.",
  previous: "Previous Outcome",
  noPrevious: "Nothing reported about the previous Suggestion.",
  cues: "Voice cues (observations)",
  noCues: "None noted.",
  quotes: "In the Patient's words",
  noQuotes: "No quotes.",
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
 * Listens to the Patient's Summaries and calls `onChange(sorted | null, failed)`; null while loading.
 * @param {import("firebase/firestore").Firestore} db
 * @param {string} patientId
 * @param {(sorted: object[], failed: boolean) => void} onChange
 */
function listenSummaries(db, patientId, onChange) {
  return onSnapshot(
    patientQuery(db, patientId, COLLECTIONS.summaries),
    (snapshot) => onChange(sortSummaries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))), false),
    // Withdrawn sharing is shown by the page; anything else is said here.
    (error) => onChange([], error?.code !== "permission-denied"),
  );
}

/**
 * One Summary in full.
 * @param {import("../lib/summaries.js").SummaryView} summary
 * @param {{ today: string, timeZone: string, level: number, idPrefix: string }} options
 */
function summaryDetail(summary, { today, timeZone, level, idPrefix }) {
  const h = `h${level}`;
  const article = el("article", { class: "summary-detail", "aria-labelledby": `${idPrefix}-title` });
  article.append(el(h, { id: `${idPrefix}-title` }, `Check-in on ${summaryWhen(summary.createdAtMillis, { today, timeZone })}`));

  const ratings = el("dl", { class: "summary-ratings", "aria-label": COPY.ratings });
  for (const { name, text } of summary.ratings) {
    const pair = el("div");
    pair.append(el("dt", {}, name), el("dd", {}, text));
    ratings.append(pair);
  }
  article.append(ratings);

  /** @param {string} title @param {Node} body */
  const part = (title, body) => {
    const wrap = el("div", { class: "summary-part" });
    wrap.append(el("p", { class: "summary-label" }, title), body);
    article.append(wrap);
  };
  /** @param {string[]} items @param {string} empty @param {string} [cls] */
  const list = (items, empty, cls = "") => {
    if (!items.length) return el("p", { class: "muted" }, empty);
    const ul = el("ul", { class: `summary-list ${cls}`.trim() });
    for (const item of items) ul.append(el("li", {}, item));
    return ul;
  };

  if (summary.sleepLine) part(COPY.sleep, el("p", {}, summary.sleepLine));
  part(COPY.themes, list(summary.themes, COPY.noThemes, "themes"));
  part(COPY.suggestion, el("p", summary.suggestion ? {} : { class: "muted" }, summary.suggestion ?? COPY.noSuggestion));
  part(COPY.previous, el("p", summary.previousOutcome ? {} : { class: "muted" }, summary.previousOutcome ?? COPY.noPrevious));
  part(COPY.cues, list(summary.voiceCues, COPY.noCues));
  if (summary.quotes.length) {
    const quotes = el("div", { class: "summary-quotes" });
    for (const quote of summary.quotes) {
      const q = el("blockquote");
      q.append(el("p", {}, `“${quote}”`));
      quotes.append(q);
    }
    part(COPY.quotes, quotes);
  } else {
    part(COPY.quotes, el("p", { class: "muted" }, COPY.noQuotes));
  }
  return article;
}

/**
 * Every Summary, newest first; choosing one shows it in full beside the list (below it on a phone).
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string }} ctx
 */
export function mountSummaries(container, { db, patientId }) {
  const id = `summaries-${++counter}`;
  const block = el("section", { class: "panel summaries", "aria-labelledby": `${id}-heading` });
  const status = el("p", { class: "muted", role: "status" });
  const layout = el("div", { class: "summaries-layout" });
  const listWrap = el("div", { class: "summary-index", role: "region", tabindex: "0", "aria-label": COPY.list });
  const list = el("ul", { class: "summary-buttons" });
  listWrap.append(list);
  const detail = el("div", { class: "summary-pane", "aria-live": "polite" });
  layout.append(listWrap, detail);
  block.append(el("h4", { id: `${id}-heading` }, COPY.heading), el("p", { class: "muted" }, COPY.about), status, layout);
  container.replaceChildren(block);

  /** @type {object | null} */
  let view = null;
  /** @type {object[] | null} */
  let sorted = null;
  let failed = false;
  /** @type {string | null} */
  let selectedId = null;
  let dataVersion = 0;
  /** What the last drawing was made from; a Patient record change that alters none of it redraws nothing. */
  let drawnFrom = "";

  const stop = listenSummaries(db, patientId, (next, error) => {
    sorted = next;
    failed = error;
    dataVersion++;
    render();
  });

  function render() {
    if (!view) return;
    const from = JSON.stringify([dataVersion, selectedId, view.today, view.timeZone]);
    if (from === drawnFrom) return;
    drawnFrom = from;
    if (sorted === null) {
      status.textContent = COPY.loading;
      layout.hidden = true;
      return;
    }
    status.textContent = failed ? COPY.failed : sorted.length ? "" : COPY.none;
    layout.hidden = !sorted.length;
    const selected = selectSummary(sorted, selectedId);
    const focused = list.contains(document.activeElement) ? document.activeElement?.getAttribute("data-id") : null;
    list.replaceChildren(
      ...sorted.map((raw) => {
        const s = summaryView(raw);
        const item = el("li");
        const button = el("button", { type: "button", class: "summary-button", "data-id": s.id, "aria-pressed": String(raw === selected) });
        button.append(el("span", { class: "summary-button-when" }, summaryWhen(s.createdAtMillis, view)), el("span", { class: "summary-button-mood" }, `Mood ${s.ratings[0].text}`));
        button.addEventListener("click", () => {
          selectedId = s.id;
          render();
        });
        item.append(button);
        return item;
      }),
    );
    if (focused) /** @type {HTMLElement | null} */ (list.querySelector(`[data-id="${CSS.escape(focused)}"]`))?.focus();
    detail.replaceChildren(selected ? summaryDetail(summaryView(selected), { ...view, level: 5, idPrefix: `${id}-detail` }) : el("span"));
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

/**
 * The newest Summary, on the Overview.
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string }} ctx
 */
export function mountLatestSummary(container, { db, patientId }) {
  const id = `latest-summary-${++counter}`;
  const block = el("section", { class: "panel latest-summary", "aria-labelledby": `${id}-heading` });
  const status = el("p", { class: "muted", role: "status" });
  const body = el("div");
  const all = el("button", { type: "button", class: "link all-summaries" }, COPY.all);
  all.addEventListener("click", () => {
    // Move to the Summaries section, as the page's section menu does.
    const section = document.getElementById("section-summaries");
    section?.scrollIntoView({ block: "start" });
    section?.querySelector("h3")?.focus({ preventScroll: true });
  });
  block.append(el("h4", { id: `${id}-heading` }, COPY.latest), status, body, all);
  container.replaceChildren(block);

  /** @type {object | null} */
  let view = null;
  /** @type {object[] | null} */
  let sorted = null;
  let failed = false;

  const stop = listenSummaries(db, patientId, (next, error) => {
    sorted = next;
    failed = error;
    render();
  });

  function render() {
    if (!view) return;
    if (sorted === null) {
      status.textContent = COPY.loading;
      return;
    }
    const latest = sorted[0];
    status.textContent = failed ? COPY.failed : latest ? "" : COPY.none;
    all.hidden = !latest;
    body.replaceChildren(...(latest ? [summaryDetail(summaryView(latest), { ...view, level: 5, idPrefix: `${id}-detail` })] : []));
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
