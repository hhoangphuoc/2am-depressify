// The TMS end date: shown with a Change button, or a form when it is missing or being changed.
// Used by the Overview (a prompt when the date is missing) and by Intake and Visits. The Clinician
// writes `tmsEndDate` on the Patient record directly; the rules allow the Clinician that field.
// A failed save keeps the date typed.
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { shortDate } from "../lib/dates.js";
import { validateTmsEndDate } from "../lib/visit.js";

const COPY = {
  label: "Date TMS ended",
  hint: "Week 1 of the timeline starts the day after.",
  current: (date) => `TMS ended on ${date}.`,
  missing: "No TMS end date yet.",
  change: "Change",
  save: "Save date",
  saving: "Saving…",
  cancel: "Cancel",
  saved: "TMS end date saved.",
  failed: "Could not save the date. Check the connection and try again; your entry is kept.",
};

let counter = 0;

/**
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string }} options
 * @returns {{ update: (view: { patient: { tmsEndDate?: string | null }, today: string }) => void, destroy: () => void }}
 */
export function mountTmsEndForm(container, { db, patientId }) {
  const id = `tms-end-${++counter}`;
  let saved = /** @type {string | null} */ (null);
  let today = "";
  let editing = false;
  let busy = false;
  let notice = "";
  let destroyed = false;

  const root = document.createElement("div");
  root.className = "tms-end";
  container.replaceChildren(root);

  const input = document.createElement("input");
  input.type = "date";
  input.id = `${id}-date`;
  input.setAttribute("aria-describedby", `${id}-hint ${id}-error`);
  const error = document.createElement("p");
  error.id = `${id}-error`;
  error.className = "error";
  error.setAttribute("role", "alert");

  function drawShown() {
    const line = document.createElement("p");
    line.textContent = saved ? COPY.current(shortDate(saved, today)) : COPY.missing;
    const change = document.createElement("button");
    change.type = "button";
    change.className = "secondary";
    change.textContent = COPY.change;
    change.addEventListener("click", () => {
      editing = true;
      notice = "";
      input.value = saved ?? "";
      error.textContent = "";
      draw();
      input.focus();
    });
    const status = document.createElement("p");
    status.className = "muted";
    status.setAttribute("role", "status");
    status.textContent = notice;
    const row = document.createElement("div");
    row.className = "actions";
    row.append(line, change);
    root.replaceChildren(row, status);
  }

  function drawForm() {
    const form = document.createElement("form");
    form.className = "inline-form";
    form.noValidate = true;
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.textContent = COPY.label;
    const hint = document.createElement("p");
    hint.id = `${id}-hint`;
    hint.className = "muted hint";
    hint.textContent = COPY.hint;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary";
    submit.textContent = busy ? COPY.saving : COPY.save;
    submit.disabled = busy;
    submit.setAttribute("aria-busy", String(busy));
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(submit);
    if (saved) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "link";
      cancel.textContent = COPY.cancel;
      cancel.disabled = busy;
      cancel.addEventListener("click", () => {
        editing = false;
        draw();
      });
      actions.append(cancel);
    }
    input.max = today;
    input.readOnly = busy;
    form.append(label, hint, input, error, actions);
    form.addEventListener("submit", onSubmit);
    root.replaceChildren(form);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const result = validateTmsEndDate(input.value, today);
    if (!result.ok) {
      error.textContent = result.error;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    error.textContent = "";
    input.setAttribute("aria-invalid", "false");
    busy = true;
    draw();
    try {
      await updateDoc(doc(db, COLLECTIONS.patients, patientId), { tmsEndDate: result.date });
      if (destroyed) return;
      saved = result.date;
      editing = false;
      notice = COPY.saved;
    } catch {
      if (destroyed) return;
      // Keep what was typed and say so.
      error.textContent = COPY.failed;
    } finally {
      busy = false;
      if (!destroyed) draw();
    }
  }

  function draw() {
    if (editing || !saved) drawForm();
    else drawShown();
  }

  return {
    update({ patient, today: day }) {
      today = day;
      const next = patient?.tmsEndDate ?? null;
      const changed = next !== saved;
      saved = next;
      // Never redraw a form the Clinician is typing in.
      if (editing || busy) {
        input.max = today;
        return;
      }
      if (changed || !root.childElementCount) draw();
      else input.max = today;
    },
    destroy() {
      destroyed = true;
      root.remove();
    },
  };
}
