// The Intake section of the Patient page: the saved highlights or an empty state; then paste the
// report, extract, review and edit the highlights, and save. The logic is the pure state machine
// in js/lib/intake.js; this file only draws it and runs the two calls.
//
// The report text lives in this page's memory only while the Clinician works on it. It is sent
// once to extractIntake and is never saved or logged. There is deliberately no field for telling
// the Companion anything (ADR 0001): the Intake is background highlights only.
import {
  INTAKE_MAX_WORDS,
  initialIntakeState,
  intakeErrorMessage,
  intakeReducer,
  isBusy,
  wordCountLabel,
} from "../lib/intake.js";

const COPY = {
  heading: "Intake",
  about: "Short background highlights from the clinical report. The Companion reads them as its starting picture of this Patient.",
  empty: "No Intake yet. Paste the clinical report to extract highlights.",
  add: "Add from the report",
  replace: "Replace from a new report",
  reportLabel: "Clinical report",
  reportHint: "Paste the report text. It is used once to extract highlights and is not saved.",
  extract: "Extract highlights",
  extracting: "Extracting…",
  draftLabel: "Highlights to save",
  draftHint: `Check and edit them before saving. At most ${INTAKE_MAX_WORDS} words.`,
  trimmed: `The extracted text was longer than ${INTAKE_MAX_WORDS} words and was cut. Check the last line.`,
  save: "Save highlights",
  saving: "Saving…",
  retry: "Try again",
  back: "Back to the report",
  cancel: "Cancel",
  saved: "Intake saved.",
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
  let destroyed = false;
  let drawnMode = null;
  /** Elements updated in place while typing, so the text box keeps focus and caret. */
  let live = {};

  const section = el("section", { class: "panel", "aria-labelledby": "intake-heading" });
  container.replaceChildren(section);

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

  function header() {
    return [el("h4", { id: "intake-heading", text: COPY.heading }), el("p", { class: "muted", text: COPY.about })];
  }

  function errorLine() {
    const line = el("p", { class: "error", role: "alert", "aria-live": "assertive" });
    live.error = line;
    return line;
  }

  function drawView() {
    const body = saved
      ? el("div", { class: "highlights", id: "intake-saved", text: saved })
      : el("p", { class: "muted", id: "intake-empty", text: COPY.empty });
    const start = el("button", { type: "button", class: "secondary", text: saved ? COPY.replace : COPY.add });
    start.addEventListener("click", () => {
      notice = "";
      dispatch({ type: "start" });
    });
    const status = el("p", { class: "muted", role: "status", text: notice });
    section.replaceChildren(...header(), body, status, el("div", { class: "actions" }, start));
  }

  function drawCompose() {
    const report = el("textarea", { id: "intake-report", rows: 12, spellcheck: "false", "aria-describedby": "intake-report-hint" });
    report.value = state.report;
    report.addEventListener("input", () => dispatch({ type: "editReport", text: report.value }));
    const primary = el("button", { type: "submit", class: "primary" });
    const cancel = el("button", { type: "button", class: "link", text: COPY.cancel });
    cancel.addEventListener("click", () => dispatch({ type: "cancel" }));
    const form = el(
      "form",
      { class: "intake-form", novalidate: true },
      el("label", { for: "intake-report", text: COPY.reportLabel }),
      el("p", { class: "muted hint", id: "intake-report-hint", text: COPY.reportHint }),
      report,
      errorLine(),
      el("div", { class: "actions" }, primary, cancel),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      dispatch({ type: "extract" });
    });
    live = { ...live, input: report, primary, cancel };
    section.replaceChildren(...header(), form);
    report.focus();
  }

  function drawReview() {
    const draft = el("textarea", { id: "intake-draft", rows: 8, "aria-describedby": "intake-draft-hint intake-count" });
    draft.value = state.draft;
    draft.addEventListener("input", () => dispatch({ type: "editDraft", text: draft.value }));
    const count = el("p", { class: "muted hint", id: "intake-count", "aria-live": "polite" });
    const trimmed = el("p", { class: "notice", text: COPY.trimmed, hidden: !state.trimmed });
    const primary = el("button", { type: "submit", class: "primary" });
    const back = el("button", { type: "button", class: "link", text: COPY.back });
    back.addEventListener("click", () => dispatch({ type: "backToReport" }));
    const cancel = el("button", { type: "button", class: "link", text: COPY.cancel });
    cancel.addEventListener("click", () => dispatch({ type: "cancel" }));
    const form = el(
      "form",
      { class: "intake-form", novalidate: true },
      el("label", { for: "intake-draft", text: COPY.draftLabel }),
      el("p", { class: "muted hint", id: "intake-draft-hint", text: COPY.draftHint }),
      trimmed,
      draft,
      count,
      errorLine(),
      el("div", { class: "actions" }, primary, back, cancel),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      dispatch({ type: "save" });
    });
    live = { ...live, input: draft, count, primary, back, cancel };
    section.replaceChildren(...header(), form);
    draft.focus();
  }

  /** Draws the whole section for the current mode. */
  function draw() {
    live = {};
    drawnMode = state.mode;
    if (state.mode === "view") drawView();
    else if (state.mode === "compose" || state.mode === "extracting") drawCompose();
    else drawReview();
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
    if (live.error) live.error.textContent = state.error ?? "";
    if (live.input) {
      live.input.readOnly = busy;
      live.input.setAttribute("aria-invalid", state.error && !state.failed ? "true" : "false");
    }
    if (live.count) live.count.textContent = wordCountLabel(state.draft);
    for (const button of [live.back, live.cancel]) if (button) button.disabled = busy;
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
      if (state.mode === "view") draw();
    },
    destroy() {
      destroyed = true;
      section.remove();
    },
  };
}
