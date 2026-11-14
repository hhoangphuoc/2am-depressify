// Drawing one Signal trend: a hand-made SVG (no chart library), redrawn at the card's width, and the
// same data as a table, which is the keyboard- and screen-reader-readable copy.
//
//   value     a solid line joined only between neighbouring days that both have a value; each value
//             is also a dot, so a lone day still shows. A day without a value is a gap, never 0,
//             and its column is hatched (as in the design's Signal trends).
//   Baseline  the median of the 14 days before each day, dashed, with the usual spread (one spread
//             either side) shaded. It is broken wherever there is no Baseline (fewer than 5 days).
import { shortDate } from "../lib/dates.js";
import { SIGNAL_INFO, comparisonWord, formatValue } from "../lib/signals.js";

const NS = "http://www.w3.org/2000/svg";

/** @param {string} tag @param {Record<string, string | number>} [attrs] @param {string} [text] */
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A short axis number: 7600 → "7.6k", 6.25 → "6.3". @param {number} n */
function axisNumber(n) {
  const abs = Math.abs(n);
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(Math.round(n / 100) / 10).toFixed(1)}k`;
  if (abs >= 100) return String(Math.round(n));
  if (abs >= 10) return String(Math.round(n));
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * A comparison in words, for the table and the card: "1.9 spreads below Baseline, worse than usual".
 * @param {string} key
 * @param {number} comparison
 */
export function comparisonText(key, comparison) {
  const size = Math.abs(comparison);
  const amount = size < 0.05 ? "at Baseline" : `${size.toFixed(1)} ${size >= 0.95 && size < 1.05 ? "spread" : "spreads"} ${comparison > 0 ? "above" : "below"} Baseline`;
  return `${amount}, ${comparisonWord(key, comparison)}`;
}

/**
 * @param {import("../lib/signals.js").SeriesPoint[]} series one point per day, oldest first
 * @param {{ key: string, today: string, width: number }} options
 * @returns {SVGSVGElement}
 */
export function drawSignalChart(series, { key, today, width }) {
  const info = SIGNAL_INFO[/** @type {keyof typeof SIGNAL_INFO} */ (key)];
  const W = Math.max(260, Math.round(width));
  const H = 176;
  const pad = { left: 43, right: 13, top: 15, bottom: 35 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const n = Math.max(1, series.length);

  // The value axis covers the values and the usual spread, with a little room.
  const span = [];
  for (const p of series) {
    if (p.value !== null) span.push(p.value);
    if (p.baseline) span.push(p.baseline.centre - p.baseline.spread, p.baseline.centre + p.baseline.spread);
  }
  let lo = span.length ? Math.min(...span) : 0;
  let hi = span.length ? Math.max(...span) : 1;
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const room = (hi - lo) * 0.08;
  lo -= room;
  hi += room;
  if (lo < 0 && span.every((v) => v >= 0)) lo = 0;

  const x = (/** @type {number} */ i) => pad.left + ((i + 0.5) / n) * plotW;
  const y = (/** @type {number} */ v) => pad.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const root = /** @type {SVGSVGElement} */ (svg("svg", { class: "signal-chart", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" }));
  const titleId = `signal-title-${key}-${Math.random().toString(36).slice(2, 8)}`;
  const valid = series.filter((p) => p.value !== null).length;
  const from = series[0]?.date;
  const to = series.at(-1)?.date;
  root.setAttribute("aria-labelledby", titleId);
  root.append(
    svg(
      "title",
      { id: titleId },
      `${info?.label ?? key}, ${info?.unit ?? ""}: a value on ${valid} of ${series.length} days` +
        (from ? `, ${shortDate(from, today)} to ${shortDate(/** @type {string} */ (to), today)}` : "") +
        ", against the Patient's own Baseline. The table below lists the same data.",
    ),
  );

  // Hatched columns for the days without a value, behind everything else.
  const hatchId = `${titleId}-hatch`;
  const defs = svg("defs");
  const pattern = svg("pattern", { id: hatchId, width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pattern.append(svg("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 4 }));
  defs.append(pattern);
  root.append(defs);
  series.forEach((p, i) => {
    if (p.value !== null) return;
    root.append(svg("rect", { class: "gap-mark", x: x(i) - plotW / n / 2, y: pad.top, width: plotW / n, height: plotH, fill: `url(#${hatchId})` }));
  });

  // Value grid. Durations stored in minutes read in hours, as the cards and the design show them.
  const inHours = key === "sleepMinutes" || key === "timeAtHomeMinutes" || key === "calendarBusyMinutes";
  for (const v of [lo + room, (lo + hi) / 2, hi - room]) {
    root.append(svg("line", { class: "grid-value", x1: pad.left, x2: pad.left + plotW, y1: y(v), y2: y(v) }));
    root.append(svg("text", { class: "axis-label", x: pad.left - 8, y: y(v) + 4, "text-anchor": "end" }, inHours ? `${(v / 60).toFixed(1)}h` : axisNumber(v)));
  }

  // The usual spread and the Baseline, in runs of days that have one.
  /** @type {number[][]} */
  const runs = [];
  series.forEach((p, i) => {
    if (!p.baseline) return;
    const last = runs.at(-1);
    if (last && last.at(-1) === i - 1) last.push(i);
    else runs.push([i]);
  });
  for (const run of runs) {
    const half = run.length === 1 ? 0.5 * (plotW / n) * 0.8 : 0;
    const upper = run.map((i) => `${(x(i) - half).toFixed(1)},${y(series[i].baseline.centre + series[i].baseline.spread).toFixed(1)}`);
    const lower = run.map((i) => `${(x(i) + half).toFixed(1)},${y(series[i].baseline.centre - series[i].baseline.spread).toFixed(1)}`).reverse();
    if (half) {
      const i = run[0];
      const b = series[i].baseline;
      upper.push(`${(x(i) + half).toFixed(1)},${y(b.centre + b.spread).toFixed(1)}`);
      lower.push(`${(x(i) - half).toFixed(1)},${y(b.centre - b.spread).toFixed(1)}`);
    }
    root.append(svg("polygon", { class: "baseline-band", points: [...upper, ...lower].join(" ") }));
    const line = run.map((i, k) => `${k ? "L" : "M"}${(x(i) - half).toFixed(1)},${y(series[i].baseline.centre).toFixed(1)}`).join("");
    root.append(svg("path", { class: "baseline-line", d: half ? `${line}L${(x(run[0]) + half).toFixed(1)},${y(series[run[0]].baseline.centre).toFixed(1)}` : line }));
  }

  // Values: joined only between neighbouring days that both have one.
  let path = "";
  series.forEach((p, i) => {
    if (p.value === null) return;
    path += `${i > 0 && series[i - 1].value !== null ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  if (path) root.append(svg("path", { class: "value-line", d: path }));
  series.forEach((p, i) => {
    if (p.value !== null) root.append(svg("circle", { class: "value-point", cx: x(i), cy: y(p.value), r: n > 60 ? 1.8 : 2.4 }));
  });

  // Dates: the first and last day, and the middle when there is room.
  const labels = [[0, "start"], [n - 1, "end"]];
  if (plotW >= 360 && n >= 5) labels.push([Math.floor((n - 1) / 2), "middle"]);
  for (const [i, anchor] of labels) {
    const date = series[/** @type {number} */ (i)]?.date;
    if (!date) continue;
    root.append(
      svg(
        "text",
        { class: "axis-label", x: anchor === "start" ? pad.left : anchor === "end" ? pad.left + plotW : x(/** @type {number} */ (i)), y: H - 13, "text-anchor": /** @type {string} */ (anchor) },
        shortDate(date, today),
      ),
    );
  }
  return root;
}

/**
 * The trend as a table: one row per day, oldest first, gaps included.
 * @param {import("../lib/signals.js").SeriesPoint[]} series
 * @param {{ key: string, today: string, captionId: string }} options
 */
export function signalTable(series, { key, today, captionId }) {
  const info = SIGNAL_INFO[/** @type {keyof typeof SIGNAL_INFO} */ (key)];
  const table = document.createElement("table");
  table.className = "signal-table";
  const caption = document.createElement("caption");
  caption.id = captionId;
  caption.textContent = `${info?.label ?? key} by day, in ${info?.unit ?? "its unit"}, with the Patient's own Baseline`;
  table.append(caption);

  const headings = ["Date", "Value", "Baseline (median of the 14 days before)", "Compared with Baseline"];
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of headings) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement("tbody");
  for (const point of series) {
    const tr = document.createElement("tr");
    const date = document.createElement("th");
    date.scope = "row";
    date.textContent = shortDate(point.date, today);
    const compared =
      point.value === null
        ? "No value"
        : point.comparison === null && point.baselineDays >= 5
          ? "No comparison stored"
          : point.comparison === null
          ? `Insufficient Baseline: ${point.baselineDays} valid ${point.baselineDays === 1 ? "day" : "days"} in the 14 before, 5 needed`
          : comparisonText(key, point.comparison);
    const cells = [formatValue(key, point.value), point.baseline ? formatValue(key, point.baseline.centre) : "None yet", compared];
    tr.append(date);
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.dataset.label = headings[i + 1];
      td.textContent = text;
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(body);
  return table;
}
