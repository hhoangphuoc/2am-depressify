// Firebase initialisation for the dashboard. Served locally (localhost), it talks to the emulators
// of the demo project `demo-twoam`, which need no credentials. Deployed on Firebase Hosting, it reads
// the project's web config from the reserved URL /__/firebase/init.json, so no config is committed.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { connectAuthEmulator, getAuth } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { connectFirestoreEmulator, getFirestore } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { emulatorHostFor } from "./lib/auth.js";

const EMULATOR_CONFIG = {
  projectId: "demo-twoam",
  apiKey: "demo-api-key",
  authDomain: "demo-twoam.firebaseapp.com",
  appId: "1:000000000000:web:0000000000000000",
};

async function loadConfig(emulatorHost) {
  if (emulatorHost) return EMULATOR_CONFIG;
  const response = await fetch("/__/firebase/init.json");
  if (!response.ok) throw new Error("Firebase config unavailable");
  return response.json();
}

/** @returns {Promise<{ auth: import("firebase/auth").Auth, db: import("firebase/firestore").Firestore }>} */
export async function initFirebase() {
  const emulatorHost = emulatorHostFor(window.location.hostname);
  const app = initializeApp(await loadConfig(emulatorHost));
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (emulatorHost) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorHost, 8080);
  }
  return { auth, db };
}
