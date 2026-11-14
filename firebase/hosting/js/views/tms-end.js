// The TMS end date: a line with an "Add" or "Edit TMS end date" button that opens the design's modal
// form (`TmsForm` in design/clinician/src/App.jsx). Used by the Overview (a notice while the date is
// missing) and by Intake & Visits (a row under the Visits). The Clinician writes `tmsEndDate` on the
// Patient record directly; the rules allow the Clinician that field. The checks are
// `validateDesignTms` (js/lib/design-model.js): a real date, not in the future, and not after a
// recorded Visit. A failed save keeps the date typed.
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { shortDate } from "../lib/dates.js";
import { validateDesignTms } from "../lib/design-model.js";
import { createModal } from "./dialog.js";

const COPY = {
  label: "TMS end date",
  hint: "Week 1 of the timeline starts the day after.",
  current: (/** @type {string} */ date) => `TMS ended ${date}`,
  missing: "TMS end date not recorded",
  notice: "Add the TMS end date to show weeks and Phases.",
  add: "Add TMS end date",
  edit: "Edit TMS end date",
  save: "Save TMS end date",
  saving: "Saving…",
  retry: "Try saving again",
  cancel: "Cancel",
  saved: "TMS end date saved. Weeks and Phases are updated.",
  failed: "Could not save the date. Check the connection and try again; your entry is kept.",
};

let counter = 0;

/**
 * @param {HTMLElement} container
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string, variant?: "row" | "notice" }} options
 * @returns {{ update: (view: { patient: { tmsEndDate?: string | null }, today: string, visits?: { date: string }[] }) => void, destroy: () => void }}
 */
export function mountTmsEndForm(container, { db, patientId, variant = "row" }) {
  const id = `tms-end-${++counter}`;
  let saved = /** @type {string | null} */ (null);
  let today = "";
  /** @type {{ date: string }[]} */
  let visits = [];
  let busy = false;
  let failed = false;
  let notice = "";
  let destroyed = false;

  const root = document.createElement("div");
  root.className = variant === "notice" ? "notice tms-prompt" : "tms-row";
  const text = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.className = variant === "notice" ? "" : "text-button";
  const status = document.createElement("p");
  status.className = "small muted tms-status";
  status.setAttribute("role", "status");
  root.append(text, button);
  container.replaceChildren(root, status);

  // ---- The modal form --------------------------------------------------------------------------
  const modal = createModal({ title: COPY.add, onCancel: () => !busy && modal.close() });
  const form = document.createElement("form");
  form.noValidate = true;
  const label = document.createElement("label");
  label.htmlFor = `${id}-date`;
  label.textContent = COPY.label;
  const hint = document.createElement("p");
  hint.id = `${id}-hint`;
  hint.className = "small muted field-hint";
  hint.textContent = COPY.hint;
  const input = document.createElement("input");
  input.type = "date";
  input.id = `${id}-date`;
  input.dataset.initialFocus = "";
  input.setAttribute("aria-describedby", `${id}-hint ${id}-error`);
  const error = document.createElement("p");
  error.id = `${id}-error`;
  error.className = "error-text";
  error.setAttribute("role", "alert");
  error.hidden = true;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = COPY.cancel;
  cancel.addEventListener("click", () => !busy && modal.close());
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(cancel, submit);
  form.append(label, hint, input, error, actions);
  modal.body.append(form);

  /** @param {string} message */
  function setError(message) {
    error.textContent = message;
    error.hidden = message === "";
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function drawForm() {
    submit.textContent = busy ? COPY.saving : failed ? COPY.retry : COPY.save;
    submit.disabled = busy;
    submit.setAttribute("aria-busy", String(busy));
    cancel.disabled = busy;
    input.readOnly = busy;
    input.max = today;
  }

  function draw() {
    text.textContent = variant === "notice" ? COPY.notice : saved ? COPY.current(shortDate(saved, today)) : COPY.missing;
    button.textContent = saved ? COPY.edit : COPY.add;
    status.textContent = notice;
    status.hidden = notice === "";
  }

  button.addEventListener("click", () => {
    notice = "";
    failed = false;
    input.value = saved ?? "";
    setError("");
    modal.setTitle(saved ? COPY.edit : COPY.add);
    drawForm();
    draw();
    modal.open();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const result = validateDesignTms(input.value, { today, visits });
    if (!result.ok) {
      setError(result.message);
      input.focus();
      return;
    }
    setError("");
    busy = true;
    drawForm();
    try {
      await updateDoc(doc(db, COLLECTIONS.patients, patientId), { tmsEndDate: result.date });
      if (destroyed) return;
      saved = result.date;
      failed = false;
      notice = COPY.saved;
      busy = false;
      modal.close(button.isConnected ? button : null);
    } catch {
      if (destroyed) return;
      // Keep what was typed and say so.
      failed = true;
      busy = false;
      setError(COPY.failed);
      submit.focus();
    } finally {
      if (!destroyed) {
        drawForm();
        draw();
      }
    }
  });

  return {
    update({ patient, today: day, visits: list = [] }) {
      today = day;
      visits = list;
      saved = patient?.tmsEndDate ?? null;
      if (!modal.isOpen) draw();
      input.max = today;
    },
    destroy() {
      destroyed = true;
      modal.remove();
      root.remove();
      status.remove();
    },
  };
}
