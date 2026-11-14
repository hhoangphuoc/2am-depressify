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
//   ctx        fixed for the page: { db, data, patientId, calls, page }
//                db         Firestore (js/firebase.js); write through the Firestore JS SDK, within
//                           the rules (firebase/firestore.rules)
//                data       the design data layer, `designData({ db, app })` (js/data/design-data.js)
//                patientId  the Patient's document id
//                calls      the callables (js/functions.js): { extract, save, generateDigest }
//                page       { showTab(id), on(type, fn), emit(type, detail) }: switch tabs and pass
//                           small requests between blocks (for example "read this Summary")
//   view       passed to update() on every change of the Patient record or the Visits, and once
//              right after mounting:
//                patient    the live PatientDoc (js/lib/contract.js)
//                visits     the Visits, newest first, each { id, date, questionnaire, score }
//                phases     phases(patient.tmsEndDate, visits, today) from js/lib/timeline.js.
//                today      yyyy-MM-dd in the browser's time zone
//                timeZone   the browser's time zone, for giving a millisecond time its date
//
// Read a Patient's collections with `patientQuery` (js/queries.js) or the design data layer: in the
// stamped collections the Clinician may read only what was saved while the Patient was sharing, and
// the rules reject a query without that filter.
//
// Blocks are mounted only while the Patient shares their progress (#29). When sharing is withdrawn
// the page destroys every block, so each must stop its own listeners in destroy(), and shows only
// the withdrawn message. A block that listens to a collection should also treat a permission-denied
// error as "nothing to show", because withdrawal can reach its listener first.
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
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { dateInZone } from "../lib/dates.js";
import { DESIGN_COPY } from "../lib/design-model.js";
import { patientMeta } from "../lib/design-view.js";
import { sharingMessage, sharingStateFromError, sharingStateFromSnapshot } from "../lib/sharing.js";
import { patientQuery } from "../queries.js";
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

/** The Attention band (#10) listens through the design data layer itself; it needs no view updates. */
function mountFlagsBlock(container, { db, data, patientId }) {
  const stop = mountFlagDetail(container, { db, data, patientId });
  return { update() {}, destroy: stop };
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
    const { destroy } = mountDigest(container, { db: ctx.db, patientId: ctx.patientId, calls: digestCallsByCtx.get(ctx), compact });
    return { update() {}, destroy };
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
 * @param {{ root: HTMLElement, db: import("firebase/firestore").Firestore, data: object, patientId: string, calls: Record<string, Function> }} options
 * @returns {() => void}
 */
export function showPatient({ root, db, data, patientId, calls }) {
  const back = el("a", { href: "#/", class: "back-button text-button" }, COPY.back);
  const name = el("h1", { id: "patient-name", tabindex: "-1" }, COPY.loading);
  const meta = el("p", { class: "muted", id: "patient-meta" });
  const recordButton = el("button", { type: "button", class: "primary" }, COPY.record);
  recordButton.hidden = true;
  const titleBlock = el("div");
  titleBlock.append(name, meta);
  const header = el("header", { class: "page-heading patient-heading" });
  header.append(titleBlock, recordButton);
  const status = el("div", { class: "patient-status" });

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

  const ctx = { db, data, patientId, calls, page };
  /** @type {{ update: Function, destroy: Function }[] | null} */
  let blocks = null;
  /** @type {any} */
  let patient = null;
  /** @type {object[]} */
  let visits = [];

  function view() {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = dateInZone(Date.now(), timeZone);
    return { patient, visits, phases: phases(patient?.tmsEndDate, visits, today), today, timeZone };
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
    if (!blocks || !patient) return;
    const current = view();
    meta.replaceChildren(
      ...patientMeta(patient, current.today).flatMap((part, i) => (i ? [el("span", { class: "meta-separator", "aria-hidden": "true" }, "·"), part] : [part])),
    );
    for (const block of blocks) block.update(current);
  }

  /** @param {import("../lib/sharing.js").SharingViewState} state */
  const render = (state) => {
    if (state.status !== "ok") {
      // Withdrawn sharing (#29) or an error: show the state, never the Patient's data.
      patient = null;
      destroyBlocks();
      name.textContent = state.status === "withdrawn" ? DESIGN_COPY.withdrawnName : COPY.unnamed;
      meta.textContent = "";
      recordButton.hidden = true;
      content.hidden = true;
      status.replaceChildren(blankState(state.status === "withdrawn" ? COPY.withdrawnTitle : COPY.errorTitle, sharingMessage(state)));
      document.title = "Depressify · Clinician workspace";
      return;
    }
    patient = state.patient;
    name.textContent = state.patient.displayName || COPY.unnamed;
    document.title = `${name.textContent} · Depressify · Clinician workspace`;
    status.replaceChildren();
    content.hidden = false;
    recordButton.hidden = false;
    if (!blocks) mountBlocks();
    refresh();
  };

  const stopPatient = onSnapshot(
    doc(db, COLLECTIONS.patients, patientId),
    (snapshot) => render(sharingStateFromSnapshot({ exists: snapshot.exists(), data: snapshot.data() })),
    // The rules deny the read once the Patient stops sharing: that is the withdrawn state, not an error.
    (error) => render(sharingStateFromError(error)),
  );

  const stopVisits = onSnapshot(
    patientQuery(db, patientId, COLLECTIONS.visits),
    (snapshot) => {
      visits = sortVisits(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      refresh();
    },
    // Withdrawal reaches the record's listener too, which shows the withdrawn state.
    () => {
      visits = [];
      refresh();
    },
  );

  return () => {
    stopPatient();
    stopVisits();
    destroyBlocks();
    root.replaceChildren();
  };
}
