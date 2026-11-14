// Flag detail on the Patient page, with "Clear after follow-up". Self-contained: it listens to the
// Patient record and the flags itself, so it can be mounted into any slot (the Overview section's
// `overview-flags` slot once the four-section page lands).
//
// Shows the Patient's level word, each open flag (level word, reason as a plain sentence, where it
// came from, when it was raised) and the history of cleared flags. Each open flag has a "Clear
// after follow-up" button that opens a dialog naming the Patient. The logic is pure, in
// js/lib/flag-detail.js and js/lib/clear.js; this file draws it and runs the clearing transaction.
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { clearDialogReducer, clearErrorMessage, clearFlags, initialClearDialog, levelAfterClearing, reviewOf } from "../lib/clear.js";
import { COLLECTIONS } from "../lib/contract.js";
import { flagDetailModel } from "../lib/flag-detail.js";
import { levelWord } from "../lib/list-row.js";
import { sharingStateFromError, sharingStateFromSnapshot } from "../lib/sharing.js";

const FIRESTORE = { collection, doc, getDocs, runTransaction };

const COPY = {
  heading: "Attention",
  about: "Attention is a work queue for follow-up, not a judgement about the Patient. Clear a flag once you have followed up; it stays in the history.",
  level: "Attention flag",
  open: "Open flags",
  noOpen: "No open flags.",
  history: "Cleared flags",
  noHistory: "No cleared flags yet.",
  loading: "Loading flags…",
  failed: "Could not load the flags. Reload the page to try again.",
  clear: "Clear after follow-up",
  unnamed: "Unnamed patient",
  cleared: (/** @type {string} */ name) => `Flag cleared for ${name}. It stays in the history.`,
  alreadyCleared: "This flag is no longer open, so there is nothing to clear.",
  dialogTitle: "Clear after follow-up",
  dialogLead: "Clear this flag for",
  dialogLeadEnd: "once you have followed up.",
  history_stays: (/** @type {string} */ name) => `History stays: the flag remains in ${name}'s record, marked with the time it was cleared.`,
  after: "After clearing, the Attention flag will be",
  stillOpen: "Still open:",
  changed: (/** @type {string} */ name) =>
    `Something new was raised for ${name} while this was open. Review what is open now, then clear again.`,
  cancel: "Cancel",
  confirm: "Clear flag",
  saving: "Clearing…",
};

let nextId = 0;

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

/** @param {string} level */
const chip = (level) => el("span", { class: `level level-${levelWord(level).toLowerCase()}`, text: levelWord(level) });

/** Elements a modal dialog can move focus between. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mounts the flag detail into `slot` and keeps it live.
 * @param {HTMLElement} slot
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string, patient?: object | null }} options
 *   `patient` is an optional first value of the record, drawn until the live one arrives
 * @returns {() => void} stops listening and removes the section
 */
export function mountFlagDetail(slot, { db, patientId, patient: initialPatient = null }) {
  const uid = `flags-${++nextId}`;
  /** @type {any} */
  let patient = initialPatient;
  /** @type {any[] | null} */
  let flags = null;
  let failed = false;
  let visible = true;
  let destroyed = false;
  let dialogState = initialClearDialog();
  /** The flag id whose button opened the dialog, to return focus to it. */
  let openerId = null;

  const section = el("section", { class: "panel attention", "aria-labelledby": `${uid}-heading` });
  const heading = el("h3", { id: `${uid}-heading`, text: COPY.heading });
  const about = el("p", { class: "hint muted", text: COPY.about });
  const content = el("div", { class: "attention-body" });
  const status = el("p", { class: "notice", role: "status", hidden: true });
  section.append(heading, about, status, content);

  // ---- The dialog -------------------------------------------------------------------------------
  const dialog = /** @type {HTMLDialogElement} */ (
    el("dialog", { class: "dialog", "aria-labelledby": `${uid}-dialog-title`, "aria-describedby": `${uid}-dialog-lead` })
  );
  const dialogTitle = el("h2", { id: `${uid}-dialog-title`, text: COPY.dialogTitle });
  const dialogLead = el("p", { id: `${uid}-dialog-lead` });
  const dialogChanged = el("p", { class: "notice notice-changed", role: "alert", hidden: true });
  const dialogFlag = el("div", { class: "flag-box" });
  const dialogHistory = el("p", {});
  const dialogAfter = el("div", { class: "after" });
  const dialogError = el("p", { class: "error", role: "alert" });
  const cancelButton = /** @type {HTMLButtonElement} */ (el("button", { type: "button", class: "secondary", text: COPY.cancel }));
  const confirmButton = /** @type {HTMLButtonElement} */ (el("button", { type: "button", class: "primary", text: COPY.confirm }));
  dialog.append(
    dialogTitle,
    dialogLead,
    dialogChanged,
    dialogFlag,
    dialogHistory,
    dialogAfter,
    dialogError,
    el("div", { class: "actions" }, cancelButton, confirmButton),
  );

  slot.replaceChildren(section, dialog);

  const displayName = () => patient?.displayName || COPY.unnamed;
  const currentReview = () => reviewOf(patient ?? {}, flags ?? []);

  // ---- Drawing ----------------------------------------------------------------------------------

  /** @param {import("../lib/flag-detail.js").FlagLine} line @param {boolean} clearable */
  function flagItem(line, clearable) {
    const item = el(
      "li",
      { class: "flag" },
      el("p", { class: "flag-reason" }, chip(line.level), " ", line.reason),
      el("p", { class: "flag-meta muted", text: [line.source, line.raised, line.cleared].filter(Boolean).join(" · ") }),
    );
    if (clearable) {
      const button = el("button", { type: "button", class: "secondary", "data-flag-id": line.id }, COPY.clear);
      button.append(el("span", { class: "visually-hidden", text: `: ${line.reason}` }));
      button.addEventListener("click", () => openDialog(line.id));
      item.append(button);
    }
    return item;
  }

  function drawSection() {
    section.hidden = !visible;
    if (!visible) return;
    if (failed) {
      content.replaceChildren(el("p", { class: "error", text: COPY.failed }));
      return;
    }
    if (flags === null || patient === null) {
      content.replaceChildren(el("p", { class: "muted", text: COPY.loading }));
      return;
    }
    // Keep keyboard focus on the same button across live redraws.
    const focusedId = /** @type {HTMLElement | null} */ (document.activeElement)?.closest?.("[data-flag-id]")?.getAttribute("data-flag-id");
    const model = flagDetailModel(flags);
    content.replaceChildren(
      el("p", { class: "attention-level" }, `${COPY.level}: `, chip(patient.flagLevel)),
      el("h4", { text: COPY.open }),
      model.open.length
        ? el("ul", { class: "flag-list" }, ...model.open.map((line) => flagItem(line, true)))
        : el("p", { class: "muted", text: COPY.noOpen }),
      el("h4", { text: COPY.history }),
      model.history.length
        ? el("ul", { class: "flag-list flag-history" }, ...model.history.map((line) => flagItem(line, false)))
        : el("p", { class: "muted", text: COPY.noHistory }),
    );
    if (focusedId && !content.contains(document.activeElement)) {
      // The same button again, or the heading once that flag has moved to the history.
      const again = /** @type {HTMLElement | null} */ (content.querySelector(`[data-flag-id="${CSS.escape(focusedId)}"]`));
      if (again) again.focus();
      else focusHeading();
    }
  }

  function drawDialog() {
    const state = dialogState;
    if (state.mode === "closed") {
      if (dialog.open) {
        dialog.close();
        restoreFocus();
      }
      return;
    }
    const name = displayName();
    const line = flagDetailModel(flags ?? []).open.find((f) => f.id === state.flagId);
    dialogLead.replaceChildren(`${COPY.dialogLead} `, el("strong", { text: name }), ` ${COPY.dialogLeadEnd}`);
    dialogFlag.replaceChildren(
      ...(line
        ? [el("p", { class: "flag-reason" }, chip(line.level), " ", line.reason), el("p", { class: "flag-meta muted", text: `${line.source} · ${line.raised}` })]
        : []),
    );
    dialogHistory.textContent = COPY.history_stays(name);
    const after = levelAfterClearing(flags ?? [], state.flagId ? [state.flagId] : []);
    dialogAfter.replaceChildren(
      el("p", {}, `${COPY.after} `, chip(after.flagLevel), "."),
      ...(after.flagReasons.length
        ? [el("p", { text: COPY.stillOpen }), el("ul", { class: "reasons" }, ...after.flagReasons.map((r) => el("li", { text: r })))]
        : []),
    );
    dialogChanged.hidden = !state.changed;
    dialogChanged.textContent = state.changed ? COPY.changed(name) : "";
    dialogError.textContent = state.error ?? "";
    const saving = state.mode === "saving";
    dialog.setAttribute("aria-busy", String(saving));
    // aria-disabled rather than disabled, so the focused button keeps focus while saving.
    for (const button of [cancelButton, confirmButton]) button.setAttribute("aria-disabled", String(saving));
    confirmButton.textContent = saving ? COPY.saving : COPY.confirm;
    if (!dialog.open) {
      dialog.showModal();
      cancelButton.focus();
    }
  }

  /** Back to the button that opened the dialog, or to the heading once that flag is cleared. */
  function restoreFocus() {
    const opener = openerId ? /** @type {HTMLElement | null} */ (content.querySelector(`[data-flag-id="${CSS.escape(openerId)}"]`)) : null;
    openerId = null;
    if (opener) opener.focus();
    else focusHeading();
  }

  function focusHeading() {
    heading.tabIndex = -1;
    heading.focus();
  }

  function showStatus(text) {
    status.textContent = text;
    status.hidden = text === "";
  }

  // ---- Dialog actions ---------------------------------------------------------------------------

  /** @param {Parameters<typeof clearDialogReducer>[1]} action */
  function dispatch(action) {
    if (destroyed) return;
    const before = dialogState;
    dialogState = clearDialogReducer(dialogState, action);
    if (dialogState !== before) drawDialog();
    if (before.mode !== "closed" && dialogState.mode === "closed" && action.type === "current") {
      showStatus(COPY.alreadyCleared);
    }
  }

  function openDialog(flagId) {
    openerId = flagId;
    showStatus("");
    dispatch({ type: "open", flagId, reviewed: currentReview() });
  }

  async function confirm() {
    if (dialogState.mode !== "review" || !dialogState.reviewed || !dialogState.flagId) return;
    const { flagId, reviewed } = dialogState;
    dispatch({ type: "save" });
    try {
      await clearFlags(FIRESTORE, db, { patientId, flagIds: [flagId], reviewed, nowMillis: Date.now() });
      if (destroyed) return;
      const name = displayName();
      dispatch({ type: "saved" });
      showStatus(COPY.cleared(name));
    } catch (error) {
      if (destroyed) return;
      const code = /** @type {any} */ (error)?.code;
      if (code === "flag/changed") {
        // Show what is open now. If this view has not caught up yet, the next live update renews
        // the review again; clearing stays refused until the Clinician confirms what is current.
        dispatch({ type: "changed", current: currentReview() });
        if (dialogState.mode === "closed") showStatus(COPY.alreadyCleared);
      } else if (code === "flag/not-open") {
        dispatch({ type: "failed", message: COPY.alreadyCleared });
      } else {
        dispatch({ type: "failed", message: clearErrorMessage(error) });
      }
    }
  }

  cancelButton.addEventListener("click", () => {
    if (cancelButton.getAttribute("aria-disabled") !== "true") dispatch({ type: "cancel" });
  });
  confirmButton.addEventListener("click", () => {
    if (confirmButton.getAttribute("aria-disabled") !== "true") confirm();
  });
  // Escape: the dialog's own cancel event. Never let the browser close it behind the state's back.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dispatch({ type: "cancel" });
  });
  // Keep Tab and Shift+Tab inside the dialog.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = /** @type {HTMLElement[]} */ ([...dialog.querySelectorAll(FOCUSABLE)]);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  // If the browser closes it anyway (for example a repeated Escape), keep the state in step.
  dialog.addEventListener("close", () => {
    if (dialogState.mode === "review") {
      dialogState = initialClearDialog();
      restoreFocus();
    }
  });

  // ---- Live data --------------------------------------------------------------------------------

  function changed() {
    drawSection();
    if (dialogState.mode !== "closed" && flags !== null && patient !== null) {
      dispatch({ type: "current", current: currentReview() });
    }
  }

  /** Sharing withdrawn, or not this Clinician's Patient: the page says so; this section hides. */
  function hide() {
    visible = false;
    if (dialogState.mode !== "closed") {
      dialogState = initialClearDialog();
      if (dialog.open) dialog.close();
    }
    drawSection();
  }

  const stopPatient = onSnapshot(
    doc(db, COLLECTIONS.patients, patientId),
    (snapshot) => {
      const state = sharingStateFromSnapshot({ exists: snapshot.exists(), data: snapshot.data() });
      if (state.status !== "ok") return hide();
      visible = true;
      patient = state.patient;
      changed();
    },
    (error) => (sharingStateFromError(error).status === "withdrawn" ? hide() : ((failed = true), drawSection())),
  );
  const stopFlags = onSnapshot(
    collection(db, COLLECTIONS.patients, patientId, COLLECTIONS.flags),
    (snapshot) => {
      failed = false;
      flags = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
      changed();
    },
    (error) => (sharingStateFromError(error).status === "withdrawn" ? hide() : ((failed = true), drawSection())),
  );

  drawSection();

  return () => {
    destroyed = true;
    stopPatient();
    stopFlags();
    if (dialog.open) dialog.close();
    slot.replaceChildren();
  };
}
