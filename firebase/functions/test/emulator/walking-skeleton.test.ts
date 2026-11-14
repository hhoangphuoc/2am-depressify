// End-to-end walking skeleton against the Auth and Firestore emulators, with the real Firebase JS
// SDK standing in for both clients: an anonymous Patient creates their record the way the app does,
// and the Clinician's live list (the dashboard's query) receives it without reloading.
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInErrorMessage } from "../../../hosting/js/lib/auth.js";
import { toPatientRows } from "../../../hosting/js/lib/patients.js";
import { newPatientDoc } from "../../src/types";

const PROJECT_ID = "demo-twoam";
const HOST = "127.0.0.1";
const CLINICIAN = { email: "clinician@example.com", password: "demo-password-1" };
const apps: FirebaseApp[] = [];

function client(name: string) {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key" }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, HOST, 8080);
  return { auth, db };
}

beforeAll(async () => {
  // Fresh emulator state for this project.
  await fetch(`http://${HOST}:9099/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  await fetch(`http://${HOST}:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const setup = client("setup");
  await createUserWithEmailAndPassword(setup.auth, CLINICIAN.email, CLINICIAN.password);
});

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

describe("walking skeleton", () => {
  it("a new Patient appears on the Clinician's live list without reloading", async () => {
    const dashboard = client("dashboard");
    await signInWithEmailAndPassword(dashboard.auth, CLINICIAN.email, CLINICIAN.password);

    const snapshots: string[][] = [];
    const appeared = new Promise<string[]>((resolve, reject) => {
      const stop = onSnapshot(
        query(collection(dashboard.db, "patients"), where("clinicianEmail", "==", CLINICIAN.email)),
        (snap) => {
          const names = toPatientRows(snap.docs.map((d) => ({ id: d.id, data: d.data() }))).map((r) => r.displayName);
          snapshots.push(names);
          if (names.includes("Live patient")) {
            stop();
            resolve(names);
          }
        },
        reject,
      );
    });

    // The Patient app: anonymous sign-in, then its own record linked to the demo Clinician.
    const phone = client("phone");
    const { user } = await signInAnonymously(phone.auth);
    await setDoc(doc(phone.db, "patients", user.uid), newPatientDoc("Live patient", CLINICIAN.email));

    expect(await appeared).toEqual(["Live patient"]);
    expect(snapshots[0]).toEqual([]); // the list was live before the Patient existed
  });

  it("wrong password and unknown account show the same message", async () => {
    const dashboard = client("wrong-credentials");
    const codeOf = async (email: string, password: string) => {
      try {
        await signInWithEmailAndPassword(dashboard.auth, email, password);
        return "signed-in";
      } catch (error) {
        return error as { code: string };
      }
    };
    const wrongPassword = await codeOf(CLINICIAN.email, "not-the-password");
    const unknownAccount = await codeOf("nobody@example.com", "whatever-123");

    expect(wrongPassword).not.toBe("signed-in");
    expect(unknownAccount).not.toBe("signed-in");
    expect(signInErrorMessage(wrongPassword as { code: string })).toBe(signInErrorMessage(unknownAccount as { code: string }));
  });
});
