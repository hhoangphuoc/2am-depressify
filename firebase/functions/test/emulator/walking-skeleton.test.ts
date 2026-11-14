// End-to-end walking skeleton against the Auth and Firestore emulators, with the real Firebase JS
// SDK standing in for both clients: an anonymous Patient creates their record the way the app does,
// chooses to share, and the Clinician's live list (the dashboard's query) receives it without
// reloading. Withdrawing sharing removes the Patient from the list and from an open Patient view.
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
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
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInErrorMessage } from "../../../hosting/js/lib/auth.js";
import { toPatientRows } from "../../../hosting/js/lib/patients.js";
import { clinicianListFilters, sharingStateFromError, sharingStateFromSnapshot } from "../../../hosting/js/lib/sharing.js";
import { newPatientDoc } from "../../src/types";

const PROJECT_ID = "demo-twoam";
const HOST = "127.0.0.1";
const CLINICIAN = { email: "clinician@example.com", password: "demo-password-1" };
const apps: FirebaseApp[] = [];
const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "skeleton-admin");

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
  // The Clinician is on the allowlist, as `npm run allow-clinician` (or the seed) puts them there.
  await getAdminFirestore(adminApp).doc(`clinicians/${CLINICIAN.email}`).set({ email: CLINICIAN.email });
});

/** The dashboard's Patient list query. */
const patientList = (db: Firestore) =>
  query(collection(db, "patients"), ...clinicianListFilters(CLINICIAN.email).map(([field, op, value]) => where(field, op, value)));

/** The Patient app's sharing choice: the record and `consents/sharing` in one write. */
async function chooseSharing(db: Firestore, patientId: string, choice: "granted" | "declined") {
  const atMillis = Date.now();
  const batch = writeBatch(db);
  batch.update(doc(db, "patients", patientId), { sharingConsent: choice, sharingChangedAtMillis: atMillis });
  batch.set(doc(db, "patients", patientId, "consents", "sharing"), {
    subject: "sharing",
    granted: choice === "granted",
    changedAtMillis: atMillis,
  });
  await batch.commit();
}

/** Resolves with the list's display names the first time `done` holds for them. */
function listUntil(db: Firestore, done: (names: string[]) => boolean, seen: string[][] = []) {
  return new Promise<string[]>((resolve, reject) => {
    const stop = onSnapshot(
      patientList(db),
      (snap) => {
        const names = toPatientRows(snap.docs.map((d) => ({ id: d.id, data: d.data() }))).map((r) => r.displayName);
        seen.push(names);
        if (done(names)) {
          stop();
          resolve(names);
        }
      },
      reject,
    );
  });
}

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
  await deleteAdminApp(adminApp);
});

describe("walking skeleton", () => {
  it("a new Patient appears on the Clinician's live list without reloading, once they choose to share", async () => {
    const dashboard = client("dashboard");
    await signInWithEmailAndPassword(dashboard.auth, CLINICIAN.email, CLINICIAN.password);

    const snapshots: string[][] = [];
    const appeared = listUntil(dashboard.db, (names) => names.includes("Live patient"), snapshots);

    // The Patient app: anonymous sign-in, then its own record linked to the allowlisted Clinician. The
    // record starts undecided, so the Clinician does not see it yet.
    const phone = client("phone");
    const { user } = await signInAnonymously(phone.auth);
    await setDoc(doc(phone.db, "patients", user.uid), newPatientDoc("Live patient", CLINICIAN.email));
    await chooseSharing(phone.db, user.uid, "granted");

    expect(await appeared).toEqual(["Live patient"]);
    expect(snapshots[0]).toEqual([]); // the list was live before the Patient shared
    expect(snapshots.every((names) => names.length <= 1)).toBe(true);
  });

  it("withdrawing hides the Patient from the open list and an open Patient view at once; sharing again brings them back", async () => {
    const dashboard = client("dashboard-withdraw");
    await signInWithEmailAndPassword(dashboard.auth, CLINICIAN.email, CLINICIAN.password);
    const phone = client("phone-withdraw");
    const { user } = await signInAnonymously(phone.auth);
    await setDoc(doc(phone.db, "patients", user.uid), newPatientDoc("Withdrawing patient", CLINICIAN.email));
    await chooseSharing(phone.db, user.uid, "granted");

    // An open tab: the list and the Patient view are both live.
    await listUntil(dashboard.db, (names) => names.includes("Withdrawing patient"));
    const viewStates: string[] = [];
    const viewWithdrawn = new Promise<void>((resolve) => {
      onSnapshot(
        doc(dashboard.db, "patients", user.uid),
        (snap) => viewStates.push(sharingStateFromSnapshot({ exists: snap.exists(), data: snap.data() }).status),
        (error) => {
          viewStates.push(sharingStateFromError(error).status);
          resolve();
        },
      );
    });
    const leftList = listUntil(dashboard.db, (names) => !names.includes("Withdrawing patient"));
    await expect.poll(() => viewStates).toContain("ok");

    await chooseSharing(phone.db, user.uid, "declined");

    await leftList;
    await viewWithdrawn;
    expect(viewStates.at(-1)).toBe("withdrawn");
    expect(viewStates).not.toContain("error");

    await chooseSharing(phone.db, user.uid, "granted");
    expect(await listUntil(dashboard.db, (names) => names.includes("Withdrawing patient"))).toContain("Withdrawing patient");
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
