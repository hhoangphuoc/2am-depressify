// Clinician dashboard: email and password sign-in and a live Patient list sorted by Attention flag.
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { initFirebase } from "./firebase.js";
import { signInErrorMessage } from "./lib/auth.js";
import { COLLECTIONS } from "./lib/contract.js";
import { createPatientList } from "./list.js";

const $ = (id) => document.getElementById(id);

const COPY = {
  loading: "Loading Patients…",
  startFailed: "The dashboard could not start. Reload the page to try again.",
};

let stopPatients = null;

function show(id, visible) {
  $(id).hidden = !visible;
}

function watchPatients(db, email) {
  $("patients-status").textContent = COPY.loading;
  show("patients-table", false);
  const list = createPatientList(db, { body: $("patients-body"), table: $("patients-table"), status: $("patients-status") });
  const patients = query(collection(db, COLLECTIONS.patients), where("clinicianEmail", "==", email));
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
