// The Patient page (`#/patient/{id}`): the Patient's name, an in-page section menu, and four
// sections, in this order: Overview, Summaries, Signals, Intake and Visits. At phone width the
// sections and the blocks inside them stack.
//
// ─── Slot contract ──────────────────────────────────────────────────────────────────────────────
// This file creates every section and an empty <div class="slot" id="slot-NAME"> for each block, in
// page order, and mounts the modules listed in SLOT_MOUNTS into them. A block module exports
//
//     mountSomething(container, ctx) → { update(view), destroy() }
//
//   container  the slot's <div>. The module owns everything inside it and nothing outside.
//   ctx        fixed for the page: { db, patientId, calls }
//                db         Firestore (js/firebase.js); write through the Firestore JS SDK, within
//                           the rules (firebase/firestore.rules)
//                patientId  the Patient's document id
//                calls      the callables (js/functions.js); today { extract, save } for the Intake
//   view       passed to update() on every change of the Patient record or the Visits, and once
//              right after mounting:
//                patient    the live PatientDoc (js/lib/contract.js)
//                visits     the Visits, newest first, each { id, date, questionnaire, score }
//                phases     phases(patient.tmsEndDate, visits, today) from js/lib/timeline.js.
//                           Select a Phase with phaseOf(date, phases) or inPhase(date, phase).
//                today      yyyy-MM-dd in the browser's time zone
//                timeZone   the browser's time zone, for giving a millisecond time its date
//
// Read a Patient's collections with `patientQuery` (js/queries.js): in the stamped collections the
// Clinician may read only what was saved while the Patient was sharing, and the rules reject a
// query without that filter.
//
// Blocks are mounted only while the Patient shares their progress (#29). When sharing is withdrawn
// the page destroys every block, so each must stop its own listeners in destroy(), and shows only
// the withdrawn message. A block that listens to a collection should also treat a permission-denied
// error as "nothing to show", because withdrawal can reach its listener first.
//
// Slots (filled ✔ here; ◻ left empty for the ticket named):
//   Overview
//     ✔ overview-attention       level word and reasons, first          views/overview.js
//     ✔ overview-flags           flag detail and Clear after follow-up  views/flags.js (#10)
//     ✔ overview-timeline        Phase timeline, mood and Questionnaire views/overview.js
//     ✔ overview-latest-summary  the latest Summary                     views/summaries.js
//     ✔ overview-what-helps      what seems to help                     views/what-helps.js
//     ✔ overview-digest          the latest Digest, "Generate now"      views/digest.js (#23)
//   Summaries
//     ✔ summaries-digest         this week's Digest                     views/digest.js (#23)
//     ✔ summaries-body           Summaries, newest first, one in full   views/summaries.js
//   Signals
//     ✔ signals-body             Signal trends for a Phase              views/signals.js
//   Intake and Visits
//     ✔ intake                   the Intake highlights                  views/intake.js
//     ✔ visits                   TMS end date, Record a Visit, Visits   views/visits.js
//
// To fill a slot: import the mount function and add one line to SLOT_MOUNTS. An empty slot shows
// nothing. Section headings are <h3>; a block's own heading is <h4>.
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { dateInZone } from "../lib/dates.js";
import { sharingMessage, sharingStateFromError, sharingStateFromSnapshot } from "../lib/sharing.js";
import { patientQuery } from "../queries.js";
import { phases } from "../lib/timeline.js";
import { sortVisits } from "../lib/visit.js";
import { mountDigest } from "./digest.js";
import { mountFlagDetail } from "./flags.js";
import { mountIntake } from "./intake.js";
import { mountAttention, mountTimeline } from "./overview.js";
import { mountSignals } from "./signals.js";
import { mountLatestSummary, mountSummaries } from "./summaries.js";
import { mountVisits } from "./visits.js";
import { mountWhatHelps } from "./what-helps.js";

const COPY = {
  back: "← All Patients",
  loading: "Loading…",
  unnamed: "Unnamed patient",
  menu: "Sections of this Patient's page",
};

/** The sections, in page order, and the slots in each. */
export const SECTIONS = Object.freeze([
  {
    id: "overview",
    title: "Overview",
    slots: ["overview-attention", "overview-flags", "overview-timeline", "overview-latest-summary", "overview-what-helps", "overview-digest"],
  },
  { id: "summaries", title: "Summaries", slots: ["summaries-digest", "summaries-body"] },
  { id: "signals", title: "Signals", slots: ["signals-body"] },
  { id: "intake-visits", title: "Intake and Visits", slots: ["intake", "visits"] },
]);

/** The Intake section as a block: it only needs the saved highlights from the record. */
function mountIntakeBlock(container, { patientId, calls }) {
  const intake = mountIntake(container, { patientId, extract: calls.extract, save: calls.save });
  return {
    update: ({ patient }) => intake.setSaved(patient.intakeHighlights ?? ""),
    destroy: () => intake.destroy(),
  };
}

/** Flag detail (#10) listens to the Patient and flags itself; it needs no view updates. */
function mountFlagsBlock(container, { db, patientId }) {
  const stop = mountFlagDetail(container, { db, patientId });
  return { update() {}, destroy: stop };
}

/**
 * The Digest (#23) shows in Overview and in Summaries. Both copies share one in-flight
 * "Generate now" per page, so it cannot run twice at once from either button.
 */
const digestCallsByCtx = new WeakMap();
function mountDigestBlock(container, ctx) {
  if (!digestCallsByCtx.has(ctx)) {
    let inFlight = null;
    digestCallsByCtx.set(ctx, {
      generateDigest: (patientId) =>
        (inFlight ??= ctx.calls.generateDigest(patientId).finally(() => {
          inFlight = null;
        })),
    });
  }
  const { destroy } = mountDigest(container, { db: ctx.db, patientId: ctx.patientId, calls: digestCallsByCtx.get(ctx) });
  return { update() {}, destroy };
}

/**
 * Which module fills which slot. One line per block.
 * @type {{ slot: string, mount: (container: HTMLElement, ctx: object) => { update: (view: object) => void, destroy: () => void } }[]}
 */
const SLOT_MOUNTS = [
  { slot: "overview-attention", mount: mountAttention },
  { slot: "overview-flags", mount: mountFlagsBlock },
  { slot: "overview-timeline", mount: mountTimeline },
  { slot: "overview-latest-summary", mount: mountLatestSummary },
  { slot: "overview-what-helps", mount: mountWhatHelps },
  { slot: "summaries-body", mount: mountSummaries },
  { slot: "signals-body", mount: mountSignals },
  { slot: "overview-digest", mount: mountDigestBlock },
  { slot: "summaries-digest", mount: mountDigestBlock },
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

/** The in-page menu: buttons that move to a section and focus its heading (the hash is the route). */
function sectionMenu(sectionEls) {
  const nav = el("nav", { class: "section-menu", "aria-label": COPY.menu });
  const list = el("ul");
  for (const { id, title } of SECTIONS) {
    const button = el("button", { type: "button", class: "link", "aria-controls": `section-${id}` }, title);
    button.addEventListener("click", () => {
      const heading = sectionEls[id].querySelector("h3");
      sectionEls[id].scrollIntoView({ block: "start" });
      heading?.focus({ preventScroll: true });
    });
    const item = el("li");
    item.append(button);
    list.append(item);
  }
  nav.append(list);
  return nav;
}

/**
 * Shows one Patient in `root` and keeps it live. Returns a function that stops listening.
 * @param {{ root: HTMLElement, db: import("firebase/firestore").Firestore, patientId: string, calls: { extract: Function, save: Function } }} options
 * @returns {() => void}
 */
export function showPatient({ root, db, patientId, calls }) {
  const back = el("a", { href: "#/", class: "back" }, COPY.back);
  const name = el("h2", { id: "patient-name", tabindex: "-1" }, COPY.loading);
  const status = el("p", { class: "muted", "aria-live": "polite" });

  /** @type {Record<string, HTMLElement>} */
  const sectionEls = {};
  /** @type {Record<string, HTMLElement>} */
  const slotEls = {};
  const body = el("div", { class: "patient-sections" });
  body.hidden = true;
  for (const { id, title, slots } of SECTIONS) {
    const section = el("section", { id: `section-${id}`, class: "patient-section", "aria-labelledby": `section-${id}-heading` });
    section.append(el("h3", { id: `section-${id}-heading`, tabindex: "-1" }, title));
    const grid = el("div", { class: `section-body section-body-${id}` });
    for (const slot of slots) {
      slotEls[slot] = el("div", { class: "slot", id: `slot-${slot}`, "data-slot": slot });
      grid.append(slotEls[slot]);
    }
    section.append(grid);
    sectionEls[id] = section;
    body.append(section);
  }
  const menu = sectionMenu(sectionEls);
  menu.hidden = true;

  root.replaceChildren(back, name, status, menu, body);
  name.focus();

  const ctx = { db, patientId, calls };
  /** @type {{ update: Function, destroy: Function }[] | null} */
  let blocks = null;
  /** @type {object | null} */
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
    for (const block of blocks) block.update(current);
  }

  /** @param {import("../lib/sharing.js").SharingViewState} state */
  const render = (state) => {
    if (state.status !== "ok") {
      // Withdrawn sharing (#29) or an error: show the state, never the Patient's data.
      patient = null;
      destroyBlocks();
      name.textContent = COPY.unnamed;
      status.textContent = sharingMessage(state);
      body.hidden = true;
      menu.hidden = true;
      return;
    }
    patient = state.patient;
    name.textContent = state.patient.displayName || COPY.unnamed;
    status.textContent = "";
    body.hidden = false;
    menu.hidden = false;
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
