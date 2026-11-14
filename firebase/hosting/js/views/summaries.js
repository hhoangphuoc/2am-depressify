// Summary blocks of the Patient page (see the slot contract in views/patient.js), laid out as the
// design (`SummariesView` and the Overview's "Latest Summary" in design/clinician/src/App.jsx):
//   mountSummaries      slot `summaries-body`: the Summaries, newest first, as a list beside the
//                       selected one in full
//   mountLatestSummary  slot `overview-latest-summary`: the newest Summary, compact, with
//                       "Read Summary", which opens it in the Summaries tab
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
  heading: "Check-in Summaries",
  about: "The same Summaries the Patient reads, newest first. Each was written by AI when the Check-in ended. No transcript or audio is kept.",
  latest: "Latest Summary",
  generated: "generated",
  list: "Choose a Summary",
  loading: "Loading Summaries…",
  failed: "Could not load the Summaries. Reload the page to try again.",
  none: "No Summaries yet. One appears here when the Patient finishes a Check-in.",
  read: "Read Summary",
  badge: "Generated Summary",
  byAi: "Written by AI when the Check-in ended",
  ratings: "Ratings (the Patient's own, 1 to 5)",
  sleep: "Sleep",
  themes: "Themes",
  noThemes: "None noted.",
  suggestion: "Suggestion",
  noSuggestion: "No Suggestion this time.",
  previous: "Previous Outcome",
  noPrevious: "Nothing reported about the previous Suggestion.",
  cues: "Voice cues",
  cuesNote: " · observations",
  noCues: "None noted.",
  quotes: "In the Patient's words",
  footer: "The Patient sees this same Summary. Voice cues are observations.",
  noText: "This Summary has ratings only.",
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

/** The Summary's stored sentences joined, adding no words (as `designSummaries` does). @param {import("../lib/summaries.js").SummaryView} s */
const proseOf = (s) => [s.sleepLine, s.previousOutcome, s.suggestion].filter(Boolean).join(" ");

/** "13 Nov, 09:15" → ["13 Nov", "09:15"]. @param {string} when */
const splitWhen = (when) => {
  const at = when.lastIndexOf(", ");
  return at < 0 ? [when, ""] : [when.slice(0, at), when.slice(at + 2)];
};

/**
 * One Summary in full.
 * @param {import("../lib/summaries.js").SummaryView} summary
 * @param {{ today: string, timeZone: string, idPrefix: string }} options
 */
function summaryDetail(summary, { today, timeZone, idPrefix }) {
  const article = el("article", { class: "summary-detail", "aria-labelledby": `${idPrefix}-title` });
  const top = el("div", { class: "between" });
  top.append(el("h3", { id: `${idPrefix}-title` }, summaryWhen(summary.createdAtMillis, { today, timeZone })), el("span", { class: "generated" }, COPY.badge));
  article.append(top, el("p", { class: "small muted" }, COPY.byAi));

  const ratings = el("dl", { class: "rating-list", "aria-label": COPY.ratings });
  for (const { name, text } of summary.ratings) {
    const pair = el("div");
    pair.append(el("dt", {}, name), el("dd", {}, text));
    ratings.append(pair);
  }
  article.append(ratings);

  const fields = el("dl", { class: "summary-fields" });
  /** @param {string | Node} title @param {Node | string} body @param {boolean} [muted] */
  const part = (title, body, muted = false) => {
    const wrap = el("div");
    const dt = el("dt");
    dt.append(title);
    const dd = el("dd", muted ? { class: "muted" } : {});
    dd.append(body);
    wrap.append(dt, dd);
    fields.append(wrap);
  };
  /** @param {string[]} items @param {string} [cls] */
  const list = (items, cls = "") => {
    const ul = el("ul", { class: `summary-items ${cls}`.trim() });
    for (const item of items) ul.append(el("li", {}, item));
    return ul;
  };

  if (summary.sleepLine) part(COPY.sleep, summary.sleepLine);
  if (summary.themes.length) part(COPY.themes, list(summary.themes, "themes"));
  else part(COPY.themes, COPY.noThemes, true);
  const cueTitle = el("span");
  cueTitle.append(COPY.cues, el("span", { class: "muted" }, COPY.cuesNote));
  if (summary.voiceCues.length) part(cueTitle, list(summary.voiceCues));
  else part(cueTitle, COPY.noCues, true);
  part(COPY.suggestion, summary.suggestion ?? COPY.noSuggestion, !summary.suggestion);
  part(COPY.previous, summary.previousOutcome ?? COPY.noPrevious, !summary.previousOutcome);
  if (summary.quotes.length) {
    const quotes = el("div", { class: "summary-quotes" });
    for (const quote of summary.quotes) {
      const q = el("blockquote");
      q.append(el("p", {}, `“${quote}”`));
      quotes.append(q);
    }
    part(COPY.quotes, quotes);
  }
  article.append(fields, el("p", { class: "small muted summary-footer" }, COPY.footer));
  return article;
}

/**
 * Every Summary, newest first; choosing one shows it in full beside the list (below it on a phone).
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string, page?: { on: (type: string, fn: (detail: any) => void) => () => void } }} ctx
 */
export function mountSummaries(container, { db, patientId, page }) {
  const id = `summaries-${++counter}`;
  const block = el("section", { class: "content-section summaries", "aria-labelledby": `${id}-heading` });
  const heading = el("div", { class: "section-heading" });
  const headingText = el("div");
  headingText.append(el("h2", { id: `${id}-heading` }, COPY.heading), el("p", { class: "small muted" }, COPY.about));
  heading.append(headingText);
  const status = el("p", { class: "muted", role: "status" });
  const layout = el("div", { class: "summary-browser" });
  const list = el("div", { class: "summary-list", role: "group", "aria-label": COPY.list });
  const detail = el("div", { class: "summary-pane", "aria-live": "polite" });
  layout.append(list, detail);
  block.append(heading, status, layout);
  container.replaceChildren(block);

  /** @type {any} */
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
  const stopSelect =
    page?.on("select-summary", (summaryId) => {
      selectedId = summaryId;
      render();
      detail.querySelector("h3")?.setAttribute("tabindex", "-1");
      /** @type {HTMLElement | null} */ (detail.querySelector("h3"))?.focus();
    }) ?? (() => {});

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
        const [day, time] = splitWhen(summaryWhen(s.createdAtMillis, view));
        const button = el("button", { type: "button", "data-id": s.id, "aria-pressed": String(raw === selected) });
        button.append(el("strong", {}, day), el("span", {}, `${time ? `${time} · ` : ""}Mood ${s.ratings[0].text}`));
        button.addEventListener("click", () => {
          selectedId = s.id;
          render();
        });
        return button;
      }),
    );
    if (focused) /** @type {HTMLElement | null} */ (list.querySelector(`[data-id="${CSS.escape(focused)}"]`))?.focus();
    detail.replaceChildren(selected ? summaryDetail(summaryView(selected), { ...view, idPrefix: `${id}-detail` }) : el("span"));
  }

  return {
    update(next) {
      view = next;
      render();
    },
    destroy() {
      stop();
      stopSelect();
      block.remove();
    },
  };
}

/**
 * The newest Summary, compact, on the Overview.
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string, page?: { showTab: (id: string) => void, emit: (type: string, detail?: unknown) => void } }} ctx
 */
export function mountLatestSummary(container, { db, patientId, page }) {
  const id = `latest-summary-${++counter}`;
  const block = el("section", { class: "content-section latest-summary", "aria-labelledby": `${id}-heading` });
  const when = el("p", { class: "small muted" });
  const status = el("p", { class: "muted", role: "status" });
  const text = el("p", { class: "summary-text" });
  const ratings = el("p", { class: "small muted" });
  const read = el("button", { type: "button", class: "text-button" }, COPY.read);
  block.append(el("h2", { id: `${id}-heading` }, COPY.latest), when, status, text, ratings, read);
  container.replaceChildren(block);

  /** @type {any} */
  let view = null;
  /** @type {any[] | null} */
  let sorted = null;
  let failed = false;

  read.addEventListener("click", () => {
    const latest = sorted?.[0];
    if (!latest) return;
    page?.showTab("summaries");
    page?.emit("select-summary", summaryView(latest).id);
  });

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
    for (const node of [when, text, ratings, read]) node.hidden = !latest;
    if (!latest) return;
    const s = summaryView(latest);
    when.textContent = `${summaryWhen(s.createdAtMillis, view)} · ${COPY.generated}`;
    text.textContent = proseOf(s) || COPY.noText;
    ratings.textContent = s.ratings.map((r) => `${r.name} ${r.text}`).join(" · ");
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
