// Drawing the Phase timeline: a hand-made SVG (no chart library) and the same data as a table.
//
// One date axis, in days since the end of TMS (or, without a TMS end date, since the Sunday before
// the first calendar week shown). Lanes, top to bottom, each on its own scale and labelled:
//   Mood rating  the weekly mean on 1 to 5, joined only between weeks that have a rating
//   PHQ-9 score  0 to 27, one marker per Visit with a score, never joined
//   PHQ-2 score  0 to 6, the same
// Phases are shaded bands behind the lanes; each Visit is a dashed line across all lanes. The SVG is
// an image with a text summary; the table below it is the keyboard- and screen-reader-readable copy.
import { addDays, daysBetween, mondayOf, shortDate } from "../lib/dates.js";
import { pointsByKind } from "../lib/timeline.js";
import { QUESTIONNAIRE_RANGES, questionnaireLabel } from "../lib/visit.js";

const NS = "http://www.w3.org/2000/svg";
const KIND_ORDER = /** @type {const} */ (["phq9", "phq2"]);

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

/**
 * @param {object} data
 * @param {import("../lib/timeline.js").WeekMood[]} data.weeks
 * @param {import("../lib/timeline.js").QuestionnairePoint[]} data.points
 * @param {import("../lib/timeline.js").Phase[]} data.phases
 * @param {{ date: string }[]} data.visits valid, not in the future
 * @param {string | null} data.tmsEndDate
 * @param {string} data.today
 * @param {number} width pixels available
 * @returns {SVGSVGElement}
 */
export function drawTimeline({ weeks, points, phases, visits, tmsEndDate, today }, width) {
  const origin = axisOrigin({ tmsEndDate, weeks, visits, today });
  const span = Math.max(7, Math.ceil(daysBetween(origin, today) / 7) * 7);
  const series = pointsByKind(points);
  const kinds = KIND_ORDER.filter((k) => series[k]?.length);

  const W = Math.max(300, Math.round(width));
  const pad = { left: 36, right: 12 };
  const plotW = W - pad.left - pad.right;
  const TOP = 24; // Phase labels
  const LANE_TITLE = 20;
  const MOOD_H = 120;
  const Q_H = 56;
  const AXIS = 44;
  const lanes = [];
  let y = TOP;
  lanes.push({ key: "mood", title: "Mood rating (weekly mean, 1 to 5)", top: y + LANE_TITLE, height: MOOD_H });
  y += LANE_TITLE + MOOD_H + 12;
  for (const kind of kinds) {
    const range = QUESTIONNAIRE_RANGES[kind];
    lanes.push({ key: kind, title: `${questionnaireLabel(kind)} score (${range.min} to ${range.max})`, top: y + LANE_TITLE, height: Q_H });
    y += LANE_TITLE + Q_H + 12;
  }
  if (!kinds.length) {
    lanes.push({ key: "none", title: "Questionnaire scores", top: y + LANE_TITLE, height: 24 });
    y += LANE_TITLE + 24 + 12;
  }
  const plotBottom = y - 12;
  const H = y + AXIS;

  const x = (/** @type {number} */ day) => pad.left + (day / span) * plotW;
  const dayOf = (/** @type {string} */ date) => daysBetween(origin, date); // day d covers (d - 1, d]
  const centre = (/** @type {string} */ date) => x(dayOf(date) - 0.5);

  const root = /** @type {SVGSVGElement} */ (svg("svg", { class: "timeline-chart", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" }));
  const titleId = `timeline-title-${Math.random().toString(36).slice(2, 8)}`;
  const rated = weeks.filter((w) => w.mean !== null).length;
  const summary =
    `Phase timeline: ${phases.length} ${phases.length === 1 ? "Phase" : "Phases"}, ${visits.length} ` +
    `${visits.length === 1 ? "Visit" : "Visits"}, Mood ratings in ${rated} of ${weeks.length} weeks, ` +
    `${points.length} Questionnaire ${points.length === 1 ? "score" : "scores"}. The table below lists the same data.`;
  root.setAttribute("aria-labelledby", titleId);
  root.append(svg("title", { id: titleId }, summary));

  // Phase bands and labels.
  phases.forEach((phase, i) => {
    const from = phase.start ? dayOf(phase.start) - 1 : 0;
    const to = Math.min(span, dayOf(phase.end));
    const x0 = x(Math.max(0, from));
    const x1 = x(to);
    root.append(svg("rect", { class: `phase-band ${i % 2 ? "phase-band-even" : "phase-band-odd"}`, x: x0, y: TOP - 20, width: Math.max(0, x1 - x0), height: plotBottom - TOP + 20 }));
    if (x1 - x0 >= 56) root.append(svg("text", { class: "phase-label", x: (x0 + x1) / 2, y: TOP - 6, "text-anchor": "middle" }, `Phase ${phase.number}`));
  });

  // Week boundaries and the axis labels.
  const weekCount = span / 7;
  const step = plotW / weekCount >= 40 ? 1 : plotW / weekCount >= 20 ? 2 : 4;
  for (let k = 0; k <= weekCount; k++) {
    root.append(svg("line", { class: "grid-week", x1: x(k * 7), x2: x(k * 7), y1: TOP, y2: plotBottom }));
  }
  for (let k = 0; k < weekCount; k += step) {
    const label = tmsEndDate ? String(k + 1) : shortDate(addDays(origin, k * 7 + 1), today);
    root.append(svg("text", { class: "axis-label", x: x(k * 7 + 3.5), y: plotBottom + 16, "text-anchor": "middle" }, label));
  }
  root.append(
    svg(
      "text",
      { class: "axis-title", x: pad.left + plotW / 2, y: plotBottom + 36, "text-anchor": "middle" },
      tmsEndDate ? "Weeks since the end of TMS" : "Calendar weeks, from Monday (no TMS end date)",
    ),
  );

  for (const lane of lanes) {
    root.append(svg("text", { class: "lane-title", x: pad.left, y: lane.top - 6 }, lane.title));
    root.append(svg("rect", { class: "lane", x: pad.left, y: lane.top, width: plotW, height: lane.height }));
    if (lane.key === "mood") drawMood(lane);
    else if (lane.key === "none") root.append(svg("text", { class: "lane-empty", x: pad.left + 8, y: lane.top + 16 }, "None recorded yet."));
    else drawScores(lane, /** @type {"phq2" | "phq9"} */ (lane.key));
  }

  /** @param {{ top: number, height: number }} lane */
  function drawMood(lane) {
    const yOf = (/** @type {number} */ v) => lane.top + lane.height - ((v - 1) / 4) * lane.height;
    for (let v = 1; v <= 5; v++) {
      root.append(svg("line", { class: "grid-value", x1: pad.left, x2: pad.left + plotW, y1: yOf(v), y2: yOf(v) }));
      root.append(svg("text", { class: "axis-label", x: pad.left - 8, y: yOf(v) + 4, "text-anchor": "end" }, String(v)));
    }
    const xy = weeks.map((w) => (w.mean === null ? null : [x(dayOf(w.start) - 1 + 3.5), yOf(w.mean)]));
    // Join only neighbouring weeks that both have a rating: a week with none is a gap.
    let path = "";
    xy.forEach((p, i) => {
      if (!p) return;
      path += `${i > 0 && xy[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    });
    if (path) root.append(svg("path", { class: "mood-line", d: path }));
    xy.forEach((p) => p && root.append(svg("circle", { class: "mood-point", cx: p[0], cy: p[1], r: 4 })));
  }

  /** @param {{ top: number, height: number }} lane @param {"phq2" | "phq9"} kind */
  function drawScores(lane, kind) {
    const { min, max } = QUESTIONNAIRE_RANGES[kind];
    const yOf = (/** @type {number} */ v) => lane.top + lane.height - ((v - min) / (max - min)) * lane.height;
    for (const v of [min, max]) {
      root.append(svg("line", { class: "grid-value", x1: pad.left, x2: pad.left + plotW, y1: yOf(v), y2: yOf(v) }));
      root.append(svg("text", { class: "axis-label", x: pad.left - 8, y: yOf(v) + 4, "text-anchor": "end" }, String(v)));
    }
    for (const point of series[kind] ?? []) {
      const px = centre(point.date);
      const py = yOf(point.score);
      root.append(
        kind === "phq9"
          ? svg("circle", { class: "q-point q-phq9", cx: px, cy: py, r: 5 })
          : svg("rect", { class: "q-point q-phq2", x: px - 5, y: py - 5, width: 10, height: 10, transform: `rotate(45 ${px} ${py})` }),
      );
      const above = py - lane.top > 14;
      root.append(svg("text", { class: "q-label", x: px + 8, y: above ? py - 4 : py + 14 }, String(point.score)));
    }
  }

  // Visits last, so they sit on top.
  for (const visit of visits) {
    const vx = centre(visit.date);
    if (vx < pad.left || vx > pad.left + plotW) continue;
    root.append(svg("line", { class: "visit-line", x1: vx, x2: vx, y1: TOP - 20, y2: plotBottom }));
  }
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
