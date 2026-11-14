// The Intake section of the Patient page, laid out as the design: the saved highlights as a list (or
// an empty state) with "Add Intake" / "Replace Intake"; the work happens in a modal (`IntakeForm` in
// design/clinician/src/App.jsx): paste the report or choose a .txt or .md file, extract, review and
// edit the highlights, and save. The logic is the pure state machine in js/lib/intake.js; this file
// only draws it and runs the two calls.
//
// The report text lives in this page's memory only while the Clinician works on it. It is sent
// once to extractIntake and is never saved or logged. There is deliberately no field for telling
// the Companion anything (ADR 0001): the Intake is background highlights only.
import { highlightsList, intakeFileProblem } from "../lib/design-model.js";
import {
  INTAKE_MAX_WORDS,
  initialIntakeState,
  intakeErrorMessage,
  intakeReducer,
  isBusy,
  wordCountLabel,
} from "../lib/intake.js";
import { createModal } from "./dialog.js";

const COPY = {
  heading: "Intake",
  about: "Short background highlights from the clinical report. The Companion reads them as its starting picture of this Patient.",
  empty: "No Intake yet. Add the clinical report to extract highlights.",
  add: "Add Intake",
  replace: "Replace Intake",
  footnote: "Saved highlights only. The report itself is never kept.",
  title: "Add Intake from the report",
  lead: "The report is used once to extract highlights and is not saved.",
  reportLabel: "Report text",
  reportHint: "Paste the report, or choose a text file below.",
  fileLabel: "Or choose a text file",
  fileHint: ".txt or .md, up to 100 KB. The file stays in this page.",
  fileName: (/** @type {string} */ name) => `${name} · local file`,
  fileFailed: "The file could not be read. Try again or paste the text.",
  extract: "Extract highlights",
  extracting: "Extracting…",
  draftHeading: "Extracted highlights",
  draftLabel: "Highlights to save",
  draftHint: `Review and edit them before saving, one per line. At most ${INTAKE_MAX_WORDS} words.`,
  trimmed: `The extracted text was longer than ${INTAKE_MAX_WORDS} words and was cut. Check the last line.`,
  save: "Save Intake",
  saving: "Saving…",
  retry: "Try again",
  back: "Back to report",
  cancel: "Cancel",
  saved: "Intake highlights saved. The report was not kept.",
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "text") node.textContent = value;
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

/**
 * Mounts the Intake section into `container`.
 * @param {HTMLElement} container
 * @param {{ patientId: string, extract: (patientId: string, reportText: string) => Promise<{ highlights: string, trimmed: boolean }>, save: (patientId: string, highlights: string) => Promise<unknown> }} options
 * @returns {{ setSaved: (highlights: string) => void, destroy: () => void }}
 */
export function mountIntake(container, { patientId, extract, save }) {
  let state = initialIntakeState();
  let saved = "";
  let notice = "";
  let fileName = "";
  let fileError = "";
  let destroyed = false;
  let drawnMode = null;
  /** Elements updated in place while typing, so the text box keeps focus and caret. */
  let live = {};
  /** Increases on each file read, so a slow read never overwrites newer text. */
  let reading = 0;

  const section = el("section", { class: "content-section intake", "aria-labelledby": "intake-heading" });
  container.replaceChildren(section);
  const modal = createModal({ title: COPY.title, onCancel: () => dispatch({ type: "cancel" }) });

  function dispatch(action) {
    if (destroyed) return;
    const before = state;
    state = intakeReducer(state, action);
    if (state === before) return;
    refresh();
    runEffects(before);
  }

  async function runEffects(before) {
    if (state.mode === "extracting" && before.mode !== "extracting") {
      try {
        const result = await extract(patientId, state.report);
        dispatch({ type: "extractSucceeded", highlights: result.highlights, trimmed: result.trimmed });
      } catch (error) {
        dispatch({ type: "extractFailed", message: intakeErrorMessage("extract", error) });
      }
    }
    if (state.mode === "saving" && before.mode !== "saving") {
      try {
        const result = await save(patientId, state.draft);
        // Show what was saved at once; the live record confirms it a moment later.
        if (typeof result?.intakeHighlights === "string") saved = result.intakeHighlights;
        notice = COPY.saved;
        dispatch({ type: "saveSucceeded" });
      } catch (error) {
        dispatch({ type: "saveFailed", message: intakeErrorMessage("save", error) });
      }
    }
  }

  function drawSection() {
    const start = el("button", { type: "button", class: "primary", text: saved ? COPY.replace : COPY.add });
    start.addEventListener("click", () => {
      notice = "";
      fileName = "";
      fileError = "";
      dispatch({ type: "start" });
    });
    const heading = el("div", { class: "section-heading" }, el("div", {}, el("h2", { id: "intake-heading", text: COPY.heading }), el("p", { class: "muted", text: COPY.about })), start);
    const items = highlightsList(saved);
    const body = items.length
      ? el("ul", { class: "highlights", id: "intake-saved" }, ...items.map((h) => el("li", { text: h })))
      : el("p", { class: "muted", id: "intake-empty", text: COPY.empty });
    const status = notice ? el("p", { class: "notice success", role: "status", text: notice }) : el("p", { class: "visually-hidden", role: "status" });
    section.replaceChildren(heading, status, body, el("p", { class: "small muted", text: COPY.footnote }));
  }

  function errorLine() {
    const line = el("p", { class: "error-text", role: "alert", "aria-live": "assertive", hidden: true });
    live.error = line;
    return line;
  }

  function drawCompose() {
    const report = el("textarea", { id: "intake-report", rows: 8, spellcheck: "false", "data-initial-focus": true, "aria-describedby": "intake-report-hint" });
    report.value = state.report;
    report.addEventListener("input", () => {
      reading += 1;
      fileName = "";
      fileError = "";
      dispatch({ type: "editReport", text: report.value });
    });
    const file = el("input", { type: "file", id: "intake-file", accept: ".txt,.md,text/plain,text/markdown", "aria-describedby": "intake-file-hint intake-file-status" });
    const fileStatus = el("p", { class: "small muted", id: "intake-file-status", text: fileName ? COPY.fileName(fileName) : "" });
    file.addEventListener("change", async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      const request = ++reading;
      const problem = intakeFileProblem(chosen);
      if (problem) {
        fileError = problem;
        file.value = "";
        refresh();
        return;
      }
      try {
        const text = await chosen.text();
        if (request !== reading || destroyed) return;
        fileName = chosen.name;
        fileError = "";
        report.value = text;
        fileStatus.textContent = COPY.fileName(fileName);
        dispatch({ type: "editReport", text });
        refresh();
      } catch {
        if (request !== reading) return;
        fileError = COPY.fileFailed;
        refresh();
      }
    });
    const primary = el("button", { type: "submit", class: "primary" });
    const cancel = el("button", { type: "button", text: COPY.cancel });
    cancel.addEventListener("click", () => dispatch({ type: "cancel" }));
    const fieldset = el(
      "fieldset",
      {},
      el("label", { for: "intake-report", text: COPY.reportLabel }),
      el("p", { class: "small muted field-hint", id: "intake-report-hint", text: COPY.reportHint }),
      report,
      el("label", { for: "intake-file", text: COPY.fileLabel }),
      el("p", { class: "small muted field-hint", id: "intake-file-hint", text: COPY.fileHint }),
      file,
      fileStatus,
    );
    const form = el("form", { class: "intake-form", novalidate: true }, el("p", { class: "muted", text: COPY.lead }), fieldset, errorLine(), el("div", { class: "dialog-actions" }, cancel, primary));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      dispatch({ type: "extract" });
    });
    live = { ...live, input: report, fieldset, primary, cancel };
    modal.body.replaceChildren(form);
  }

  function drawReview() {
    const draft = el("textarea", { id: "intake-draft", rows: 8, "data-initial-focus": true, "aria-describedby": "intake-draft-hint intake-count" });
    draft.value = state.draft;
    draft.addEventListener("input", () => dispatch({ type: "editDraft", text: draft.value }));
    const count = el("p", { class: "small muted", id: "intake-count", "aria-live": "polite" });
    const trimmed = el("p", { class: "notice", text: COPY.trimmed, hidden: !state.trimmed });
    const primary = el("button", { type: "submit", class: "primary" });
    const back = el("button", { type: "button", text: COPY.back });
    back.addEventListener("click", () => dispatch({ type: "backToReport" }));
    const form = el(
      "form",
      { class: "intake-form", novalidate: true },
      el("h3", { text: COPY.draftHeading }),
      trimmed,
      el("label", { for: "intake-draft", text: COPY.draftLabel }),
      el("p", { class: "small muted field-hint", id: "intake-draft-hint", text: COPY.draftHint }),
      draft,
      count,
      errorLine(),
      el("div", { class: "dialog-actions" }, back, primary),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      dispatch({ type: "save" });
    });
    live = { ...live, input: draft, count, primary, back };
    modal.body.replaceChildren(form);
  }

  /** Draws for the current mode: the section always, the modal's form while working. */
  function draw() {
    live = {};
    drawnMode = state.mode;
    if (state.mode === "view") {
      drawSection();
      // The section was redrawn, so focus goes to its new Add / Replace button.
      if (modal.isOpen) modal.close(/** @type {HTMLElement | null} */ (section.querySelector(".section-heading button")));
    } else {
      if (state.mode === "compose" || state.mode === "extracting") drawCompose();
      else drawReview();
      if (modal.isOpen) /** @type {HTMLElement | null} */ (modal.body.querySelector("[data-initial-focus]"))?.focus();
      else modal.open();
    }
    refresh();
  }

  /** Updates the parts that change without a change of mode. */
  function refresh() {
    if (state.mode !== drawnMode) {
      // Busy and idle modes of the same form share one drawing.
      const sameForm =
        (["compose", "extracting"].includes(state.mode) && ["compose", "extracting"].includes(drawnMode)) ||
        (["review", "saving"].includes(state.mode) && ["review", "saving"].includes(drawnMode));
      if (!sameForm) return draw();
      drawnMode = state.mode;
    }
    const busy = isBusy(state);
    if (live.error) {
      const message = state.error ?? fileError ?? "";
      live.error.textContent = message;
      live.error.hidden = !message;
    }
    if (live.input) {
      live.input.readOnly = busy;
      live.input.setAttribute("aria-invalid", state.error && !state.failed ? "true" : "false");
    }
    if (live.fieldset) for (const input of live.fieldset.querySelectorAll("input[type=file]")) input.disabled = busy;
    if (live.count) live.count.textContent = wordCountLabel(state.draft);
    for (const button of [live.back, live.cancel, modal.closeButton]) if (button) button.disabled = busy;
    modal.dialog.setAttribute("aria-busy", busy ? "true" : "false");
    if (live.primary) {
      live.primary.disabled = busy;
      live.primary.setAttribute("aria-busy", busy ? "true" : "false");
      live.primary.textContent =
        state.mode === "extracting" ? COPY.extracting
        : state.mode === "saving" ? COPY.saving
        : state.failed ? COPY.retry
        : state.mode === "compose" ? COPY.extract
        : COPY.save;
    }
  }

  draw();

  return {
    setSaved(highlights) {
      saved = typeof highlights === "string" ? highlights : "";
      if (state.mode === "view") drawSection();
    },
    destroy() {
      destroyed = true;
      modal.remove();
      section.remove();
    },
  };
}
