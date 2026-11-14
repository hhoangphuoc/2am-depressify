// Reseeds the Demo Patients: deletes every Patient marked synthetic and creates the three again,
// with history ending today. Targets the Firestore emulator unless --project names a real one.
//
//   npm run seed                                   # emulator, today in Europe/Helsinki
//   npm run seed -- --today 2026-11-14             # a fixed day, for a rehearsal
//   npm run seed -- --project my-real-project --clinician <email>
//                                                  # a real project (Application Default Credentials)
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { USAGE, parseCommand } from "./src/cli.js";
import { reseed } from "./src/firestore.js";
import { demoToday } from "./src/generate.js";

async function main() {
  const command = parseCommand(process.argv.slice(2), process.env);
  if (command.help) {
    console.log(USAGE);
    return;
  }
  if (command.emulatorHost) process.env.FIRESTORE_EMULATOR_HOST = command.emulatorHost;
  const nowMillis = Date.now();
  const today = command.today ?? demoToday(nowMillis);
  const where = command.emulatorHost ? `the emulator at ${command.emulatorHost}` : "the REAL project";
  console.log(`Seeding Demo Patients in ${command.projectId} (${where}), history ending ${today}.`);

  const app = initializeApp({ projectId: command.projectId });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: false });
  const result = await reseed(db, {
    today,
    nowMillis: command.today ? undefined : nowMillis,
    seed: command.seed,
    clinicianEmail: command.clinicianEmail,
  });
  console.log(`Deleted ${result.deleted.length} Demo Patient(s): ${result.deleted.join(", ") || "none"}.`);
  console.log(`Created ${result.created.join(", ")} (${result.documents} documents).`);
  console.log(`Allowed ${result.allowed} in clinicians.`);
  // The seed writes Firestore only; the Clinician's sign-in account gets its role separately (ADR 0010).
  const project = command.emulatorHost ? "" : ` --project ${command.projectId}`;
  console.log(`Once the Clinician's account exists, give it the Clinician role: npm run allow-clinician -- --email ${result.allowed}${project}`);
  await deleteApp(app);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
