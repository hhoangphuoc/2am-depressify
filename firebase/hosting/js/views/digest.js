// The weekly Digest on the Patient page, laid out as the design (`WeeklyDigest` in
// design/clinician/src/App.jsx): the heading with "Generate now", the dates it covers, how many
// Summaries it drew on, when it was generated, and the text. `compact` (the Overview's one-third
// column) puts the text behind "Read Digest" and makes the button a text button. Self-contained: it
// reads the Patient's `digests` collection itself and calls `generateDigest` through `calls`, so it
// can be mounted in any slot. The logic is the pure state machine in js/lib/digest.js; this file
// only draws it and runs the call.
import { limit, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { patientQuery } from "../queries.js";
import {
  digestButtonLabel,
  digestCoverage,
  digestErrorMessage,
  digestGenerated,
  digestReducer,
  digestSource,
  digestStatus,
  initialDigestState,
  isGenerating,
} from "../lib/digest.js";

const COPY = {
  heading: "Weekly Digest",
  about: "A short account of the week from the Patient's Summaries and Signals. Written every Monday morning for the week before; Generate now writes this week so far.",
  loading: "Loading…",
  empty: "No Digest generated for this week yet.",
  read: "Read Digest",
};

let instances = 0;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Mounts the Digest into `slot` and keeps it live. Call `destroy` to stop listening.
 * @param {HTMLElement} slot
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string, compact?: boolean, calls: { generateDigest: (patientId: string) => Promise<{ digest: import("../lib/contract.js").Digest }> } }} options
 * @returns {{ destroy: () => void }}
 */
export function mountDigest(slot, { db, patientId, calls, compact = false }) {
  const id = `digest-${++instances}`;
  let state = initialDigestState();
  let destroyed = false;

  const section = el("section", { class: `content-section digest${compact ? " compact-digest" : ""}`, "aria-labelledby": `${id}-heading` });
  const headingText = el("div");
  const meta = el("p", { class: "muted" });
  headingText.append(el("h2", { id: `${id}-heading` }, COPY.heading), meta);
  const button = el("button", { type: "button", class: compact ? "text-button" : "primary" });
  const heading = el("div", { class: "section-heading" });
  heading.append(headingText, button);
  const status = el("p", { class: "muted", role: "status", "aria-live": "polite" });
  const text = el("p", { class: "digest-text" });
  const source = el("p", { class: "small muted" });
  const content = el("div");
  content.append(text, source);
  if (compact) {
    const details = el("details");
    details.append(el("summary", {}, COPY.read), content);
    section.append(heading, status, details);
  } else {
    section.append(heading, status, content, el("p", { class: "small muted" }, COPY.about));
  }
  slot.replaceChildren(section);

  function draw() {
    const { digest } = state;
    const details = section.querySelector("details");
    if (!state.loaded) {
      meta.textContent = COPY.loading;
      text.textContent = "";
      source.textContent = "";
    } else if (!digest) {
      meta.textContent = state.loadFailed ? "" : COPY.empty;
      text.textContent = "";
      source.textContent = "";
    } else {
      meta.textContent = compact ? digestGenerated(digest.generatedAtMillis) : digestCoverage(digest);
      text.textContent = digest.text;
      source.textContent = compact
        ? `${digestCoverage(digest)} · ${digestSource(digest)}`
        : `${digestGenerated(digest.generatedAtMillis)} · ${digestSource(digest)}`;
    }
    if (details) details.hidden = !digest;
    const busy = isGenerating(state);
    button.textContent = digestButtonLabel(state);
    button.disabled = busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
    status.textContent = digestStatus(state);
    status.className = state.phase === "failed" ? "error-text" : "muted small";
    status.hidden = status.textContent === "";
  }

  function dispatch(action) {
    if (destroyed) return;
    const before = state;
    state = digestReducer(state, action);
    if (state === before) return;
    draw();
    if (isGenerating(state) && !isGenerating(before)) generate();
  }

  async function generate() {
    try {
      const result = await calls.generateDigest(patientId);
      dispatch({ type: "generateSucceeded", digest: result?.digest ?? null });
    } catch (error) {
      dispatch({ type: "generateFailed", message: digestErrorMessage(error) });
    }
  }

  button.addEventListener("click", () => dispatch({ type: "generate" }));

  // The latest shared week first. Ids are zero-padded ISO weeks, so they sort by week. The sharing
  // filter plus this order needs the composite index in firestore.indexes.json.
  const stop = onSnapshot(
    patientQuery(db, patientId, COLLECTIONS.digests, orderBy("isoWeek", "desc"), limit(1)),
    (snapshot) => dispatch({ type: "loaded", digest: snapshot.empty ? null : snapshot.docs[0].data() }),
    // Withdrawn sharing also lands here; the Patient page shows that state and hides this slot.
    () => dispatch({ type: "loadFailed" }),
  );

  draw();

  return {
    destroy() {
      destroyed = true;
      stop();
      section.remove();
    },
  };
}
