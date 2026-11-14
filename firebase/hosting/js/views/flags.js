// The Attention band at the top of the Patient page (`Attention` in design/clinician/src/App.jsx):
// the level word with its dot, the open reasons with where each came from and when, "View history",
// and "Clear after follow-up" for each open flag. It draws the Patient page's one subscription
// (`view.state`, the PatientState from `data.subscribePatient`: the record, the visible flags and the
// Check-ins, with the sharing filters the rules require).
//
// Clearing goes through the data layer (`data.clearAttention`, js/lib/design-live.js), which runs the
// transaction in js/lib/clear.js: it sets the flag's `clearedAtMillis` and resets the Patient's level
// and reasons to the flags still open. If anything new was raised since the dialog opened, the
// transaction refuses (`changed`) and the dialog asks for a new review (`clearDialogReducer`).
// No note is stored with a clearing: the rules allow only `clearedAtMillis` (see
// docs/design/dashboard-backend-sync.md, "Conflicts").
//
// If the flags could not be loaded (not a withdrawal), the band shows the level saved on the
// Patient's record with a notice, never green, and offers no clearing (`attentionBand`).
import { clearDialogReducer, initialClearDialog, levelAfterClearing, reviewOf } from "../lib/clear.js";
import { attentionBand } from "../lib/design-view.js";
import { createModal } from "./dialog.js";
import { flagChip } from "./ui.js";

const COPY = {
  label: "Attention flag",
  history: "View history",
  historyTitle: "Attention flag history",
  noHistory: "No Attention flag has been raised yet.",
  loading: "Loading the Attention flag…",
  failed: "Could not load the flags. Reload the page to try again.",
  clear: "Clear after follow-up",
  unnamed: "Unnamed patient",
  observed: (/** @type {string | null} */ when, /** @type {string | null} */ source) => [when ? `Observed ${when}` : null, source].filter(Boolean).join(" · "),
  several: (/** @type {number} */ n) => `${n} uncleared reasons · highest level retained`,
  assessment: "Latest assessment unavailable: the latest Check-in could not be reviewed automatically. Uncleared Attention flags are retained.",
  cleared: (/** @type {string} */ name) => `Flag cleared for ${name}. It stays in the history.`,
  alreadyCleared: "This flag is no longer open, so there is nothing to clear.",
  dialogTitle: "Clear after follow-up",
  dialogLead: "Clear this flag for",
  dialogLeadEnd: "once you have followed up.",
  historyStays: (/** @type {string} */ name) => `History stays: the flag remains in ${name}'s record, marked with the time it was cleared.`,
  after: "After clearing, the Attention flag will be",
  stillOpen: "Still open:",
  confirmLabel: "I have followed up on this reason.",
  confirmNeeded: "Confirm you have followed up before clearing the flag.",
  changed: (/** @type {string} */ name) => `Something new was raised for ${name} while this was open. Review what is open now, then clear again.`,
  cancel: "Cancel",
  confirm: "Clear flag",
  saving: "Clearing…",
  dismiss: "Dismiss",
};

/**
 * @param {string} tag
 * @param {Record<string, string | boolean | undefined>} [attrs]
 * @param {(Node | string | null | undefined | false)[]} children
 */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "text") node.textContent = String(value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(.../** @type {(Node | string)[]} */ (children.filter((c) => c !== null && c !== undefined && c !== false)));
  return node;
}

const levelName = (/** @type {string} */ level) => (level === "red" ? "Red" : level === "amber" ? "Amber" : "Green");

/**
 * Mounts the Attention band into `slot`; `update(view)` draws the page's PatientState.
 * @param {HTMLElement} slot
 * @param {{ data: ReturnType<typeof import("../data/design-data.js").designData>, patientId: string }} options
 * @returns {{ update: (view: { state: import("../lib/design-live.js").PatientState }) => void, destroy: () => void }}
 */
export function mountFlagDetail(slot, { data, patientId }) {
  /** @type {import("../lib/design-live.js").PatientState | null} */
  let state = null;
  let destroyed = false;
  let dialogState = initialClearDialog();
  let confirmed = false;
  let notice = "";
  /** The flag id whose button opened the dialog, to return focus to it. */
  let openerId = null;

  const band = el("section", { class: "attention", "aria-label": COPY.label, tabindex: "-1" });
  slot.replaceChildren(band);

  // ---- The clear dialog ------------------------------------------------------------------------
  const clearModal = createModal({ title: COPY.dialogTitle, onCancel: () => dispatch({ type: "cancel" }) });
  const lead = el("p", {});
  const changedLine = el("p", { class: "notice notice-changed", role: "alert", hidden: true });
  const flagBox = el("div", { class: "flag-box" });
  const historyLine = el("p", { class: "small muted" });
  const after = el("div", { class: "after" });
  const checkbox = /** @type {HTMLInputElement} */ (el("input", { type: "checkbox", "data-initial-focus": true }));
  const checkLabel = el("label", { class: "checkbox-label" }, checkbox, COPY.confirmLabel);
  const errorLine = el("p", { class: "error-text", role: "alert", hidden: true });
  const cancelButton = el("button", { type: "button", text: COPY.cancel });
  const confirmButton = el("button", { type: "button", class: "primary", text: COPY.confirm });
  clearModal.body.append(lead, changedLine, flagBox, historyLine, after, checkLabel, errorLine, el("div", { class: "dialog-actions" }, cancelButton, confirmButton));
  checkbox.addEventListener("change", () => {
    confirmed = checkbox.checked;
    if (confirmed && errorLine.textContent === COPY.confirmNeeded) setError("");
  });

  // ---- The history dialog ----------------------------------------------------------------------
  const historyModal = createModal({ title: COPY.historyTitle, onCancel: () => historyModal.close() });
  const historyList = el("div", { class: "history-list" });
  historyModal.body.append(historyList);

  const raw = () => state?.raw ?? null;
  const displayName = () => raw()?.patient?.displayName || COPY.unnamed;
  const currentReview = () => reviewOf(raw()?.patient ?? {}, raw()?.flags ?? []);

  /** @param {string} text */
  function setError(text) {
    errorLine.textContent = text;
    errorLine.hidden = text === "";
  }

  // ---- Drawing ---------------------------------------------------------------------------------

  /** @param {import("../lib/design-model.js").DesignFlag} flag */
  function clearButton(flag) {
    const button = el("button", { type: "button", "data-flag-id": flag.id }, COPY.clear, el("span", { class: "visually-hidden", text: `: ${flag.reason}` }));
    button.addEventListener("click", () => openDialog(flag.id));
    return button;
  }

  function drawBand() {
    if (!state || state.status === "loading") {
      band.className = "attention";
      band.replaceChildren(el("p", { class: "muted", text: COPY.loading }));
      return;
    }
    if (state.status === "withdrawn") {
      band.hidden = true;
      return;
    }
    band.hidden = false;
    if (state.status === "error" || !state.patient) {
      band.className = "attention";
      band.replaceChildren(el("p", { class: "error-text", text: COPY.failed }));
      return;
    }
    const p = state.patient;
    const shown = attentionBand(p);
    const focusedId = /** @type {HTMLElement | null} */ (document.activeElement)?.closest?.("[data-flag-id]")?.getAttribute("data-flag-id");
    const clearable = shown.clearable ? p.activeFlags : [];
    band.className = `attention ${shown.level}`;
    const historyButton = el("button", { type: "button", class: "text-button", text: COPY.history });
    historyButton.addEventListener("click", openHistory);
    // Without the flags there is no history to show either.
    historyButton.hidden = !p.flagsLoaded;
    const top = el("div", { class: "between" }, flagChip(shown.level, shown.word), historyButton);
    const several = p.activeFlags.length > 1;
    const reasons = several
      ? el(
          "ul",
          { class: "flag-reasons" },
          ...p.activeFlags.map((f) =>
            el(
              "li",
              {},
              el("div", {}, el("strong", { text: levelName(f.level) }), ` · ${f.reason}`, el("span", { class: "small muted", text: COPY.observed(f.observed, f.source) })),
              shown.clearable ? clearButton(f) : null,
            ),
          ),
        )
      : // A stored green whose flags could not load is not shown as "No current Attention flag".
        el("p", { text: shown.level === p.level ? p.reason ?? "" : "" });
    const assessment = p.assessmentStatus === "unavailable" && p.activeFlags.length > 0 ? el("p", { class: "small", text: COPY.assessment }) : null;
    const footerText = several ? COPY.several(p.activeFlags.length) : COPY.observed(p.observed, p.source);
    const footer = el("div", { class: "attention-footer" }, el("span", { class: "small muted", text: footerText }), !several && clearable.length === 1 ? clearButton(clearable[0]) : null);
    const failedNotice = shown.notice ? el("p", { class: "notice error-text", role: "alert", text: shown.notice }) : null;
    const status = notice ? el("p", { class: "notice success", role: "status" }, el("span", { text: notice })) : null;
    if (status) {
      const dismiss = el("button", { type: "button", class: "text-button", text: COPY.dismiss });
      dismiss.addEventListener("click", () => {
        notice = "";
        drawBand();
        band.focus();
      });
      status.append(dismiss);
    }
    band.replaceChildren(top, reasons, failedNotice ?? "", assessment ?? "", footer, status ?? "");
    if (focusedId && !band.contains(document.activeElement)) {
      const again = /** @type {HTMLElement | null} */ (band.querySelector(`[data-flag-id="${CSS.escape(focusedId)}"]`));
      (again ?? band).focus();
    }
    if (historyModal.isOpen) drawHistory();
  }

  function drawHistory() {
    const history = state?.patient?.history ?? [];
    historyList.replaceChildren(
      ...(history.length
        ? history.map((item) =>
            el(
              "article",
              {},
              el("div", { class: "between" }, el("strong", { text: `${item.action} · ${levelName(item.level).toLowerCase()}` }), el("time", { text: item.date ?? "" })),
              el("p", { text: item.reason }),
              el("p", { class: "small muted", text: `Source: ${item.source ?? "not recorded"}` }),
              el("p", { class: "small muted", text: `Email: ${item.email}` }),
            ),
          )
        : [el("p", { class: "muted", text: COPY.noHistory })]),
    );
  }

  function openHistory() {
    drawHistory();
    historyModal.open();
  }

  function drawDialog() {
    const ds = dialogState;
    if (ds.mode === "closed") {
      if (clearModal.isOpen) restoreFocus();
      return;
    }
    const name = displayName();
    const line = state?.patient?.activeFlags.find((f) => f.id === ds.flagId);
    lead.replaceChildren(`${COPY.dialogLead} `, el("strong", { text: name }), ` ${COPY.dialogLeadEnd}`);
    flagBox.replaceChildren(
      ...(line ? [el("p", {}, flagChip(line.level), el("span", { class: "flag-box-reason", text: line.reason })), el("p", { class: "small muted", text: COPY.observed(line.observed, line.source) })] : []),
    );
    historyLine.textContent = COPY.historyStays(name);
    const next = levelAfterClearing(raw()?.flags ?? [], ds.flagId ? [ds.flagId] : []);
    after.replaceChildren(
      el("p", {}, `${COPY.after} `, flagChip(next.flagLevel), "."),
      ...(next.flagReasons.length ? [el("p", { text: COPY.stillOpen }), el("ul", { class: "reasons" }, ...next.flagReasons.map((r) => el("li", { text: r })))] : []),
    );
    changedLine.hidden = !ds.changed;
    changedLine.textContent = ds.changed ? COPY.changed(name) : "";
    if (ds.error) setError(ds.error);
    else if (errorLine.textContent !== COPY.confirmNeeded) setError("");
    const saving = ds.mode === "saving";
    clearModal.dialog.setAttribute("aria-busy", String(saving));
    // aria-disabled rather than disabled, so the focused button keeps focus while saving.
    for (const button of [cancelButton, confirmButton, clearModal.closeButton]) button.setAttribute("aria-disabled", String(saving));
    checkbox.disabled = saving;
    confirmButton.textContent = saving ? COPY.saving : COPY.confirm;
    if (!clearModal.isOpen) {
      checkbox.checked = false;
      confirmed = false;
      setError("");
      clearModal.open();
    }
  }

  /** Back to the button that opened the dialog, or to the band once that flag is cleared. */
  function restoreFocus() {
    const opener = openerId ? /** @type {HTMLElement | null} */ (band.querySelector(`[data-flag-id="${CSS.escape(openerId)}"]`)) : null;
    openerId = null;
    clearModal.close(opener ?? band);
  }

  // ---- Dialog actions --------------------------------------------------------------------------

  /** @param {Parameters<typeof clearDialogReducer>[1]} action */
  function dispatch(action) {
    if (destroyed) return;
    const before = dialogState;
    dialogState = clearDialogReducer(dialogState, action);
    if (dialogState !== before) drawDialog();
    if (before.mode !== "closed" && dialogState.mode === "closed" && action.type === "current") {
      notice = COPY.alreadyCleared;
      drawBand();
    }
  }

  function openDialog(flagId) {
    openerId = flagId;
    notice = "";
    dispatch({ type: "open", flagId, reviewed: currentReview() });
  }

  async function confirm() {
    if (dialogState.mode !== "review" || !dialogState.reviewed || !dialogState.flagId) return;
    if (!confirmed) {
      setError(COPY.confirmNeeded);
      checkbox.focus();
      return;
    }
    const { flagId, reviewed } = dialogState;
    const current = raw();
    if (!current) return;
    dispatch({ type: "save" });
    // The data layer's one write path: the transaction against the review the Clinician confirmed.
    const result = await data.clearAttention({ patientId, raw: current, flagIds: [flagId], reviewed, nowMillis: Date.now() });
    if (destroyed) return;
    if (result.ok) {
      notice = COPY.cleared(displayName());
      dispatch({ type: "saved" });
      drawBand();
    } else if (result.changed) {
      // Show what is open now. If this view has not caught up yet, the next live update renews
      // the review again; clearing stays refused until the Clinician confirms what is current.
      checkbox.checked = false;
      confirmed = false;
      dispatch({ type: "changed", current: currentReview() });
      if (dialogState.mode === "closed") {
        notice = COPY.alreadyCleared;
        drawBand();
      }
    } else {
      // `notOpen` and every failure come with the data layer's vetted copy.
      dispatch({ type: "failed", message: result.message });
    }
  }

  cancelButton.addEventListener("click", () => {
    if (cancelButton.getAttribute("aria-disabled") !== "true") dispatch({ type: "cancel" });
  });
  confirmButton.addEventListener("click", () => {
    if (confirmButton.getAttribute("aria-disabled") !== "true") confirm();
  });

  // ---- Live data -------------------------------------------------------------------------------

  /** @param {import("../lib/design-live.js").PatientState} next */
  function onState(next) {
    if (next === state) return;
    state = next;
    if (next.status === "withdrawn" || next.status === "error") {
      // Sharing withdrawn: the page says so; this band hides and its dialogs close.
      if (dialogState.mode !== "closed") dialogState = initialClearDialog();
      clearModal.close();
      historyModal.close();
    }
    drawBand();
    if (dialogState.mode !== "closed" && next.status === "ok" && next.raw?.flags) {
      dispatch({ type: "current", current: currentReview() });
    }
  }

  drawBand();

  return {
    update(view) {
      onState(view.state);
    },
    destroy() {
      destroyed = true;
      clearModal.remove();
      historyModal.remove();
      slot.replaceChildren();
    },
  };
}
