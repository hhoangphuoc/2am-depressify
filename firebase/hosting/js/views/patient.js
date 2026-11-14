// The Patient page (`#/patient/{id}`), laid out as the design prototype (design/clinician): a back
// link, the header (name, week since TMS, Record a Visit), the Attention band, and four sections as
// tabs: Overview, Summaries, Signals, Intake & Visits. The Overview puts the Phase timeline in two
// thirds of the width and the latest Summary, what seems to help and the Digest in a one-third
// column; at phone width everything is one column.
//
// ─── Slot contract ──────────────────────────────────────────────────────────────────────────────
// This file creates every section and an empty <div class="slot" id="slot-NAME"> for each block, in
// page order, and mounts the modules listed in SLOT_MOUNTS into them. A block module exports
//
//     mountSomething(container, ctx) → { update(view), destroy(), ...actions }
//
//   container  the slot's <div>. The module owns everything inside it and nothing outside, except
//              its own modal dialogs (views/dialog.js), which it removes in destroy().
//   ctx        fixed for the page: { data, patientId, calls, page }
//                data       the design data layer, `designData({ db, app })` (js/data/design-data.js).
//                           Blocks write only through its actions (`recordVisit`, `setTmsEndDate`,
//                           `clearAttention`), which check the input and map errors to safe copy.
//                patientId  the Patient's document id
//                calls      the callables (js/functions.js): { extract, save, generateDigest }
//                page       { showTab(id), on(type, fn), emit(type, detail) }: switch tabs and pass
//                           small requests between blocks (for example "read this Summary")
//   view       passed to update() on every change of the Patient's data, and once right after
//              mounting:
//                patient    the live PatientDoc (js/lib/contract.js)
//                visits     the Visits, newest first, each { id, date, questionnaire, score }
//                phases     phases(patient.tmsEndDate, visits, today) from js/lib/timeline.js.
//                today      yyyy-MM-dd in the browser's time zone
//                timeZone   the browser's time zone, for giving a millisecond time its date
//                state      the PatientState from `data.subscribePatient` (js/lib/design-live.js):
//                           the design's patient object, `raw` for clearing, `fromCache`
//                docs       each collection's documents as stored ({ id, ...data }), or null while
//                           loading or after an error; an array keeps its identity until that
//                           collection changes, so a block can tell what changed
//                errors     collections whose read failed: "denied" (withdrawal; the page shows it)
//                           or "error" (say so in the block)
//
// The page opens ONE subscription (`data.subscribePatient` with every section) and feeds every
// block from it; a block opens no listener of its own. The data layer keeps the sharing filters the
// rules require: in the stamped collections the Clinician reads only what was saved while sharing.
//
// Blocks are mounted only while the Patient shares their progress (#29). When sharing is withdrawn
// the page destroys every block and shows only the withdrawn message, and focus moves to it. The
// data layer checks again in the background, so a Patient who shares again comes back.
//
// Slots:
//   (above the tabs)
//     attention                  level word, reasons, history, Clear     views/flags.js (#10)
//   Overview
//     overview-timeline          Phase strip, Mood and Questionnaire lanes views/overview.js
//     overview-latest-summary    the latest Summary                       views/summaries.js
//     overview-what-helps        what seems to help                       views/what-helps.js
//     overview-digest            the latest Digest, compact               views/digest.js (#23)
//   Summaries
//     summaries-body             Summaries, newest first, one in full     views/summaries.js
//     summaries-digest           this week's Digest                       views/digest.js (#23)
//   Signals
//     signals-body               Signal trends for a Phase                views/signals.js
//   Intake & Visits
//     intake                     the Intake highlights                    views/intake.js
//     visits                     Visits, TMS end date, Record a Visit     views/visits.js
import { dateInZone } from "../lib/dates.js";
import { DESIGN_COPY } from "../lib/design-model.js";
import { patientMeta } from "../lib/design-view.js";
import { sharingMessage } from "../lib/sharing.js";
import { phases } from "../lib/timeline.js";
import { sortVisits } from "../lib/visit.js";
import { mountDigest } from "./digest.js";
import { mountFlagDetail } from "./flags.js";
import { mountIntake } from "./intake.js";
import { mountTimeline } from "./overview.js";
import { mountSignals } from "./signals.js";
import { mountLatestSummary, mountSummaries } from "./summaries.js";
import { blankState } from "./ui.js";
import { mountVisits } from "./visits.js";
import { mountWhatHelps } from "./what-helps.js";

const COPY = {
  back: "← Patients",
  loading: "Loading…",
  unnamed: "Unnamed patient",
  tabs: "Patient sections",
  record: "Record a Visit",
  support: "Summaries and reported Outcomes",
  withdrawnTitle: "Sharing withdrawn",
  errorTitle: "This Patient cannot be shown",
};

/** The sections (tabs), in page order, and the slots in each. */
export const SECTIONS = Object.freeze([
  { id: "overview", title: "Overview", slots: ["overview-timeline", "overview-latest-summary", "overview-what-helps", "overview-digest"] },
  { id: "summaries", title: "Summaries", slots: ["summaries-body", "summaries-digest"] },
  { id: "signals", title: "Signals", slots: ["signals-body"] },
  { id: "intake-visits", title: "Intake & Visits", slots: ["intake", "visits"] },
]);

/** The Intake as a block: it only needs the saved highlights from the record. */
function mountIntakeBlock(container, { patientId, calls }) {
  const intake = mountIntake(container, { patientId, extract: calls.extract, save: calls.save });
  return {
    update: ({ patient }) => intake.setSaved(patient.intakeHighlights ?? ""),
    destroy: () => intake.destroy(),
  };
}

/** The Attention band (#10): the page's PatientState, and clearing through `data.clearAttention`. */
function mountFlagsBlock(container, { data, patientId }) {
  return mountFlagDetail(container, { data, patientId });
}

/**
 * The Digest (#23) shows in Overview (compact) and in Summaries. Both copies share one in-flight
 * "Generate now" per page, so it cannot run twice at once from either button.
 */
const digestCallsByCtx = new WeakMap();
/** @param {{ compact: boolean }} options */
const mountDigestBlock = ({ compact }) =>
  function (container, ctx) {
    if (!digestCallsByCtx.has(ctx)) {
      let inFlight = null;
      digestCallsByCtx.set(ctx, {
        generateDigest: (patientId) =>
          (inFlight ??= ctx.calls.generateDigest(patientId).finally(() => {
            inFlight = null;
          })),
      });
    }
    return mountDigest(container, { patientId: ctx.patientId, calls: digestCallsByCtx.get(ctx), compact });
  };

/**
 * Which module fills which slot. One line per block.
 * @type {{ slot: string, mount: (container: HTMLElement, ctx: object) => { update: (view: object) => void, destroy: () => void } }[]}
 */
const SLOT_MOUNTS = [
  { slot: "attention", mount: mountFlagsBlock },
  { slot: "overview-timeline", mount: mountTimeline },
  { slot: "overview-latest-summary", mount: mountLatestSummary },
  { slot: "overview-what-helps", mount: mountWhatHelps },
  { slot: "overview-digest", mount: mountDigestBlock({ compact: true }) },
  { slot: "summaries-body", mount: mountSummaries },
  { slot: "summaries-digest", mount: mountDigestBlock({ compact: false }) },
  { slot: "signals-body", mount: mountSignals },
  { slot: "intake", mount: mountIntakeBlock },
  { slot: "visits", mount: mountVisits },
];

/** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {string} slot */
const slotDiv = (slot) => el("div", { class: "slot", id: `slot-${slot}`, "data-slot": slot });

/** The tab the page opened on last, kept for this browser tab only. */
const TAB_KEY = "twoam.dashboard.patientTab";
function rememberedTab() {
  try {
    const value = window.sessionStorage.getItem(TAB_KEY);
    return SECTIONS.some((s) => s.id === value) ? /** @type {string} */ (value) : "overview";
  } catch {
    return "overview";
  }
}

/**
 * Shows one Patient in `root` and keeps it live. Returns a function that stops listening.
 * @param {{ root: HTMLElement, data: ReturnType<typeof import("../data/design-data.js").designData>, patientId: string, calls: Record<string, Function> }} options
 * @returns {() => void}
 */
export function showPatient({ root, data, patientId, calls }) {
  const back = el("a", { href: "#/", class: "back-button text-button" }, COPY.back);
  const name = el("h1", { id: "patient-name", tabindex: "-1" }, COPY.loading);
  const meta = el("p", { class: "muted", id: "patient-meta" });
  const recordButton = el("button", { type: "button", class: "primary" }, COPY.record);
  recordButton.hidden = true;
  const titleBlock = el("div");
  titleBlock.append(name, meta);
  const header = el("header", { class: "page-heading patient-heading" });
  header.append(titleBlock, recordButton);
  // Announces the withdrawn and error states; focus moves to its heading when the content goes.
  const status = el("div", { class: "patient-status", role: "status", "aria-live": "polite" });

  /** @type {Record<string, HTMLElement>} */
  const slotEls = { attention: slotDiv("attention") };
  /** @type {Record<string, HTMLElement>} */
  const panels = {};
  /** @type {Record<string, HTMLButtonElement>} */
  const tabButtons = {};
  const tabs = el("nav", { class: "patient-tabs", "aria-label": COPY.tabs });
  const body = el("div", { class: "patient-sections" });
  for (const { id, title, slots } of SECTIONS) {
    for (const slot of slots) slotEls[slot] = slotDiv(slot);
    const panel = el("div", { id: `section-${id}`, class: `patient-panel panel-${id}`, role: "region", "aria-label": title });
    if (id === "overview") {
      const layout = el("div", { class: "overview-layout" });
      const support = el("aside", { class: "overview-support", "aria-label": COPY.support });
      support.append(slotEls["overview-latest-summary"], slotEls["overview-what-helps"], slotEls["overview-digest"]);
      layout.append(slotEls["overview-timeline"], support);
      panel.append(layout);
    } else {
      for (const slot of slots) panel.append(slotEls[slot]);
    }
    panels[id] = panel;
    body.append(panel);
    const button = /** @type {HTMLButtonElement} */ (el("button", { type: "button", "aria-controls": panel.id }, title));
    button.addEventListener("click", () => showTab(id));
    tabButtons[id] = button;
    tabs.append(button);
  }
  const content = el("div", { class: "patient-content" });
  content.append(slotEls.attention, tabs, body);
  content.hidden = true;

  root.replaceChildren(back, header, status, content);
  window.scrollTo(0, 0);
  name.focus({ preventScroll: true });

  /** @param {string} id */
  function showTab(id) {
    for (const section of SECTIONS) {
      const active = section.id === id;
      panels[section.id].hidden = !active;
      if (active) tabButtons[section.id].setAttribute("aria-current", "page");
      else tabButtons[section.id].removeAttribute("aria-current");
    }
    recordButton.classList.toggle("primary", id === "overview" || id === "signals");
    try {
      window.sessionStorage.setItem(TAB_KEY, id);
    } catch {
      // Not remembered: the page opens on Overview next time.
    }
    // Charts measure their width once their tab is shown.
    window.dispatchEvent(new Event("resize"));
  }
  showTab(rememberedTab());

  const bus = new EventTarget();
  const page = {
    showTab,
    /** @param {string} type @param {(detail: any) => void} fn */
    on: (type, fn) => {
      const listener = (/** @type {Event} */ e) => fn(/** @type {CustomEvent} */ (e).detail);
      bus.addEventListener(type, listener);
      return () => bus.removeEventListener(type, listener);
    },
    /** @param {string} type @param {unknown} [detail] */
    emit: (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail })),
  };
  recordButton.addEventListener("click", () => page.emit("record-visit"));

  const ctx = { data, patientId, calls, page };
  /** @type {{ update: Function, destroy: Function }[] | null} */
  let blocks = null;
  /** @type {import("../lib/design-live.js").PatientState | null} */
  let state = null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function view() {
    const today = dateInZone(Date.now(), timeZone);
    const current = /** @type {import("../lib/design-live.js").PatientState} */ (state);
    const patient = /** @type {any} */ (current.raw?.patient);
    const visits = sortVisits(/** @type {any[]} */ (current.docs.visits ?? []));
    return { patient, visits, phases: phases(patient?.tmsEndDate, visits, today), today, timeZone, state: current, docs: current.docs, errors: current.errors };
  }

  function mountBlocks() {
    blocks = SLOT_MOUNTS.map(({ slot, mount }) => mount(slotEls[slot], ctx));
  }

  function destroyBlocks() {
    for (const block of blocks ?? []) block.destroy();
    blocks = null;
    for (const slot of Object.values(slotEls)) slot.replaceChildren();
  }

  function refresh() {
    if (!blocks || state?.status !== "ok") return;
    const current = view();
    meta.replaceChildren(
      ...patientMeta(current.patient, current.today).flatMap((part, i) => (i ? [el("span", { class: "meta-separator", "aria-hidden": "true" }, "·"), part] : [part])),
    );
    for (const block of blocks) block.update(current);
  }

  /** @param {import("../lib/design-live.js").PatientState} next */
  const render = (next) => {
    const previous = state?.status;
    state = next;
    if (next.status === "loading") return;
    if (next.status !== "ok") {
      // Withdrawn sharing (#29) or an error: show the state, never the Patient's data. The data
      // layer checks again in the background; the same state again changes nothing here.
      if (previous === next.status) return;
      const active = document.activeElement;
      const focusInPage = active === document.body || active === null || (root.contains(active) && active !== name);
      destroyBlocks();
      name.textContent = next.status === "withdrawn" ? DESIGN_COPY.withdrawnName : COPY.unnamed;
      meta.textContent = "";
      recordButton.hidden = true;
      content.hidden = true;
      const blank = blankState(next.status === "withdrawn" ? COPY.withdrawnTitle : COPY.errorTitle, /** @type {string} */ (sharingMessage(next)));
      const heading = /** @type {HTMLElement} */ (blank.querySelector("h2"));
      heading.tabIndex = -1;
      status.replaceChildren(blank);
      document.title = "Depressify · Clinician workspace";
      // The content the Clinician was in is gone: take focus to what replaced it. Focus elsewhere
      // (the sidebar, the page heading) stays where it is.
      if (focusInPage) heading.focus({ preventScroll: true });
      return;
    }
    const patient = /** @type {any} */ (next.raw?.patient);
    name.textContent = patient?.displayName || COPY.unnamed;
    document.title = `${name.textContent} · Depressify · Clinician workspace`;
    status.replaceChildren();
    content.hidden = false;
    recordButton.hidden = false;
    if (!blocks) mountBlocks();
    refresh();
  };

  // One subscription for the whole page: the record and every collection the blocks show.
  const stopPatient = data.subscribePatient(patientId, { sections: "all", clock: () => ({ nowMillis: Date.now(), timeZone }) }, render);

  return () => {
    stopPatient();
    destroyBlocks();
    root.replaceChildren();
  };
}
