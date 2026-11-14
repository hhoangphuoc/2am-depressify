// Allows a Clinician (ADR 0010): adds their email to the clinicians allowlist (clinicians/{email}),
// so a new Patient's app may link to them, and gives their Auth account the custom claim
// `role: "clinician"` with the email marked verified, so the rules and functions treat it as the
// Clinician's. Targets the emulators unless --project names a real project.
//
//   npm run allow-clinician -- --email <email>                       # emulator
//   npm run allow-clinician -- --email <email> --project <project-id> # a real project (Application Default Credentials)
//   ... --uid <uid>   # needed when the account's email is not verified yet: the account you added
//
// The Clinician signs out and in again (or reloads the dashboard) to pick up the claim.
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { grantClinicianRole } from "./src/auth.js";
import { ALLOW_USAGE, parseAllowCommand } from "./src/cli.js";
import { allowClinician } from "./src/firestore.js";

async function main() {
  const command = parseAllowCommand(process.argv.slice(2), process.env);
  if (command.help) {
    console.log(ALLOW_USAGE);
    return;
  }
  if (command.emulatorHost) {
    process.env.FIRESTORE_EMULATOR_HOST = command.emulatorHost;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = /** @type {string} */ (command.authEmulatorHost);
  } else {
    // A real project: never send its Auth changes to an emulator, or the other way round.
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  }
  const where = command.emulatorHost ? `the emulators at ${command.emulatorHost} and ${command.authEmulatorHost}` : "the REAL project";
  const app = initializeApp({ projectId: command.projectId });
  try {
    const account = await grantClinicianRole(getAuth(app), command.email, command.uid);
    await allowClinician(getFirestore(app), command.email);
    console.log(`Allowed ${command.email} in clinicians of ${command.projectId} (${where}).`);
    if (account) {
      console.log(
        `Gave the account ${account.uid} the Clinician role and marked its email verified. ` +
          `The Clinician signs out and in again, or reloads the dashboard, to pick it up.`,
      );
    } else {
      console.warn(
        `No sign-in account has the email ${command.email} yet, so it has no Clinician role. ` +
          `Add the user (Authentication → Users → Add user), then run this command again with --uid <its User UID>.`,
      );
    }
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
