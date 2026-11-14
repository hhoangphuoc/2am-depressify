// Clinician dashboard, walking skeleton: email and password sign-in and a live Patient list.
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { initFirebase } from "./firebase.js";
import { signInErrorMessage } from "./lib/auth.js";
import { COLLECTIONS } from "./lib/contract.js";
import { toPatientRows } from "./lib/patients.js";
import { clinicianListFilters } from "./lib/sharing.js";

const $ = (id) => document.getElementById(id);

const LEVEL_WORDS = { green: "Green", amber: "Amber", red: "Red" };
const COPY = {
  loading: "Loading Patients…",
  empty: "No Patients yet. A Patient appears here once they choose to share their progress with you.",
  failed: "Could not load the Patient list. Reload the page to try again.",
  startFailed: "The dashboard could not start. Reload the page to try again.",
  noReasons: "—",
};

let stopPatients = null;

function show(id, visible) {
  $(id).hidden = !visible;
}

function renderPatients(rows) {
  const body = $("patients-body");
  body.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = row.displayName;
      const level = document.createElement("td");
      level.textContent = LEVEL_WORDS[row.flagLevel] ?? LEVEL_WORDS.green;
      const reasons = document.createElement("td");
      reasons.textContent = row.flagReasons.length ? row.flagReasons.join(" ") : COPY.noReasons;
      tr.append(name, level, reasons);
      return tr;
    }),
  );
  show("patients-table", rows.length > 0);
  $("patients-status").textContent = rows.length ? "" : COPY.empty;
}

function watchPatients(db, email) {
  $("patients-status").textContent = COPY.loading;
  // Only Patients who share (issue #29): the rules reject the query without the sharing filter.
  const patients = query(
    collection(db, COLLECTIONS.patients),
    ...clinicianListFilters(email).map(([field, op, value]) => where(field, op, value)),
  );
  return onSnapshot(
    patients,
    (snapshot) => renderPatients(toPatientRows(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })))),
    () => {
      show("patients-table", false);
      $("patients-status").textContent = COPY.failed;
    },
  );
}

function wireSignIn(auth) {
  const form = $("sign-in");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    $("sign-in-error").textContent = "";
    submit.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
      form.reset();
    } catch (error) {
      $("sign-in-error").textContent = signInErrorMessage(error);
    } finally {
      submit.disabled = false;
    }
  });
  $("sign-out").addEventListener("click", () => signOut(auth));
}

async function main() {
  let firebase;
  try {
    firebase = await initFirebase();
  } catch {
    $("starting").textContent = COPY.startFailed;
    return;
  }
  const { auth, db } = firebase;
  wireSignIn(auth);
  onAuthStateChanged(auth, (user) => {
    show("starting", false);
    stopPatients?.();
    stopPatients = null;
    const signedIn = Boolean(user?.email);
    show("sign-in", !signedIn);
    show("patients", signedIn);
    show("account", signedIn);
    $("account-email").textContent = signedIn ? user.email : "";
    if (signedIn) stopPatients = watchPatients(db, user.email);
  });
}

main();
