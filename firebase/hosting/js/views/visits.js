// The Visits block of Intake & Visits (see the slot contract in views/patient.js), laid out as the
// design: the Visits table, newest first, each editable; the TMS end date row; and the "Record a
// Visit" modal form (`VisitForm` in design/clinician/src/App.jsx), which the page header's button
// opens too (`page.emit("record-visit")`).
//
// The Clinician records and edits Visits through the data layer (`data.recordVisit`,
// js/lib/design-live.js); the rules allow the Clinician to create and update them. A Visit is only
// { date, questionnaire, score }: recording one writes that document and nothing else, so it never
// changes an Attention flag. The checks the rules do not make (no future date, a score inside its
// range; and the design's: after the TMS end date, one Visit per date) are `validateDesignVisit`
// (js/lib/design-model.js, on js/lib/visit.js), run by the data layer before it writes. A failed
// save keeps the form and shows the data layer's copy.
import { addDays, shortDate } from "../lib/dates.js";
import { QUESTIONNAIRE_RANGES, questionnaireLabel } from "../lib/visit.js";
import { createModal } from "./dialog.js";
import { mountTmsEndForm } from "./tms-end.js";

const COPY = {
  heading: "Visits",
  about: "Questionnaire scores recorded by the Clinician",
  record: "Record a Visit",
  edit: (/** @type {string} */ date) => `Edit the Visit on ${date}`,
  lead: "Record a completed Visit and, if available, its Questionnaire score.",
  date: "Visit date",
  questionnaire: "Questionnaire score",
  optional: "(optional)",
  none: "No score",
  score: (/** @type {string} */ kind) => `${questionnaireLabel(kind)} score · ${QUESTIONNAIRE_RANGES[kind].min}–${QUESTIONNAIRE_RANGES[kind].max}`,
  flagNote: "This records a score already taken. Scores never change the Attention flag.",
  save: "Save Visit",
  saving: "Saving…",
  retry: "Try saving again",
  cancel: "Cancel",
  saved: (/** @type {string} */ date) => `Visit saved for ${date}. Attention flag unchanged.`,
  noVisits: "No Visits recorded yet.",
  editButton: "Edit",
  columns: ["Date", "Questionnaire", "Score", ""],
  caption: "Visits, newest first",
  noScore: "No score recorded",
};

/** The select's values, as the design's Visit types. */
const TYPES = /** @type {const} */ ([["none", ""], ["PHQ-2", "phq2"], ["PHQ-9", "phq9"]]);

let counter = 0;

/** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {HTMLElement} container
 * @param {{ data: ReturnType<typeof import("../data/design-data.js").designData>, patientId: string, page?: { on: (type: string, fn: () => void) => () => void } }} ctx
 */
export function mountVisits(container, { data, patientId, page }) {
  const id = `visit-${++counter}`;
  const block = el("section", { class: "content-section visits", "aria-labelledby": `${id}-heading` });
  const headingText = el("div");
  headingText.append(el("h2", { id: `${id}-heading` }, COPY.heading), el("p", { class: "muted" }, COPY.about));
  const recordButton = el("button", { type: "button" }, COPY.record);
  const headingWrap = el("div", { class: "section-heading" });
  headingWrap.append(headingText, recordButton);
  const status = el("p", { class: "notice success", role: "status" });
  status.hidden = true;
  const tableWrap = el("div", { class: "table-scroll" });
  const tmsSlot = el("div");
  block.append(headingWrap, status, tableWrap, tmsSlot);
  container.replaceChildren(block);
  const tmsForm = mountTmsEndForm(tmsSlot, { data, patientId, variant: "row" });

  // ---- The modal form --------------------------------------------------------------------------
  const modal = createModal({ title: COPY.record, onCancel: () => !busy && modal.close() });
  const form = /** @type {HTMLFormElement} */ (el("form", { novalidate: "" }));
  const dateInput = /** @type {HTMLInputElement} */ (el("input", { type: "date", id: `${id}-date`, name: "date", required: "", "data-initial-focus": "", "aria-describedby": `${id}-error` }));
  const dateLabel = el("label", { for: dateInput.id }, COPY.date);
  const select = /** @type {HTMLSelectElement} */ (el("select", { id: `${id}-type`, name: "type" }));
  for (const [value] of TYPES) select.append(el("option", { value }, value === "none" ? COPY.none : value));
  const selectLabel = el("label", { for: select.id }, `${COPY.questionnaire} `);
  selectLabel.append(el("span", { class: "muted" }, COPY.optional));
  const scoreInput = /** @type {HTMLInputElement} */ (el("input", { type: "text", inputmode: "numeric", autocomplete: "off", id: `${id}-score`, name: "score", "aria-describedby": `${id}-error` }));
  const scoreLabel = el("label", { for: scoreInput.id });
  const scoreField = el("div", { class: "field" });
  scoreField.append(scoreLabel, scoreInput);
  const fieldset = el("fieldset");
  const dateField = el("div", { class: "field" });
  dateField.append(dateLabel, dateInput);
  const typeField = el("div", { class: "field" });
  typeField.append(selectLabel, select);
  fieldset.append(dateField, typeField, scoreField);
  const error = el("p", { class: "error-text", id: `${id}-error`, role: "alert" });
  error.hidden = true;
  const cancel = el("button", { type: "button" }, COPY.cancel);
  const submit = el("button", { type: "submit", class: "primary" }, COPY.save);
  const actions = el("div", { class: "dialog-actions" });
  actions.append(cancel, submit);
  form.append(el("p", { class: "muted" }, COPY.lead), fieldset, el("p", { class: "small muted" }, COPY.flagNote), error, actions);
  modal.body.append(form);

  let today = "";
  /** @type {string | null} */
  let tms = null;
  /** @type {{ id: string, date: string, questionnaire: string | null, score: number | null }[]} */
  let visits = [];
  /** @type {string | null} the Visit being edited, or null for a new one */
  let editingId = null;
  let busy = false;
  let failed = false;
  let destroyed = false;

  const kindOf = (/** @type {string} */ type) => TYPES.find(([t]) => t === type)?.[1] ?? "";

  function syncScore() {
    const kind = kindOf(select.value);
    scoreField.hidden = kind === "";
    if (kind === "") scoreInput.value = "";
    else scoreLabel.textContent = COPY.score(kind);
  }

  /** @param {string} message @param {HTMLElement[]} [fields] */
  function setError(message, fields = []) {
    error.textContent = message;
    error.hidden = message === "";
    for (const input of [dateInput, scoreInput]) input.setAttribute("aria-invalid", fields.includes(input) ? "true" : "false");
  }

  function drawForm() {
    fieldset.disabled = busy;
    form.setAttribute("aria-busy", String(busy));
    submit.disabled = busy;
    submit.textContent = busy ? COPY.saving : failed ? COPY.retry : COPY.save;
    cancel.disabled = busy;
    dateInput.max = today;
    // A Visit is after the TMS end date: the first day it may be on is the day after.
    if (tms) dateInput.min = addDays(tms, 1);
    else dateInput.removeAttribute("min");
  }

  /** @param {{ id: string, date: string, questionnaire: string | null, score: number | null } | null} visit */
  function openForm(visit) {
    editingId = visit?.id ?? null;
    failed = false;
    form.reset();
    dateInput.value = visit?.date ?? today;
    select.value = TYPES.find(([, k]) => k === (visit?.questionnaire ?? ""))?.[0] ?? "none";
    syncScore();
    scoreInput.value = Number.isInteger(visit?.score) ? String(visit?.score) : "";
    setError("");
    modal.setTitle(visit ? COPY.edit(shortDate(visit.date, today)) : COPY.record);
    drawForm();
    modal.open();
  }

  select.addEventListener("change", () => {
    syncScore();
    setError("");
  });
  for (const input of [dateInput, scoreInput]) input.addEventListener("input", () => setError(""));
  cancel.addEventListener("click", () => !busy && modal.close());
  recordButton.addEventListener("click", () => openForm(null));
  const stopListening = page?.on("record-visit", () => openForm(null)) ?? (() => {});

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    drawForm();
    // The data layer checks the form (`validateDesignVisit`), then writes only the Visit itself:
    // never a flag or the Patient record. A new Visit is added; an edited one replaced.
    const result = await data.recordVisit(patientId, { date: dateInput.value, type: select.value, score: scoreInput.value }, { today, tms, visits, editingId });
    if (destroyed) return;
    busy = false;
    if (result.ok) {
      failed = false;
      const visit = /** @type {{ date: string }} */ (result.visit);
      status.textContent = COPY.saved(shortDate(visit.date, today));
      status.hidden = false;
      modal.close(recordButton);
    } else if (result.invalid) {
      const errors = /** @type {Record<string, string>} */ (result.errors ?? {});
      const scoreProblem = Boolean(errors.score ?? errors.questionnaire);
      const field = scoreProblem && !errors.date ? scoreInput : dateInput;
      drawForm();
      setError(result.message, [field]);
      field.focus();
      return;
    } else {
      failed = true;
      // Keep every entry so the Clinician can try again.
      setError(result.message);
      submit.focus();
    }
    drawForm();
  });

  function drawTable() {
    if (!visits.length) {
      tableWrap.replaceChildren(el("p", { class: "muted" }, COPY.noVisits));
      return;
    }
    const table = el("table", { class: "visits-table" });
    table.append(el("caption", { class: "visually-hidden" }, COPY.caption));
    const head = el("thead");
    const headRow = el("tr");
    for (const text of COPY.columns) {
      const th = el("th", { scope: "col" });
      if (text) th.textContent = text;
      else th.append(el("span", { class: "visually-hidden" }, COPY.editButton));
      headRow.append(th);
    }
    head.append(headRow);
    const body = el("tbody");
    for (const visit of visits) {
      const date = shortDate(visit.date, today);
      const kind = visit.questionnaire;
      const tr = el("tr");
      tr.append(
        el("th", { scope: "row" }, date),
        el("td", {}, kind ? questionnaireLabel(kind) : COPY.noScore),
        el("td", {}, kind && Number.isInteger(visit.score) ? `${visit.score}/${QUESTIONNAIRE_RANGES[kind].max}` : "—"),
      );
      const edit = el("button", { type: "button", class: "text-button", "aria-label": COPY.edit(date) }, COPY.editButton);
      edit.addEventListener("click", () => openForm(visit));
      const cell = el("td", { class: "row-action" });
      cell.append(edit);
      tr.append(cell);
      body.append(tr);
    }
    table.append(head, body);
    tableWrap.replaceChildren(table);
  }

  syncScore();

  return {
    update(view) {
      today = view.today;
      tms = view.patient?.tmsEndDate ?? null;
      tmsForm.update(view);
      visits = view.visits;
      // A Visit removed elsewhere cannot be edited any more.
      if (editingId && !visits.some((v) => v.id === editingId) && !busy) modal.close();
      if (!busy) drawForm();
      drawTable();
    },
    destroy() {
      destroyed = true;
      stopListening();
      tmsForm.destroy();
      modal.remove();
      block.remove();
    },
  };
}
