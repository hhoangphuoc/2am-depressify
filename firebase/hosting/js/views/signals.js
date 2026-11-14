// The Signals section's block (slot `signals-body`; see the slot contract in views/patient.js), laid
// out as the design's `SignalTrends` (design/clinician/src/Charts.jsx): a Phase selector and one
// trend card per Signal, all nine, in two columns, against the Patient's own Baseline for the
// selected Phase. The arithmetic is in js/lib/signals.js; the drawing is in views/signal-chart.js.
//
// Each trend states its unit, date range, number of valid days and whether the data is synthetic or
// from the Patient's device. States: no Consent (nothing is drawn), no source data, stale, no values
// in the range, and insufficient Baseline. Time at home and movement radius are daily totals made on
// the phone; no place or coordinate is ever read here.
//
// Draws `daily` and `consents` from the page's one subscription (`view.docs`); it opens no listener.
import { SIGNALS } from "../lib/contract.js";
import { daysBetween, shortDate } from "../lib/dates.js";
import { chartDrawPlan, needsRedraw } from "../lib/design-view.js";
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
  heading: "Signals",
  about: "Compared with this Patient's own previous 14 days · at least 5 valid days",
  legend:
    "In each chart the solid line is the daily value, the dashed line is the Baseline (the median of the 14 days before " +
    "each day) and the shaded band is one usual spread either side. Hatched columns are days with no value: a gap, never zero.",
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
  table: (/** @type {string} */ label) => `View ${label.toLowerCase()} data table`,
  baselineLine: (/** @type {string} */ value, /** @type {number} */ n) => `Dashed line: Baseline ${value} · ${n} valid ${n === 1 ? "day" : "days"} in the 14 before`,
  missing: "Missing",
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
 */
export function mountSignals(container) {
  const id = `signals-${++counter}`;
  const block = el("section", { class: "content-section signals", "aria-labelledby": `${id}-heading` });
  const controls = el("div", { class: "signal-controls field" });
  const selectLabel = el("label", { for: `${id}-phase` }, COPY.select);
  const select = /** @type {HTMLSelectElement} */ (el("select", { id: `${id}-phase`, "aria-describedby": `${id}-range` }));
  const range = el("p", { class: "small muted", id: `${id}-range` });
  controls.append(selectLabel, select, range);
  const status = el("p", { class: "muted", role: "status" });
  const grid = el("div", { class: "signal-grid" });
  const headingText = el("div");
  headingText.append(el("h2", { id: `${id}-heading` }, COPY.heading), el("p", { class: "muted" }, COPY.about));
  const heading = el("div", { class: "section-heading" });
  heading.append(headingText, controls);
  block.append(heading, el("p", { class: "small muted signal-legend" }, COPY.legend), status, grid);
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

  /** The page's documents last read, to tell whether they changed. */
  /** @type {object[] | null | undefined} */
  let dailyDocs;
  /** @type {object[] | null | undefined} */
  let consentDocs;

  /** Reads `daily` and `consents` from the page's view; a failed read is said here, withdrawal by the page. */
  function read(/** @type {any} */ next) {
    const errors = next.errors ?? {};
    failed = errors.daily === "error" || errors.consents === "error";
    const nextDaily = next.docs?.daily;
    const nextConsents = next.docs?.consents;
    if (nextDaily !== dailyDocs || nextConsents !== consentDocs) dataVersion++;
    dailyDocs = nextDaily;
    consentDocs = nextConsents;
    // A failed read shows as empty with the notice; a Signal without a known Consent is not shown.
    daily = nextDaily ? nextDaily.map((/** @type {any} */ d) => ({ ...d, date: d.date ?? d.id })) : failed ? [] : null;
    consents = nextConsents ? Object.fromEntries(nextConsents.map((/** @type {any} */ d) => [d.id, d])) : failed ? {} : null;
  }

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
    const article = el("article", { class: "signal", "aria-labelledby": `${cardId}-heading` });
    const head = el("div", { class: "chart-heading" });
    const latestValue = el("span", {});
    head.append(el("h3", { id: `${cardId}-heading` }, info.label), latestValue);
    article.append(head, el("p", { class: "small muted" }, `${info.unit} · ${source}`));
    if (info.fromLocation) article.append(el("p", { class: "small muted" }, COPY.location));

    const state = signalState({ consent: consents?.[key], docs: daily ?? [], key, today });
    if (state === "no_consent" || state === "no_data") {
      const empty = el("div", { class: "signal-empty" }, state === "no_consent" ? COPY.noConsent : COPY.noData(source));
      empty.append(el("p", { class: "muted" }, "Missing data is not zero."));
      article.append(empty);
      return article;
    }

    const series = signalSeries(daily ?? [], key, window);
    const summary = signalSummary(series, key);
    const latest = summary.latest;
    latestValue.textContent = latest ? formatValue(key, latest.value) : COPY.missing;
    article.append(
      el(
        "p",
        { class: "small muted" },
        `${shortDate(window.start, today)} to ${shortDate(window.end, today)} · ${summary.validDays} of ${summary.days} ` +
          `${summary.days === 1 ? "day" : "days"} with a value`,
      ),
    );
    if (state === "stale" && window.end === today) {
      const last = /** @type {string} */ (lastValueDate(daily ?? [], key, today));
      article.append(el("p", { class: "notice stale-notice" }, COPY.stale(shortDate(last, today), daysBetween(last, today))));
    }

    /** @type {string} */
    let baselineText = "";
    if (summary.status === "no_values") {
      article.append(el("p", { class: "notice" }, COPY.noValues));
    } else if (latest) {
      const lines = [COPY.latest(shortDate(latest.date, today), formatValue(key, latest.value))];
      if (summary.status === "compared") {
        if (latest.baseline) {
          lines.push(COPY.baseline(formatValue(key, latest.baseline.centre)));
          baselineText = COPY.baselineLine(formatValue(key, latest.baseline.centre), latest.baselineDays);
        }
        const comparison = el("p", { class: "signal-comparison" }, lines.join(" "));
        comparison.append(el("strong", {}, ` ${capitalise(comparisonText(key, /** @type {number} */ (summary.comparison)))}.`));
        article.append(comparison);
      } else {
        article.append(el("p", { class: "signal-comparison" }, lines.join(" ")));
        baselineText =
          summary.reason === "range"
            ? COPY.insufficientRange(summary.validDays)
            : latest.baselineDays >= 5
              ? COPY.noStored(shortDate(latest.date, today))
              : COPY.insufficientBaseline(shortDate(latest.date, today), latest.baselineDays);
      }
    }
    if (!hasDirection(key)) article.append(el("p", { class: "small muted" }, COPY.noDirection));

    const chart = el("div", { class: "chart signal-chart-wrap" });
    article.append(chart);
    charts.push({ key, chart, series });
    if (baselineText) article.append(el("p", { class: "baseline-label" }, baselineText));

    const details = /** @type {HTMLDetailsElement} */ (el("details", { class: "data-disclosure" }));
    details.open = openTables.has(key);
    details.addEventListener("toggle", () => (details.open ? openTables.add(key) : openTables.delete(key)));
    details.append(el("summary", {}, COPY.table(info.label)));
    const wrap = el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-labelledby": `${cardId}-caption` });
    wrap.append(signalTable(series, { key, today, captionId: `${cardId}-caption` }));
    details.append(wrap);
    article.append(details);
    return article;
  }

  function drawCharts() {
    if (!view) return;
    // A hidden tab has no width: nothing is drawn and the width is forgotten, so the ResizeObserver
    // redraws when the tab is shown (render() rebuilt the cards with empty charts).
    const plan = chartDrawPlan(grid.clientWidth);
    drawnWidth = plan.drawnWidth;
    if (!plan.draw) return;
    for (const { key, chart, series } of charts) {
      chart.replaceChildren(drawSignalChart(/** @type {any} */ (series), { key, today: view.today, width: chart.clientWidth || 320 }));
    }
  }

  // Redraw at the new width when the page is resized, so the text stays readable on a phone.
  const resize = new ResizeObserver(() => {
    if (view && needsRedraw(drawnWidth, grid.clientWidth)) drawCharts();
  });
  resize.observe(grid);

  return {
    update(next) {
      view = next;
      read(next);
      render();
    },
    destroy() {
      resize.disconnect();
      block.remove();
    },
  };
}

/** @param {string} text */
function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
