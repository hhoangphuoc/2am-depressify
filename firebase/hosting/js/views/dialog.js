// A modal dialog in the design's style (`Modal` in design/clinician/src/App.jsx): a native <dialog>
// opened with showModal(), so the rest of the page is inert; a heading with a Close button; Escape
// asks the owner (`onCancel`) instead of closing behind its back; the first [data-initial-focus]
// element (or the first field or button) takes focus; focus returns to the opener on close.
let counter = 0;

/**
 * @param {{ title: string, onCancel: () => void, describedBy?: string }} options
 *   `onCancel` runs for Escape and the Close button; the owner decides whether to close
 */
export function createModal({ title, onCancel }) {
  const id = `modal-${++counter}`;
  const dialog = /** @type {HTMLDialogElement} */ (document.createElement("dialog"));
  dialog.className = "modal";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  const heading = document.createElement("div");
  heading.className = "modal-heading";
  const h2 = document.createElement("h2");
  h2.id = `${id}-title`;
  h2.textContent = title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "text-button";
  close.textContent = "Close";
  close.setAttribute("aria-label", `Close ${title}`);
  close.addEventListener("click", () => onCancel());
  heading.append(h2, close);
  const body = document.createElement("div");
  body.className = "modal-body";
  dialog.append(heading, body);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    onCancel();
  });

  /** @type {HTMLElement | null} */
  let opener = null;

  return {
    dialog,
    body,
    closeButton: close,
    /** @param {string} text */
    setTitle(text) {
      h2.textContent = text;
      close.setAttribute("aria-label", `Close ${text}`);
    },
    get isOpen() {
      return dialog.open;
    },
    open() {
      if (dialog.open) return;
      opener = /** @type {HTMLElement | null} */ (document.activeElement);
      if (!dialog.isConnected) document.body.append(dialog);
      dialog.showModal();
      const first = /** @type {HTMLElement | null} */ (
        dialog.querySelector("[data-initial-focus]") ?? body.querySelector("input:not([disabled]), textarea, select, button:not([disabled])")
      );
      (first ?? close).focus();
    },
    /** @param {HTMLElement | null} [focusTarget] where focus goes; the opener by default */
    close(focusTarget = null) {
      if (!dialog.open) return;
      dialog.close();
      const target = focusTarget ?? (opener?.isConnected ? opener : null);
      opener = null;
      target?.focus();
    },
    remove() {
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
