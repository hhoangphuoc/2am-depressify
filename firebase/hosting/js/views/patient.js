// A minimal Patient page (`#/patient/{id}`): the Patient's name and the Intake section. The full
// page (Overview, Summaries, Signals, Visits) comes with its own ticket and slots in here.
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { COLLECTIONS } from "../lib/contract.js";
import { mountIntake } from "./intake.js";

const COPY = {
  back: "← All Patients",
  loading: "Loading…",
  unavailable: "This Patient's page is not available. They may not be linked to you, or no longer share their progress.",
  unnamed: "Unnamed patient",
};

/**
 * Shows one Patient in `root` and keeps it live. Returns a function that stops listening.
 * @param {{ root: HTMLElement, db: import("firebase/firestore").Firestore, patientId: string, calls: { extract: Function, save: Function } }} options
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

  root.replaceChildren(back, name, status, intakeSlot);
  name.focus();

  const intake = mountIntake(intakeSlot, { patientId, extract: calls.extract, save: calls.save });

  const unavailable = () => {
    name.textContent = COPY.unnamed;
    status.textContent = COPY.unavailable;
    intakeSlot.hidden = true;
  };

  const stop = onSnapshot(
    doc(db, COLLECTIONS.patients, patientId),
    (snapshot) => {
      if (!snapshot.exists()) return unavailable();
      const patient = snapshot.data();
      name.textContent = patient.displayName || COPY.unnamed;
      status.textContent = "";
      intakeSlot.hidden = false;
      intake.setSaved(patient.intakeHighlights ?? "");
    },
    // Denied by the rules, for example when the Patient is not (or no longer) visible to this Clinician.
    unavailable,
  );

  return () => {
    stop();
    intake.destroy();
    root.replaceChildren();
  };
}
