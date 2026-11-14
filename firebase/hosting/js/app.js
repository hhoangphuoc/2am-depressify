// Clinician dashboard, laid out as the design prototype (design/clinician): a sidebar workspace with
// the Patient list (sorted by Attention flag, with the red banner, search, filters and the sound
// switch) and each Patient's page. Email and password sign-in; alerts for new red flags on any view.
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { createAlerts } from "./alerts.js";
import { designData } from "./data/design-data.js";
import { initFirebase } from "./firebase.js";
import { digestCalls, intakeCalls } from "./functions.js";
import { emulatorHostFor, signInErrorMessage } from "./lib/auth.js";
import { initialsOf } from "./lib/design-model.js";
import { workspaceMeta } from "./lib/design-view.js";
import { parseRoute } from "./lib/route.js";
import { createPatientList } from "./list.js";
import { showPatient } from "./views/patient.js";

const $ = (id) => document.getElementById(id);

const COPY = {
  startFailed: "The dashboard could not start. Reload the page to try again.",
  signingIn: "Signing in…",
  signIn: "Sign in",
};

let stopPatients = null;
let stopPatient = null;
/** @type {ReturnType<typeof createAlerts> | null} */
let alerts = null;

function show(id, visible) {
  $(id).hidden = !visible;
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The date and time line above every page, refreshed every minute. */
function startClock() {
  const draw = () => {
    const meta = workspaceMeta(Date.now(), timeZone());
    $("meta-date").textContent = meta.date;
    $("meta-time").textContent = meta.time;
  };
  draw();
  setInterval(draw, 60_000);
}

function watchPatients(data, email) {
  return createPatientList(
    data,
    {
      body: $("patients-body"),
      tableWrap: $("patients-table-wrap"),
      status: $("patients-status"),
      state: $("patients-state"),
      banner: $("attention-banner"),
      controls: $("list-controls"),
      search: $("patient-search"),
      filters: $("level-filter"),
      freshness: $("freshness"),
      offline: $("offline-notice"),
      navCount: $("nav-count"),
    },
    {
      clinicianEmail: email,
      timeZone: timeZone(),
      // The list keeps listening while a Patient page is open, so a new red flag alerts on any view.
      onNewRed: (flags) => alerts?.notify(flags),
    },
  );
}

function wireSignIn(auth) {
  const form = $("sign-in");
  const error = $("sign-in-error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    error.textContent = "";
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = COPY.signingIn;
    form.setAttribute("aria-busy", "true");
    try {
      await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
      form.reset();
    } catch (e) {
      error.textContent = signInErrorMessage(e);
      error.hidden = false;
      for (const input of form.querySelectorAll("input")) input.setAttribute("aria-invalid", "true");
    } finally {
      submit.disabled = false;
      submit.textContent = COPY.signIn;
      form.removeAttribute("aria-busy");
    }
  });
  for (const input of form.querySelectorAll("input")) {
    input.addEventListener("input", () => {
      for (const i of form.querySelectorAll("input")) i.removeAttribute("aria-invalid");
      error.hidden = true;
    });
  }
  $("sign-out").addEventListener("click", () => signOut(auth));
}

/** Shows the Patient list or one Patient's page, from the URL hash. */
function applyRoute(firebase, data, signedIn) {
  stopPatient?.();
  stopPatient = null;
  const route = signedIn ? parseRoute(window.location.hash) : { name: "list" };
  const onPatient = signedIn && route.name === "patient";
  show("patients", signedIn && !onPatient);
  show("patient", onPatient);
  document.title = "Depressify · Clinician workspace";
  if (onPatient) {
    stopPatient = showPatient({
      root: $("patient"),
      db: firebase.db,
      data,
      patientId: route.patientId,
      calls: { ...intakeCalls(firebase.auth.app), ...digestCalls(firebase.auth.app) },
    });
  } else if (signedIn) {
    window.scrollTo(0, 0);
    $("patients-heading").focus({ preventScroll: true });
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
  const data = designData({ db, app: auth.app });
  show("env-disclosure", Boolean(emulatorHostFor(window.location.hostname)));
  wireSignIn(auth);
  startClock();
  alerts = createAlerts({ toggle: $("sound-toggle"), note: $("sound-note"), announcer: $("attention-announcer") });
  window.addEventListener("hashchange", () => applyRoute(firebase, data, Boolean(auth.currentUser?.email)));
  onAuthStateChanged(auth, (user) => {
    show("starting", false);
    stopPatients?.();
    stopPatients = null;
    const signedIn = Boolean(user?.email);
    show("signin-view", !signedIn);
    show("workspace", signedIn);
    if (!signedIn) show("sound-note", false);
    $("account-email").textContent = signedIn ? user.email : "";
    $("account-avatar").textContent = signedIn ? initialsOf(String(user.email).split("@")[0].replace(/[._-]+/g, " ")) : "";
    if (signedIn) stopPatients = watchPatients(data, user.email);
    applyRoute(firebase, data, signedIn);
  });
}

main();
