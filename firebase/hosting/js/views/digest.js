// The weekly Digest on the Patient page: the latest Digest (its dates, how many Summaries it drew
// on, when it was generated, and the text) and "Generate now". Self-contained: it reads the
// Patient's `digests` collection itself and calls `generateDigest` through `calls`, so it can be
// mounted in any slot (the Overview and the Summaries sections). The logic is the pure state
// machine in js/lib/digest.js; this file only draws it and runs the call.
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
  empty: "No Digest yet. Generate one for this week so far.",
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
 * @param {{ db: import("firebase/firestore").Firestore, patientId: string, calls: { generateDigest: (patientId: string) => Promise<{ digest: import("../lib/contract.js").Digest }> } }} options
 * @returns {{ destroy: () => void }}
 */
export function mountDigest(slot, { db, patientId, calls }) {
  const id = `digest-${++instances}`;
  let state = initialDigestState();
  let destroyed = false;

  const section = el("section", { class: "panel digest", "aria-labelledby": `${id}-heading` });
  const heading = el("h4", { id: `${id}-heading` }, COPY.heading);
  const about = el("p", { class: "muted" }, COPY.about);
  const meta = el("p", { class: "muted hint" });
  const body = el("div", { class: "highlights" });
  const button = el("button", { type: "button", class: "secondary" });
  const status = el("p", { class: "muted", role: "status", "aria-live": "polite" });
  section.append(heading, about, meta, body, el("div", { class: "actions" }), status);
  section.querySelector(".actions").append(button);
  slot.replaceChildren(section);

  function draw() {
    const { digest } = state;
    if (!state.loaded) {
      meta.textContent = "";
      body.textContent = COPY.loading;
    } else if (!digest) {
      meta.textContent = "";
      body.textContent = state.loadFailed ? "" : COPY.empty;
    } else {
      meta.textContent = `${digestCoverage(digest)} · ${digestSource(digest)} · ${digestGenerated(digest.generatedAtMillis)}`;
      body.textContent = digest.text;
    }
    const busy = isGenerating(state);
    button.textContent = digestButtonLabel(state);
    button.disabled = busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
    status.textContent = digestStatus(state);
    status.className = state.phase === "failed" ? "error" : "muted";
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
