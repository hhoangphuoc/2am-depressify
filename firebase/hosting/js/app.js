// Clinician dashboard: email and password sign-in and a live Patient list sorted by Attention flag.
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { initFirebase } from "./firebase.js";
import { intakeCalls } from "./functions.js";
import { signInErrorMessage } from "./lib/auth.js";
import { COLLECTIONS } from "./lib/contract.js";
import { clinicianListFilters } from "./lib/sharing.js";
import { parseRoute } from "./lib/route.js";
import { showPatient } from "./views/patient.js";
import { createPatientList } from "./list.js";

const $ = (id) => document.getElementById(id);

const COPY = {
  loading: "Loading Patients…",
  startFailed: "The dashboard could not start. Reload the page to try again.",
};

let stopPatients = null;
let stopPatient = null;

function show(id, visible) {
  $(id).hidden = !visible;
}

function watchPatients(db, email) {
  $("patients-status").textContent = COPY.loading;
  show("patients-table", false);
  const list = createPatientList(db, { body: $("patients-body"), table: $("patients-table"), status: $("patients-status") });
  // Only Patients who share (issue #29): the rules reject the query without the sharing filter.
  const patients = query(
    collection(db, COLLECTIONS.patients),
    ...clinicianListFilters(email).map(([field, op, value]) => where(field, op, value)),
  );
  const stop = onSnapshot(
    patients,
    (snapshot) => list.update(snapshot.docs.map((d) => ({ id: d.id, data: d.data() }))),
    () => list.fail(),
  );
  return () => {
    stop();
    list.stop();
  };
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

/** Shows the Patient list or one Patient's page, from the URL hash. */
function applyRoute(firebase, signedIn) {
  stopPatient?.();
  stopPatient = null;
  const route = signedIn ? parseRoute(window.location.hash) : { name: "list" };
  const onPatient = signedIn && route.name === "patient";
  show("patients", signedIn && !onPatient);
  show("patient", onPatient);
  if (onPatient) {
    stopPatient = showPatient({
      root: $("patient"),
      db: firebase.db,
      patientId: route.patientId,
      calls: intakeCalls(firebase.auth.app),
    });
  }
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
  window.addEventListener("hashchange", () => applyRoute(firebase, Boolean(auth.currentUser?.email)));
  onAuthStateChanged(auth, (user) => {
    show("starting", false);
    stopPatients?.();
    stopPatients = null;
    const signedIn = Boolean(user?.email);
    show("sign-in", !signedIn);
    show("account", signedIn);
    $("account-email").textContent = signedIn ? user.email : "";
    if (signedIn) stopPatients = watchPatients(db, user.email);
    applyRoute(firebase, signedIn);
  });
}

main();
