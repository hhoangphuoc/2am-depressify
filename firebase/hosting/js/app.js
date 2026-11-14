// Clinician dashboard: email and password sign-in and a live Patient list sorted by Attention flag,
// with the red banner, search and level filter, and alerts for new red flags.
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { createAlerts } from "./alerts.js";
import { initFirebase } from "./firebase.js";
import { digestCalls, intakeCalls } from "./functions.js";
import { clinicianAccessMessage, signInErrorMessage } from "./lib/auth.js";
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
/** @type {ReturnType<typeof createAlerts> | null} */
let alerts = null;

function show(id, visible) {
  $(id).hidden = !visible;
}

function watchPatients(db, email) {
  $("patients-status").textContent = COPY.loading;
  show("patients-table", false);
  const list = createPatientList(
    db,
    {
      body: $("patients-body"),
      table: $("patients-table"),
      status: $("patients-status"),
      banner: $("attention-banner"),
      controls: $("list-controls"),
      search: $("patient-search"),
      level: $("level-filter"),
      clearFilters: $("clear-filters"),
    },
    // The list keeps listening while a Patient page is open, so a new red flag alerts on any view.
    { onNewRed: (flags) => alerts?.notify(flags) },
  );
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

/**
 * Why this signed-in account may not use the dashboard, or null. Reads a fresh ID token, so a
 * claim the admin has just set counts after a reload as well as after signing in again.
 */
async function accessProblem(user) {
  try {
    return clinicianAccessMessage((await user.getIdTokenResult(true)).claims);
  } catch (error) {
    return signInErrorMessage(error);
  }
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
      calls: { ...intakeCalls(firebase.auth.app), ...digestCalls(firebase.auth.app) },
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
  alerts = createAlerts({ toggle: $("sound-toggle"), note: $("sound-note"), announcer: $("attention-announcer") });
  let clinician = false;
  window.addEventListener("hashchange", () => applyRoute(firebase, clinician));
  onAuthStateChanged(auth, async (user) => {
    stopPatients?.();
    stopPatients = null;
    clinician = false;
    if (user) {
      // Only a Clinician's account (ADR 0010); any other is signed out with the reason.
      const problem = await accessProblem(user);
      if (auth.currentUser !== user) return; // signed out or switched while the token was read
      if (problem) {
        $("sign-in-error").textContent = problem;
        await signOut(auth); // runs this again, signed out
        return;
      }
    }
    show("starting", false);
    const signedIn = Boolean(user?.email);
    clinician = signedIn;
    show("sign-in", !signedIn);
    show("account", signedIn);
    if (!signedIn) show("sound-note", false);
    $("account-email").textContent = signedIn ? user.email : "";
    if (signedIn) stopPatients = watchPatients(db, user.email);
    applyRoute(firebase, signedIn);
  });
}

main();
