// The Visits block of Intake and Visits (see the slot contract in views/patient.js): the TMS end
// date, the Record a Visit form, and the Visits, newest first, each of which can be edited.
//
// The Clinician writes Visits directly through the Firestore SDK; the rules allow the Clinician to
// create and update them. A Visit is only { date, questionnaire, score }: recording one writes that
// document and nothing else, so it never changes an Attention flag. The checks the rules do not make
// (no future date, a score inside its range) are in js/lib/visit.js. A failed save keeps the form.
import {
  addDoc,
  collection,
  doc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { shortDate } from "../lib/dates.js";
import { QUESTIONNAIRE_RANGES, questionnaireLabel, validateVisit } from "../lib/visit.js";
import { visitScoreText } from "./timeline-chart.js";
import { mountTmsEndForm } from "./tms-end.js";

const COPY = {
  heading: "Visits",
  tms: "End of TMS",
  record: "Record a Visit",
  edit: (date) => `Edit the Visit on ${date}`,
  date: "Date of the Visit",
  dateHint: "Not in the future. A past date moves the Phase boundaries.",
  questionnaire: "Questionnaire score",
  none: "No score",
  scoreLabel: "Score",
  scoreRange: (kind) => `${questionnaireLabel(kind)}: ${QUESTIONNAIRE_RANGES[kind].min} to ${QUESTIONNAIRE_RANGES[kind].max}`,
  scoreNone: "Choose PHQ-2 or PHQ-9 to enter a score.",
  save: "Save Visit",
  saving: "Saving…",
  cancel: "Cancel",
  saved: "Visit saved. The timeline is updated.",
  failed: "Could not save the Visit. Check the connection and try again; your entries are kept.",
  list: "Recorded Visits",
  noVisits: "No Visits recorded yet.",
  editButton: "Edit",
  editLabel: (date) => `Edit the Visit on ${date}`,
  flagNote: "Questionnaire scores are a record for you. They never change the Attention flag.",
};

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
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string }} ctx
 */
export function mountVisits(container, { db, patientId }) {
  const id = `visit-${++counter}`;
  const block = el("section", { class: "panel visits", "aria-labelledby": `${id}-heading` });
  container.replaceChildren(block);

  // TMS end date.
  const tmsHeading = el("h5", {}, COPY.tms);
  const tmsSlot = el("div");
  const tmsForm = mountTmsEndForm(tmsSlot, { db, patientId });

  // Record (or edit) a Visit.
  const formHeading = el("h5", { id: `${id}-form-heading` }, COPY.record);
  const form = el("form", { class: "visit-form", novalidate: "", "aria-labelledby": `${id}-form-heading` });
  const dateInput = el("input", { type: "date", id: `${id}-date`, name: "date", required: "", "aria-describedby": `${id}-date-hint ${id}-date-error` });
  const dateError = el("p", { class: "error", id: `${id}-date-error` });

  const fieldset = el("fieldset", { "aria-describedby": `${id}-score-error` });
  fieldset.append(el("legend", {}, COPY.questionnaire));
  const radios = el("div", { class: "radios" });
  /** @type {HTMLInputElement[]} */
  const kindInputs = [];
  for (const [value, label] of [["", COPY.none], ["phq2", "PHQ-2"], ["phq9", "PHQ-9"]]) {
    const input = /** @type {HTMLInputElement} */ (el("input", { type: "radio", name: `${id}-kind`, id: `${id}-kind-${value || "none"}`, value }));
    if (value === "") input.checked = true;
    input.addEventListener("change", syncScore);
    kindInputs.push(input);
    const wrap = el("label", { class: "radio", for: input.id });
    wrap.prepend(input);
    wrap.append(document.createTextNode(label));
    radios.append(wrap);
  }
  const scoreLabel = el("label", { for: `${id}-score` }, COPY.scoreLabel);
  const scoreInput = /** @type {HTMLInputElement} */ (
    el("input", { type: "text", inputmode: "numeric", autocomplete: "off", id: `${id}-score`, name: "score", "aria-describedby": `${id}-score-hint ${id}-score-error`, class: "score" })
  );
  const scoreHint = el("p", { class: "muted hint", id: `${id}-score-hint` });
  const scoreError = el("p", { class: "error", id: `${id}-score-error` });
  fieldset.append(radios, scoreLabel, scoreHint, scoreInput);

  const formError = el("p", { class: "error", role: "alert" });
  const submit = el("button", { type: "submit", class: "primary" }, COPY.save);
  const cancel = el("button", { type: "button", class: "link" }, COPY.cancel);
  const actions = el("div", { class: "actions" });
  actions.append(submit, cancel);
  form.append(
    el("label", { for: dateInput.id }, COPY.date),
    el("p", { class: "muted hint", id: `${id}-date-hint` }, COPY.dateHint),
    dateInput,
    dateError,
    fieldset,
    scoreError,
    el("p", { class: "muted hint" }, COPY.flagNote),
    formError,
    actions,
  );
  const status = el("p", { class: "muted", role: "status" });

  const listHeading = el("h5", { id: `${id}-list-heading` }, COPY.list);
  const list = el("ul", { class: "visit-list", "aria-labelledby": `${id}-list-heading` });

  block.append(el("h4", { id: `${id}-heading` }, COPY.heading), tmsHeading, tmsSlot, formHeading, form, status, listHeading, list);

  let today = "";
  /** @type {{ id: string, date: string, questionnaire: string | null, score: number | null }[]} */
  let visits = [];
  /** @type {string | null} the Visit being edited, or null for a new one */
  let editingId = null;
  let busy = false;
  let destroyed = false;

  function kind() {
    return kindInputs.find((i) => i.checked)?.value ?? "";
  }

  function syncScore() {
    const k = kind();
    scoreInput.disabled = k === "" || busy;
    if (k === "") scoreInput.value = "";
    scoreHint.textContent = k ? COPY.scoreRange(k) : COPY.scoreNone;
  }

  function setBusy(next) {
    busy = next;
    submit.disabled = busy;
    submit.setAttribute("aria-busy", String(busy));
    submit.textContent = busy ? COPY.saving : COPY.save;
    cancel.disabled = busy;
    dateInput.readOnly = busy;
    for (const input of kindInputs) input.disabled = busy;
    syncScore();
  }

  function clearErrors() {
    for (const [input, line] of [[dateInput, dateError], [scoreInput, scoreError]]) {
      line.textContent = "";
      input.setAttribute("aria-invalid", "false");
    }
    fieldset.removeAttribute("aria-invalid");
    formError.textContent = "";
  }

  function resetForm() {
    editingId = null;
    form.reset();
    kindInputs[0].checked = true;
    clearErrors();
    formHeading.textContent = COPY.record;
    cancel.hidden = true;
    syncScore();
  }

  function startEdit(visit) {
    editingId = visit.id;
    clearErrors();
    status.textContent = "";
    dateInput.value = visit.date;
    for (const input of kindInputs) input.checked = input.value === (visit.questionnaire ?? "");
    syncScore();
    scoreInput.value = Number.isInteger(visit.score) ? String(visit.score) : "";
    formHeading.textContent = COPY.edit(shortDate(visit.date, today));
    cancel.hidden = false;
    dateInput.focus();
  }

  cancel.addEventListener("click", () => {
    resetForm();
    status.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    clearErrors();
    status.textContent = "";
    const result = validateVisit({ date: dateInput.value, questionnaire: kind(), score: scoreInput.value }, today);
    if (!result.ok) {
      const { errors } = result;
      if (errors.date) {
        dateError.textContent = errors.date;
        dateInput.setAttribute("aria-invalid", "true");
      }
      const scoreProblem = errors.score ?? errors.questionnaire;
      if (scoreProblem) {
        scoreError.textContent = scoreProblem;
        scoreInput.setAttribute("aria-invalid", "true");
        fieldset.setAttribute("aria-invalid", "true");
      }
      (errors.date ? dateInput : scoreInput.disabled ? kindInputs[0] : scoreInput).focus();
      return;
    }
    setBusy(true);
    try {
      const visitsRef = collection(db, COLLECTIONS.patients, patientId, COLLECTIONS.visits);
      // Only the Visit itself is written: never a flag or the Patient record.
      if (editingId) await setDoc(doc(visitsRef, editingId), result.visit);
      else await addDoc(visitsRef, result.visit);
      if (destroyed) return;
      setBusy(false);
      resetForm();
      status.textContent = COPY.saved;
    } catch {
      if (destroyed) return;
      setBusy(false);
      // Keep every entry so the Clinician can try again.
      formError.textContent = COPY.failed;
      submit.focus();
    }
  });

  function drawList() {
    if (!visits.length) {
      list.replaceChildren(el("li", { class: "muted" }, COPY.noVisits));
      return;
    }
    list.replaceChildren(
      ...visits.map((visit) => {
        const date = shortDate(visit.date, today);
        const item = el("li");
        const text = el("span", {}, `${date}: ${visitScoreText(visit)}`);
        const edit = el("button", { type: "button", class: "link", "aria-label": COPY.editLabel(date) }, COPY.editButton);
        edit.addEventListener("click", () => startEdit(visit));
        item.append(text, edit);
        return item;
      }),
    );
  }

  resetForm();

  return {
    update(view) {
      today = view.today;
      dateInput.max = today;
      tmsForm.update(view);
      visits = view.visits;
      // A Visit removed elsewhere cannot be edited any more.
      if (editingId && !visits.some((v) => v.id === editingId) && !busy) resetForm();
      drawList();
    },
    destroy() {
      destroyed = true;
      tmsForm.destroy();
      block.remove();
    },
  };
}
