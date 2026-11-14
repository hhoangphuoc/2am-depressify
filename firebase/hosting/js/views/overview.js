// Overview blocks of the Patient page (see the slot contract in views/patient.js):
//   mountAttention  the Attention flag level word and its reasons, first on the page
//   mountTimeline   the Phase timeline: weeks since the end of TMS, Phases between Visits, the weekly
//                   Mood rating and Questionnaire scores in separate lanes, and the same as a table.
//                   Without a TMS end date it shows calendar weeks and asks for the date.
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { isDateKey, shortDate } from "../lib/dates.js";
import { levelWord } from "../lib/list-row.js";
import { moodByWeek, questionnairePoints, timelineRows } from "../lib/timeline.js";
import { drawTimeline, timelineTable } from "./timeline-chart.js";
import { mountTmsEndForm } from "./tms-end.js";

const COPY = {
  attention: "Attention flag",
  nothingRaised: "Nothing raised.",
  noReason: "No reason recorded.",
  timeline: "Phase timeline",
  about:
    "Each Visit starts a new Phase. The Mood rating is the weekly mean of the Patient's own 1 to 5 ratings; a week " +
    "without one is left as a gap. Questionnaire scores are the ones recorded at Visits, each on its own scale.",
  noTms: "Enter the date TMS ended to read the timeline in weeks since TMS. Until then it shows calendar weeks.",
  phases: "Phases",
  empty: "No Mood ratings or Visits yet.",
  table: "Show the timeline as a table",
  ratingsFailed: "Could not load the Mood ratings. Reload the page to try again.",
};

/** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The level word and reasons, as on the Patient list.
 * @param {HTMLElement} container
 */
export function mountAttention(container) {
  const block = el("section", { class: "panel attention", "aria-labelledby": "attention-heading" });
  container.replaceChildren(block);
  return {
    update({ patient }) {
      const level = ["red", "amber"].includes(patient.flagLevel) ? patient.flagLevel : "green";
      const given = Array.isArray(patient.flagReasons) ? patient.flagReasons.filter((r) => typeof r === "string" && r) : [];
      const reasons = given.length ? given : [level === "green" ? COPY.nothingRaised : COPY.noReason];
      const heading = el("h4", { id: "attention-heading" }, COPY.attention);
      const chip = el("span", { class: `level level-${level}` }, levelWord(level));
      const list = el("ul", { class: "reasons" });
      for (const reason of reasons) list.append(el("li", {}, reason));
      const row = el("div", { class: "attention-row" });
      row.append(chip, list);
      block.replaceChildren(heading, row);
    },
    destroy() {
      block.remove();
    },
  };
}

/** @param {import("../lib/timeline.js").Phase} phase @param {string} today @param {boolean} hasTms */
function phaseText(phase, today, hasTms) {
  const from = phase.from.kind === "tms_end" ? (hasTms ? "the end of TMS" : null) : `the Visit on ${shortDate(phase.from.date, today)}`;
  const to = phase.to.kind === "today" ? "today" : `the Visit on ${shortDate(phase.to.date, today)}`;
  const weeks =
    phase.startWeek === null || phase.endWeek === null
      ? ""
      : phase.startWeek === phase.endWeek
        ? `week ${phase.startWeek}, `
        : `weeks ${phase.startWeek} to ${phase.endWeek}, `;
  return `Phase ${phase.number}: ${weeks}${from ? `from ${from} to ${to}` : `until ${to}`}`;
}

/**
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string }} ctx
 */
export function mountTimeline(container, { db, patientId }) {
  const block = el("section", { class: "panel timeline", "aria-labelledby": "timeline-heading" });
  const prompt = el("div", { class: "notice tms-prompt" });
  const promptText = el("p", {}, COPY.noTms);
  const promptForm = el("div");
  prompt.append(promptText, promptForm);
  const phaseList = el("ol", { class: "phase-list", "aria-label": COPY.phases });
  const status = el("p", { class: "muted", role: "status" });
  const chart = el("div", { class: "chart" });
  const details = el("details", { class: "timeline-data" });
  details.append(el("summary", {}, COPY.table));
  const tableWrap = el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-labelledby": "timeline-table-caption" });
  details.append(tableWrap);
  block.append(el("h4", { id: "timeline-heading" }, COPY.timeline), el("p", { class: "muted" }, COPY.about), prompt, phaseList, status, chart, details);
  container.replaceChildren(block);

  const tmsForm = mountTmsEndForm(promptForm, { db, patientId });

  /** @type {object | null} */
  let view = null;
  /** @type {{ startedAtMillis?: number, mood?: number | null }[]} */
  let checkIns = [];
  let ratingsFailed = false;
  let drawnWidth = 0;

  const stopCheckIns = onSnapshot(
    collection(db, COLLECTIONS.patients, patientId, COLLECTIONS.checkIns),
    (snapshot) => {
      checkIns = snapshot.docs.map((d) => d.data());
      ratingsFailed = false;
      render();
    },
    (error) => {
      checkIns = [];
      // Withdrawn sharing is shown by the page; anything else is said here.
      ratingsFailed = error?.code !== "permission-denied";
      render();
    },
  );

  function data() {
    const { patient, visits, phases, today, timeZone } = view;
    const tmsEndDate = isDateKey(patient.tmsEndDate) ? patient.tmsEndDate : null;
    const shown = visits.filter((v) => isDateKey(v.date) && v.date <= today && (!tmsEndDate || v.date > tmsEndDate));
    const weeks = moodByWeek(checkIns, tmsEndDate, { today, timeZone });
    return { tmsEndDate, today, phases, visits: shown, weeks, points: questionnairePoints(shown, tmsEndDate) };
  }

  function drawChart() {
    const d = data();
    if (!d.weeks.length && !d.visits.length) {
      chart.replaceChildren();
      return;
    }
    drawnWidth = chart.clientWidth;
    chart.replaceChildren(drawTimeline(d, drawnWidth || 640));
  }

  function render() {
    if (!view) return;
    const d = data();
    prompt.hidden = Boolean(d.tmsEndDate);
    tmsForm.update(view);
    phaseList.replaceChildren(...d.phases.map((p) => el("li", {}, phaseText(p, d.today, Boolean(d.tmsEndDate)))));
    const nothing = !d.weeks.length && !d.visits.length;
    status.textContent = ratingsFailed ? COPY.ratingsFailed : nothing ? COPY.empty : "";
    details.hidden = nothing;
    tableWrap.replaceChildren(
      timelineTable(timelineRows(d.weeks, d.visits, d.phases), { tmsEndDate: d.tmsEndDate, today: d.today, captionId: "timeline-table-caption" }),
    );
    drawChart();
  }

  // Redraw at the new width when the page is resized, so the text stays readable on a phone.
  const resize = new ResizeObserver(() => {
    if (view && Math.abs(chart.clientWidth - drawnWidth) > 8) drawChart();
  });
  resize.observe(chart);

  return {
    update(next) {
      view = next;
      render();
    },
    destroy() {
      stopCheckIns();
      resize.disconnect();
      tmsForm.destroy();
      block.remove();
    },
  };
}
