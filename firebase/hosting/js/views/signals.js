// The Signals section's block (slot `signals-body`; see the slot contract in views/patient.js): a
// Phase selector and one trend per Signal, all nine, against the Patient's own Baseline for the
// selected Phase. The arithmetic is in js/lib/signals.js; the drawing is in views/signal-chart.js.
//
// Each trend states its unit, date range, number of valid days and whether the data is synthetic or
// from the Patient's device. States: no Consent (nothing is drawn), no source data, stale, no values
// in the range, and insufficient Baseline. Time at home and movement radius are daily totals made on
// the phone; no place or coordinate is ever read here.
//
// Listens to `daily` and `consents` only, and stops both in destroy().
import { onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { patientQuery } from "../queries.js";
import { COLLECTIONS, SIGNALS } from "../lib/contract.js";
import { daysBetween, shortDate } from "../lib/dates.js";
import {
  SIGNAL_INFO,
  defaultSelection,
  firstDataDate,
  formatValue,
  hasDirection,
  lastValueDate,
  signalSeries,
  signalState,
  signalSummary,
  signalWindow,
  sourceLabel,
} from "../lib/signals.js";
import { comparisonText, drawSignalChart, signalTable } from "./signal-chart.js";

const COPY = {
  heading: "Signal trends",
  about:
    "Each Signal is compared only with this Patient's own Baseline: the median of the 14 days before each day, " +
    "with at least 5 days that have a value. The shaded band is one usual spread either side. A day without a " +
    "value is a gap, never zero.",
  legend: "In each chart: the solid line is the daily value, the dashed line is the Baseline, the shaded band is the usual spread, and a tick on the floor marks a day with no value.",
  location: "Made on the phone from location samples, which never leave it. Only this daily total is shared.",
  select: "Phase shown",
  all: "All days",
  loading: "Loading Signals…",
  failed: "Could not load the Signals. Reload the page to try again.",
  noConsent: "Not shared: the Patient has not switched this Signal on in their app.",
  noData: (source) => `No data yet from the source (${source.toLowerCase()}).`,
  stale: (date, days) => `Stale: the latest value is from ${date}, ${days} days ago.`,
  noValues: "No values in this range. The days are shown as gaps.",
  insufficientRange: (n) =>
    `Insufficient Baseline: ${n} valid ${n === 1 ? "day" : "days"} in this range, and 5 are needed for a comparison.`,
  insufficientBaseline: (date, n) =>
    `Insufficient Baseline: ${n} valid ${n === 1 ? "day" : "days"} in the 14 days before ${date}, and 5 are needed for a comparison.`,
  noStored: (date) => `No comparison was stored for ${date}.`,
  latest: (date, value) => `Latest, ${date}: ${value}.`,
  baseline: (value) => `Baseline ${value}.`,
  noDirection: "This Signal has no better or worse direction; it is shown for context.",
  table: "Show as a table",
};

let counter = 0;

/** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {import("../lib/timeline.js").Phase} phase @param {string} fallbackStart @param {string} today */
function phaseOptionText(phase, fallbackStart, today) {
  const start = phase.start ?? fallbackStart;
  const current = phase.to.kind === "today" ? " (current)" : "";
  return `Phase ${phase.number}${current}: ${shortDate(start, today)} to ${shortDate(phase.end, today)}`;
}

/**
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string }} ctx
 */
export function mountSignals(container, { db, patientId }) {
  const id = `signals-${++counter}`;
  const block = el("section", { class: "panel signals", "aria-labelledby": `${id}-heading` });
  const controls = el("div", { class: "signal-controls" });
  const selectLabel = el("label", { for: `${id}-phase` }, COPY.select);
  const select = /** @type {HTMLSelectElement} */ (el("select", { id: `${id}-phase`, "aria-describedby": `${id}-range` }));
  const range = el("p", { class: "muted", id: `${id}-range` });
  controls.append(selectLabel, select, range);
  const status = el("p", { class: "muted", role: "status" });
  const grid = el("div", { class: "signal-grid" });
  block.append(el("h4", { id: `${id}-heading` }, COPY.heading), el("p", { class: "muted" }, COPY.about), el("p", { class: "muted hint" }, COPY.legend), controls, status, grid);
  container.replaceChildren(block);

  /** @type {object | null} */
  let view = null;
  /** @type {object[] | null} */
  let daily = null;
  /** @type {Record<string, object> | null} */
  let consents = null;
  let failed = false;
  /** @type {number | "all" | null} null follows the current Phase */
  let chosen = null;
  /** @type {{ key: string, chart: HTMLElement, series: object[] }[]} */
  let charts = [];
  let drawnWidth = 0;
  /** The Signals whose table is open, kept open across redraws. */
  const openTables = new Set();
  /** What the last drawing was made from; a Patient record change that alters none of it redraws nothing. */
  let drawnFrom = "";
  let dataVersion = 0;

  select.addEventListener("change", () => {
    chosen = select.value === "all" ? "all" : Number(select.value);
    render();
  });

  /** @param {{ code?: string }} error */
  const onError = (error) => {
    // Withdrawn sharing is shown by the page; anything else is said here.
    failed = error?.code !== "permission-denied";
    dataVersion++;
    daily ??= [];
    consents ??= {};
    render();
  };
  const stopDaily = onSnapshot(
    patientQuery(db, patientId, COLLECTIONS.daily),
    (snapshot) => {
      daily = snapshot.docs.map((d) => ({ date: d.id, ...d.data() }));
      failed = false;
      dataVersion++;
      render();
    },
    onError,
  );
  const stopConsents = onSnapshot(
    patientQuery(db, patientId, COLLECTIONS.consents),
    (snapshot) => {
      consents = Object.fromEntries(snapshot.docs.map((d) => [d.id, d.data()]));
      dataVersion++;
      render();
    },
    onError,
  );

  function drawOptions(phases, firstDate, today, selection) {
    const options = phases.map((p) => {
      const option = /** @type {HTMLOptionElement} */ (el("option", { value: String(p.number) }, phaseOptionText(p, firstDate ?? today, today)));
      option.selected = selection === p.number;
      return option;
    });
    const all = /** @type {HTMLOptionElement} */ (el("option", { value: "all" }, COPY.all));
    all.selected = selection === "all";
    select.replaceChildren(...options, all);
  }

  function render() {
    if (!view) return;
    const { patient, phases, today } = view;
    if (daily === null || consents === null) {
      status.textContent = COPY.loading;
      return;
    }
    status.textContent = failed ? COPY.failed : "";
    const from = JSON.stringify([dataVersion, chosen, today, patient.healthSource, phases]);
    if (from === drawnFrom) return;
    drawnFrom = from;
    const firstDate = firstDataDate(daily, today);
    const known = chosen === "all" || phases.some((p) => p.number === chosen);
    const selection = chosen !== null && known ? chosen : defaultSelection(phases);
    drawOptions(phases, firstDate, today, selection);
    const window = signalWindow(selection, phases, { firstDate, today });
    const source = sourceLabel(patient.healthSource);
    range.textContent = `${shortDate(window.start, today)} to ${shortDate(window.end, today)} · ${source}`;

    charts = [];
    grid.replaceChildren(...SIGNALS.map(({ key }) => card(key, window, today, source)));
    drawCharts();
  }

  /**
   * @param {string} key
   * @param {{ start: string, end: string }} window
   * @param {string} today
   * @param {string} source
   */
  function card(key, window, today, source) {
    const info = SIGNAL_INFO[/** @type {keyof typeof SIGNAL_INFO} */ (key)];
    const cardId = `${id}-${key}`;
    const article = el("article", { class: "signal-card", "aria-labelledby": `${cardId}-heading` });
    article.append(el("h5", { id: `${cardId}-heading` }, info.label), el("p", { class: "signal-unit" }, `Unit: ${info.unit}`));
    if (info.fromLocation) article.append(el("p", { class: "muted hint" }, COPY.location));

    const state = signalState({ consent: consents?.[key], docs: daily ?? [], key, today });
    if (state === "no_consent") {
      article.append(el("p", { class: "notice" }, COPY.noConsent));
      return article;
    }
    if (state === "no_data") {
      article.append(el("p", { class: "notice" }, COPY.noData(source)));
      return article;
    }

    const series = signalSeries(daily ?? [], key, window);
    const summary = signalSummary(series, key);
    article.append(
      el(
        "p",
        { class: "signal-meta" },
        `${shortDate(window.start, today)} to ${shortDate(window.end, today)} · ${summary.validDays} of ${summary.days} ` +
          `${summary.days === 1 ? "day" : "days"} with a value · ${source}`,
      ),
    );
    if (state === "stale" && window.end === today) {
      const last = /** @type {string} */ (lastValueDate(daily ?? [], key, today));
      article.append(el("p", { class: "notice stale-notice" }, COPY.stale(shortDate(last, today), daysBetween(last, today))));
    }

    const latest = summary.latest;
    if (summary.status === "no_values") {
      article.append(el("p", { class: "notice" }, COPY.noValues));
    } else if (latest) {
      const lines = [COPY.latest(shortDate(latest.date, today), formatValue(key, latest.value))];
      if (summary.status === "compared") {
        if (latest.baseline) lines.push(COPY.baseline(formatValue(key, latest.baseline.centre)));
        const comparison = el("p", { class: "signal-comparison" }, lines.join(" "));
        comparison.append(el("strong", {}, ` ${capitalise(comparisonText(key, /** @type {number} */ (summary.comparison)))}.`));
        article.append(comparison);
      } else {
        article.append(el("p", { class: "signal-comparison" }, lines.join(" ")));
        const why =
          summary.reason === "range"
            ? COPY.insufficientRange(summary.validDays)
            : latest.baselineDays >= 5
              ? COPY.noStored(shortDate(latest.date, today))
              : COPY.insufficientBaseline(shortDate(latest.date, today), latest.baselineDays);
        article.append(el("p", { class: "notice" }, why));
      }
    }
    if (!hasDirection(key)) article.append(el("p", { class: "muted hint" }, COPY.noDirection));

    const chart = el("div", { class: "chart signal-chart-wrap" });
    article.append(chart);
    charts.push({ key, chart, series });

    const details = /** @type {HTMLDetailsElement} */ (el("details", { class: "timeline-data" }));
    details.open = openTables.has(key);
    details.addEventListener("toggle", () => (details.open ? openTables.add(key) : openTables.delete(key)));
    details.append(el("summary", {}, COPY.table));
    const wrap = el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-labelledby": `${cardId}-caption` });
    wrap.append(signalTable(series, { key, today, captionId: `${cardId}-caption` }));
    details.append(wrap);
    article.append(details);
    return article;
  }

  function drawCharts() {
    if (!view) return;
    drawnWidth = grid.clientWidth;
    for (const { key, chart, series } of charts) {
      chart.replaceChildren(drawSignalChart(/** @type {any} */ (series), { key, today: view.today, width: chart.clientWidth || 320 }));
    }
  }

  // Redraw at the new width when the page is resized, so the text stays readable on a phone.
  const resize = new ResizeObserver(() => {
    if (view && Math.abs(grid.clientWidth - drawnWidth) > 8) drawCharts();
  });
  resize.observe(grid);

  return {
    update(next) {
      view = next;
      render();
    },
    destroy() {
      stopDaily();
      stopConsents();
      resize.disconnect();
      block.remove();
    },
  };
}

/** @param {string} text */
function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
