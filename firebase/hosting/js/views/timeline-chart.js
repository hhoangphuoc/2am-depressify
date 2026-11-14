// Drawing the Phase timeline as the design's chart lanes (`Chart` in design/clinician/src/Charts.jsx):
// one hand-made SVG per lane (no chart library), all on the same date axis, each on its own scale:
//   Mood rating  the weekly mean on 1 to 5, joined only between weeks that have a rating
//   PHQ-9 score  0 to 27, one marker per Visit with a score, never joined
//   PHQ-2 score  0 to 6, the same
// Each Visit is a dashed vertical line in every lane. The Phase strip above the lanes is HTML (views/
// overview.js). Each SVG is an image with a text summary; the table below the lanes is the keyboard-
// and screen-reader-readable copy.
//
// The axis: day 0 is the origin (the TMS end date, or the Sunday before the first calendar week
// shown), and day d covers the date origin + d, so a date's centre is at d - 0.5.
import { addDays, daysBetween, mondayOf, shortDate } from "../lib/dates.js";
import { pointsByKind } from "../lib/timeline.js";
import { QUESTIONNAIRE_RANGES, questionnaireLabel } from "../lib/visit.js";

const NS = "http://www.w3.org/2000/svg";

/** @param {string} tag @param {Record<string, string | number>} [attrs] @param {string} [text] */
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {number} n */
const one = (n) => (Math.round(n * 10) / 10).toFixed(1);

/** @param {{ questionnaire: string | null, score: number | null }} visit */
export function visitScoreText(visit) {
  return visit.questionnaire && Number.isInteger(visit.score)
    ? `${questionnaireLabel(visit.questionnaire)} ${visit.score}`
    : "no Questionnaire score";
}

/**
 * The day the axis counts from: the TMS end date, or the Sunday before the first week shown.
 * @param {{ tmsEndDate: string | null, weeks: { start: string }[], visits: { date: string }[], today: string }} data
 */
export function axisOrigin({ tmsEndDate, weeks, visits, today }) {
  if (tmsEndDate) return tmsEndDate;
  const earliest = [weeks[0]?.start, ...visits.map((v) => v.date), today].filter(Boolean).sort()[0];
  return addDays(mondayOf(earliest), -1);
}

/** The lanes' geometry, in pixels: the same left and right padding as the Phase strip's margins. */
export const LANE = Object.freeze({ left: 43, right: 13, top: 15, bottom: 141, height: 176, labelY: 163 });

/** @param {number} n */
const tickText = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * One lane of the timeline.
 * @param {"mood" | "phq2" | "phq9"} kind
 * @param {object} data
 * @param {string} data.origin
 * @param {number} data.span days on the axis
 * @param {import("../lib/timeline.js").WeekMood[]} data.weeks
 * @param {import("../lib/timeline.js").QuestionnairePoint[]} data.points
 * @param {{ date: string, questionnaire?: string | null, score?: number | null }[]} data.visits valid, not in the future
 * @param {string} data.today
 * @param {{ at: number, label: string }[]} data.ticks from laneTicks()
 * @param {number} width pixels available
 * @returns {SVGSVGElement}
 */
export function drawLane(kind, { origin, span, weeks, points, visits, today, ticks }, width) {
  const W = Math.max(260, Math.round(width));
  const { left, top, bottom, height, labelY } = LANE;
  const right = W - LANE.right;
  const [min, max] = kind === "mood" ? [1, 5] : [QUESTIONNAIRE_RANGES[kind].min, QUESTIONNAIRE_RANGES[kind].max];
  const x = (/** @type {number} */ day) => left + (day / span) * (right - left);
  const y = (/** @type {number} */ v) => bottom - ((v - min) / (max - min)) * (bottom - top);
  const dayOf = (/** @type {string} */ date) => daysBetween(origin, date);
  const centre = (/** @type {string} */ date) => x(dayOf(date) - 0.5);

  const root = /** @type {SVGSVGElement} */ (svg("svg", { class: `lane-chart lane-${kind}`, width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img" }));
  const titleId = `lane-title-${kind}-${Math.random().toString(36).slice(2, 8)}`;
  root.setAttribute("aria-labelledby", titleId);
  const series = kind === "mood" ? [] : pointsByKind(points)[kind] ?? [];
  const what =
    kind === "mood"
      ? `Mood rating, weekly mean, ${min} to ${max}: a rating in ${weeks.filter((w) => w.mean !== null).length} of ${weeks.length} weeks`
      : `${questionnaireLabel(kind)} score, ${min} to ${max}: ${series.length} ${series.length === 1 ? "score" : "scores"} recorded at Visits`;
  root.append(
    svg(
      "title",
      { id: titleId },
      `${what}, ${shortDate(addDays(origin, 1), today)} to ${shortDate(today, today)}. Gaps are weeks without a rating. Dashed vertical lines are Visits. The table below lists the same data.`,
    ),
  );

  for (const v of [min, (min + max) / 2, max]) {
    root.append(svg("line", { class: "grid-value", x1: left, x2: right, y1: y(v), y2: y(v) }));
    root.append(svg("text", { class: "axis-label", x: left - 8, y: y(v) + 4, "text-anchor": "end" }, tickText(v)));
  }
  for (const visit of visits) {
    const vx = centre(visit.date);
    if (vx < left || vx > right) continue;
    root.append(svg("line", { class: "visit-line", x1: vx, x2: vx, y1: top, y2: bottom }));
  }

  if (kind === "mood") {
    const xy = weeks.map((w) => (w.mean === null ? null : [x(dayOf(w.start) - 1 + 3.5), y(w.mean)]));
    // Join only neighbouring weeks that both have a rating: a week with none is a gap.
    let path = "";
    xy.forEach((p, i) => {
      if (!p) return;
      path += `${i > 0 && xy[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    });
    if (path) root.append(svg("path", { class: "value-line", d: path }));
    xy.forEach((p) => p && root.append(svg("circle", { class: "value-point", cx: p[0], cy: p[1], r: 3.5 })));
  } else {
    for (const point of series) {
      const px = centre(point.date);
      const py = y(point.score);
      root.append(svg("circle", { class: "value-point", cx: px, cy: py, r: 3.5 }));
      root.append(svg("text", { class: "point-label", x: px + 7, y: py - top > 14 ? py - 6 : py + 14 }, String(point.score)));
    }
  }

  ticks.forEach((tick, i) => {
    const anchor = i === ticks.length - 1 && x(tick.at) > right - 24 ? "end" : x(tick.at) < left + 24 ? "start" : "middle";
    root.append(svg("text", { class: "axis-label", x: anchor === "end" ? right : x(tick.at), y: labelY, "text-anchor": anchor }, tick.label));
  });
  return root;
}

/**
 * The timeline as a table: one row per week.
 * @param {ReturnType<typeof import("../lib/timeline.js").timelineRows>} rows
 * @param {{ tmsEndDate: string | null, today: string, captionId: string }} options
 */
export function timelineTable(rows, { tmsEndDate, today, captionId }) {
  const table = document.createElement("table");
  table.className = "timeline-table";
  const caption = document.createElement("caption");
  caption.id = captionId;
  caption.textContent = tmsEndDate
    ? "Phase timeline by week since the end of TMS"
    : "Phase timeline by calendar week (no TMS end date yet)";
  table.append(caption);

  const headings = [tmsEndDate ? "Week" : "Week of", "Dates", "Phase", "Mood rating (1 to 5)", "Visits"];
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
  for (const row of rows) {
    const tr = document.createElement("tr");
    const week = document.createElement("th");
    week.scope = "row";
    week.textContent = row.week === null ? shortDate(row.start, today) : `Week ${row.week}`;
    const cells = [
      `${shortDate(row.start, today)} to ${shortDate(row.end, today)}`,
      row.phases.length ? row.phases.map((n) => `Phase ${n}`).join(" and ") : "None",
      row.mean === null ? "No rating" : `${one(row.mean)} from ${row.n} ${row.n === 1 ? "rating" : "ratings"}`,
      row.visits.length ? row.visits.map((v) => `${shortDate(v.date, today)}: ${visitScoreText(v)}`).join("; ") : "None",
    ];
    tr.append(week);
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
