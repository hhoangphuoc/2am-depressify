// Adds a Clinician to the clinicians allowlist (clinicians/{email}), so the security rules let a
// new Patient's app link to them. Targets the Firestore emulator unless --project names a real one.
//
//   npm run allow-clinician -- --email <email>                       # emulator
//   npm run allow-clinician -- --email <email> --project <project-id> # a real project (Application Default Credentials)
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { ALLOW_USAGE, parseAllowCommand } from "./src/cli.js";
import { allowClinician } from "./src/firestore.js";

async function main() {
  const command = parseAllowCommand(process.argv.slice(2), process.env);
  if (command.help) {
    console.log(ALLOW_USAGE);
    return;
  }
  if (command.emulatorHost) process.env.FIRESTORE_EMULATOR_HOST = command.emulatorHost;
  const where = command.emulatorHost ? `the emulator at ${command.emulatorHost}` : "the REAL project";
  const app = initializeApp({ projectId: command.projectId });
  await allowClinician(getFirestore(app), command.email);
  console.log(`Allowed ${command.email} in clinicians of ${command.projectId} (${where}).`);
  await deleteApp(app);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
