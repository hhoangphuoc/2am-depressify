// A minimal Patient page (`#/patient/{id}`): the Patient's name and the Intake section. The full
// page (Overview, Summaries, Signals, Visits) comes with its own ticket and slots in here.
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { sharingMessage, sharingStateFromError, sharingStateFromSnapshot } from "../lib/sharing.js";
import { mountDigest } from "./digest.js";
import { mountIntake } from "./intake.js";

const COPY = {
  back: "← All Patients",
  loading: "Loading…",
  unnamed: "Unnamed patient",
};

/**
 * Shows one Patient in `root` and keeps it live. Returns a function that stops listening.
 * @param {{ root: HTMLElement, db: import("firebase/firestore").Firestore, patientId: string, calls: { extract: Function, save: Function, generateDigest: Function } }} options
 * @returns {() => void}
 */
export function showPatient({ root, db, patientId, calls }) {
  const back = document.createElement("a");
  back.href = "#/";
  back.className = "back";
  back.textContent = COPY.back;

  const name = document.createElement("h2");
  name.id = "patient-name";
  name.tabIndex = -1;
  name.textContent = COPY.loading;

  const status = document.createElement("p");
  status.className = "muted";
  status.setAttribute("aria-live", "polite");

  const intakeSlot = document.createElement("div");
  intakeSlot.hidden = true;

  // The weekly Digest (#23). With #11 it moves into the overview-digest and summaries-digest slots.
  const digestSlot = document.createElement("div");
  digestSlot.hidden = true;

  root.replaceChildren(back, name, status, digestSlot, intakeSlot);
  name.focus();

  const intake = mountIntake(intakeSlot, { patientId, extract: calls.extract, save: calls.save });
  const digest = mountDigest(digestSlot, { db, patientId, calls });

  /** @param {import("../lib/sharing.js").SharingViewState} state */
  const render = (state) => {
    if (state.status !== "ok") {
      // Withdrawn sharing (#29) or an error: show the state, never the Patient's data.
      name.textContent = COPY.unnamed;
      status.textContent = sharingMessage(state);
      intakeSlot.hidden = true;
      digestSlot.hidden = true;
      return;
    }
    name.textContent = state.patient.displayName || COPY.unnamed;
    status.textContent = "";
    intakeSlot.hidden = false;
    digestSlot.hidden = false;
    intake.setSaved(state.patient.intakeHighlights ?? "");
  };

  const stop = onSnapshot(
    doc(db, COLLECTIONS.patients, patientId),
    (snapshot) => render(sharingStateFromSnapshot({ exists: snapshot.exists(), data: snapshot.data() })),
    // The rules deny the read once the Patient stops sharing: that is the withdrawn state, not an error.
    (error) => render(sharingStateFromError(error)),
  );

  return () => {
    stop();
    intake.destroy();
    digest.destroy();
    root.replaceChildren();
  };
}
