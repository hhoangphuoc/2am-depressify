// Accounts in the Auth emulator as ADR 0010 has them. Emulator accounts start unverified, so the
// Admin SDK marks them verified (and gives a Clinician the `role: "clinician"` claim, as
// `npm run allow-clinician` does); the client then refreshes its ID token to carry both.
import type { App } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, type Auth, type User } from "firebase/auth";

// emulators:exec sets this; the Admin SDK's Auth needs it to stay off the real service.
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

export interface Account {
  email: string;
  password: string;
}

/** Signs `auth` in to the account, creating it if it is new. The email stays unverified. */
export async function signInAccount(auth: Auth, account: Account): Promise<User> {
  try {
    return (await createUserWithEmailAndPassword(auth, account.email, account.password)).user;
  } catch {
    return (await signInWithEmailAndPassword(auth, account.email, account.password)).user;
  }
}

/**
 * Signs `auth` in to the account, then marks its email verified with the Admin SDK (as opening the
 * verification link would) and sets `claims`, and refreshes the ID token so the next request
 * carries them.
 */
export async function signInVerified(adminApp: App, auth: Auth, account: Account, claims: Record<string, unknown> | null = null): Promise<User> {
  const user = await signInAccount(auth, account);
  const admin = getAdminAuth(adminApp);
  await admin.updateUser(user.uid, { emailVerified: true });
  await admin.setCustomUserClaims(user.uid, claims);
  await user.getIdToken(true);
  return user;
}

/** A Clinician's account as `npm run allow-clinician` leaves it: verified, with the claim. */
export function signInClinician(adminApp: App, auth: Auth, account: Account): Promise<User> {
  return signInVerified(adminApp, auth, account, { role: "clinician" });
}
