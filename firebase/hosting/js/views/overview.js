// The Overview's timeline (see the slot contract in views/patient.js), laid out as the design's
// `ProgressTimeline` (design/clinician/src/Charts.jsx): "Progress, Phase by Phase", the Phase strip,
// then one lane each for the weekly Mood rating and each Questionnaire kind, on separate scales and
// the same dates, the timeline as a table, and the Visits as markers. Without a TMS end date it shows
// calendar dates, no Phases, and a notice to add the date.
//
// The arithmetic is in js/lib/timeline.js (Phases, weekly means, Questionnaire points) and
// js/lib/design-view.js (the strip and the ticks); the drawing is in views/timeline-chart.js. The
// Check-ins (for the weekly Mood) come from the page's one subscription (`view.docs.checkIns`).
import { addDays, daysBetween, isDateKey, shortDate } from "../lib/dates.js";
import { chartDrawPlan, laneTicks, needsRedraw, phaseStrip } from "../lib/design-view.js";
import { moodByWeek, pointsByKind, questionnairePoints, timelineRows } from "../lib/timeline.js";
import { QUESTIONNAIRE_RANGES, questionnaireLabel } from "../lib/visit.js";
import { LANE, axisOrigin, drawLane, timelineTable, visitScoreText } from "./timeline-chart.js";
import { mountTmsEndForm } from "./tms-end.js";

const COPY = {
  phases: "Progress, Phase by Phase",
  dates: "Progress by date",
  range: (/** @type {string} */ from, /** @type {string} */ to) => `${from} – ${to} · separate scales, same dates`,
  mood: "Mood rating",
  moodNote: "Patient reported · weekly mean · 1–5",
  questionnaire: (/** @type {string} */ kind) => `Recorded at Visits · ${QUESTIONNAIRE_RANGES[kind].min}–${QUESTIONNAIRE_RANGES[kind].max}`,
  noScores: "No Questionnaire scores recorded.",
  note: "Dashed vertical lines mark Visits. Gaps mean no rating that week. Questionnaire scores never determine the Attention flag.",
  table: "View timeline data table",
  empty: "No Mood ratings or Visits yet.",
  ratingsFailed: "Could not load the Mood ratings. Reload the page to try again.",
  tmsEnded: (/** @type {string} */ date) => `TMS ended ${date}`,
  noTms: "TMS end date not recorded",
  visit: (/** @type {string} */ date, /** @type {string} */ score) => `Visit ${date}${score ? ` · ${score}` : ""}`,
  strip: "Phases",
};

const KINDS = /** @type {const} */ (["phq9", "phq2"]);

/** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

let counter = 0;

/**
 * @param {HTMLElement} container
 * @param {{ data: ReturnType<typeof import("../data/design-data.js").designData>, patientId: string }} ctx
 */
export function mountTimeline(container, { data, patientId }) {
  const id = `timeline-${++counter}`;
  const block = el("section", { class: "content-section progress", "aria-labelledby": `${id}-heading` });
  const heading = el("h2", { id: `${id}-heading` });
  const range = el("p", { class: "muted" });
  const headingWrap = el("div", { class: "section-heading" });
  const headingText = el("div");
  headingText.append(heading, range);
  headingWrap.append(headingText);
  const prompt = el("div", { class: "tms-prompt-slot" });
  const strip = el("ol", { class: "phase-strip", "aria-label": COPY.strip });
  const status = el("p", { class: "muted", role: "status" });
  const lanes = el("div", { class: "lanes" });
  const note = el("p", { class: "chart-note" }, COPY.note);
  const details = el("details", { class: "data-disclosure" });
  details.append(el("summary", {}, COPY.table));
  const tableWrap = el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-labelledby": `${id}-caption` });
  details.append(tableWrap);
  const markers = el("div", { class: "visit-markers" });
  block.append(headingWrap, prompt, strip, status, lanes, note, details, markers);
  container.replaceChildren(block);

  const tmsForm = mountTmsEndForm(prompt, { data, patientId, variant: "notice" });

  /** @type {any} */
  let view = null;
  /** @type {{ startedAtMillis?: number, mood?: number | null }[]} */
  let checkIns = [];
  let ratingsFailed = false;
  let drawnWidth = 0;
  /** @type {{ kind: "mood" | "phq2" | "phq9", chart: HTMLElement }[]} */
  let charts = [];

  function model() {
    const { patient, visits, phases, today, timeZone } = view;
    const tmsEndDate = isDateKey(patient.tmsEndDate) ? patient.tmsEndDate : null;
    const shown = visits.filter((/** @type {any} */ v) => isDateKey(v.date) && v.date <= today && (!tmsEndDate || v.date > tmsEndDate));
    const weeks = moodByWeek(checkIns, tmsEndDate, { today, timeZone });
    const points = questionnairePoints(shown, tmsEndDate);
    const origin = axisOrigin({ tmsEndDate, weeks, visits: shown, today });
    const span = Math.max(7, Math.ceil(daysBetween(origin, today) / 7) * 7);
    return { tmsEndDate, today, phases, visits: shown, weeks, points, origin, span };
  }

  function drawCharts() {
    if (!view) return;
    // A hidden tab has no width: nothing is drawn and the width is forgotten, so the ResizeObserver
    // redraws when the tab is shown (lanes were rebuilt empty by render()).
    const plan = chartDrawPlan(lanes.clientWidth);
    drawnWidth = plan.drawnWidth;
    if (!plan.draw) return;
    const width = plan.drawnWidth;
    const d = model();
    const ticks = laneTicks({ origin: d.origin, span: d.span, today: d.today, plotWidth: width - LANE.left - LANE.right });
    for (const { kind, chart } of charts) chart.replaceChildren(drawLane(kind, { ...d, ticks }, width));
  }

  /** @param {string} title @param {string} subtitle @param {"mood" | "phq2" | "phq9"} kind */
  function lane(title, subtitle, kind) {
    const wrap = el("div", { class: `lane-block lane-block-${kind}` });
    const head = el("div", { class: "chart-heading" });
    head.append(el("h3", {}, title), el("span", { class: "muted" }, subtitle));
    const chart = el("div", { class: "chart" });
    wrap.append(head, chart);
    charts.push({ kind, chart });
    return wrap;
  }

  function render() {
    if (!view) return;
    const d = model();
    tmsForm.update(view);
    prompt.hidden = Boolean(d.tmsEndDate);
    heading.textContent = d.tmsEndDate ? COPY.phases : COPY.dates;
    range.textContent = COPY.range(shortDate(addDays(d.origin, 1), d.today), new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(Date.parse(`${d.today}T00:00:00Z`)));

    // The Phase strip, only with a TMS end date: Phases start at the end of TMS.
    const segments = d.tmsEndDate ? phaseStrip(d.phases, { origin: d.origin, span: d.span, today: d.today }) : [];
    strip.hidden = segments.length === 0;
    strip.replaceChildren(
      ...segments.map((s) => {
        const item = el("li", { class: s.spacer ? "phase-spacer" : "phase" });
        item.style.flex = String(s.days);
        if (s.spacer) {
          item.setAttribute("aria-hidden", "true");
          return item;
        }
        item.append(
          el("span", { class: "phase-line", "aria-hidden": "true" }),
          el("strong", { "aria-hidden": "true" }, s.days < 7 ? s.short : s.label),
          ...(s.days >= 10 ? [el("span", { class: "phase-dates", "aria-hidden": "true" }, s.dates)] : []),
          el("span", { class: "visually-hidden" }, `${s.label}: ${s.dates}`),
        );
        item.title = `${s.label}: ${s.dates}`;
        return item;
      }),
    );

    const nothing = !d.weeks.length && !d.visits.length;
    status.textContent = ratingsFailed ? COPY.ratingsFailed : nothing ? COPY.empty : "";
    const kinds = KINDS.filter((k) => pointsByKind(d.points)[k]?.length);
    charts = [];
    lanes.replaceChildren(
      lane(COPY.mood, COPY.moodNote, "mood"),
      ...kinds.map((k) => lane(questionnaireLabel(k), COPY.questionnaire(k), k)),
      ...(kinds.length ? [] : [el("p", { class: "muted no-scores" }, COPY.noScores)]),
    );
    details.hidden = nothing;
    tableWrap.replaceChildren(timelineTable(timelineRows(d.weeks, d.visits, d.phases), { tmsEndDate: d.tmsEndDate, today: d.today, captionId: `${id}-caption` }));
    markers.replaceChildren(
      el("span", {}, d.tmsEndDate ? COPY.tmsEnded(shortDate(d.tmsEndDate, d.today)) : COPY.noTms),
      ...[...d.visits]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((v) => el("span", {}, COPY.visit(shortDate(v.date, d.today), v.questionnaire ? visitScoreText(v) : ""))),
    );
    drawCharts();
  }

  // Redraw at the new width when the page is resized or the tab is shown.
  const resize = new ResizeObserver(() => {
    if (view && needsRedraw(drawnWidth, lanes.clientWidth)) drawCharts();
  });
  resize.observe(lanes);

  return {
    update(next) {
      view = next;
      // Withdrawn sharing is shown by the page; any other failed read is said here.
      checkIns = /** @type {any[]} */ (next.docs?.checkIns ?? []);
      ratingsFailed = next.errors?.checkIns === "error";
      render();
    },
    destroy() {
      resize.disconnect();
      tmsForm.destroy();
      block.remove();
    },
  };
}
