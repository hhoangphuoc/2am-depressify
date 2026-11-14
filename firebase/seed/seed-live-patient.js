// Gives one real test account (the live demo Patient) six weeks of invented history, so the
// Companion and "what seems to help" have context. Targets the Auth and Firestore emulators unless
// --project names a real project.
//
//   npm run seed-live-patient -- --email <patient email>                    # emulators
//   npm run seed-live-patient -- --email <patient email> --reset            # delete and recreate the mock history
//   npm run seed-live-patient -- --email <patient email> --clinician <clinician email> --project <project-id>
//                                                                           # a real project (Application Default Credentials)
//
// Prints ids and counts only. The Patient's email appears once, masked.
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { LIVE_PATIENT_USAGE, parseLivePatientCommand } from "./src/cli.js";
import { demoToday } from "./src/generate.js";
import { allowlistState, ensurePatientUser, makeLivePatient, maskEmail, refuseRedFlags, seedLivePatient } from "./src/live-patient.js";

const DAY_MILLIS = 86_400_000;

/** @param {Record<string, number>} counts */
const countsText = (counts) =>
  Object.entries(counts)
    .map(([name, n]) => `${name} ${n}`)
    .join(", ");

async function main() {
  const command = parseLivePatientCommand(process.argv.slice(2), process.env);
  if (command.help) {
    console.log(LIVE_PATIENT_USAGE);
    return;
  }
  if (command.emulatorHost) process.env.FIRESTORE_EMULATOR_HOST = command.emulatorHost;
  if (command.authEmulatorHost) process.env.FIREBASE_AUTH_EMULATOR_HOST = command.authEmulatorHost;
  const nowMillis = Date.now();
  const today = command.today ?? demoToday(nowMillis);
  const where = command.emulatorHost
    ? `the emulators at ${command.emulatorHost} and ${command.authEmulatorHost}`
    : "the REAL project";
  console.log(`Seeding the live demo Patient in ${command.projectId} (${where}), history ending ${today}.`);
  console.log(`Looking up the Patient's account ${maskEmail(command.email)}.`);

  const app = initializeApp({ projectId: command.projectId });
  try {
    const db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: false });
    const allow = await allowlistState(db, command.email, command.clinicianEmail);
    if (allow.patientIsClinician) {
      throw new Error("The Patient's email is on the clinicians allowlist; a Clinician's account is never made a Patient.");
    }
    if (!allow.clinicianAllowed) {
      console.warn(
        "Warning: the Clinician given is not on the clinicians allowlist. The dashboard still lists this " +
          "Patient for them, but add them with `npm run allow-clinician -- --email <clinician email>` (same --project).",
      );
    }

    /** @param {string} patientId */
    const generate = (patientId) =>
      makeLivePatient({
        patientId,
        clinicianEmail: command.clinicianEmail,
        today,
        nowMillis: command.today ? undefined : nowMillis,
        seed: command.seed,
        displayName: command.displayName,
      });
    // A real, sharing Patient last seen over a day ago is flagged red by the hourly silence check,
    // which emails the Clinician. Only a past --today can do that; refuse it outside the emulator.
    const preview = generate("preview");
    refuseRedFlags(preview);
    if (!command.emulatorHost && (preview.patient.lastSeenAtMillis ?? 0) < nowMillis - DAY_MILLIS) {
      throw new Error("--today is more than a day in the past: the silence check would flag this real Patient red. Leave --today out.");
    }

    const user = await ensurePatientUser(getAuth(app), command.email, command.displayName);
    if (user.created) console.log(`Created the account: uid ${user.uid} (email verified, no password).`);
    else {
      const notes = [user.verifiedNow && "marked its email verified", user.renamed && "set its display name"].filter(Boolean);
      console.log(`Found the account: uid ${user.uid}${notes.length ? ` (${notes.join(", ")})` : ""}.`);
    }

    const result = await seedLivePatient(db, generate(user.uid), { reset: command.reset });
    if (command.reset) console.log(`Deleted mock history: ${countsText(result.deleted)}.`);
    console.log(`Wrote patients/${user.uid} and ${countsText(result.written)}.`);
    if (result.keptDaily > 0) console.log(`Kept ${result.keptDaily} daily record(s) the app wrote.`);
    if (result.appFlags + result.appCheckIns > 0) {
      console.log(`Left alone: ${result.appFlags} flag(s) and ${result.appCheckIns} Check-in(s) the app wrote.`);
    }
    console.log(`Attention: ${result.flagLevel}; open mock flags: ${result.openFlagIds.join(", ") || "none"}.`);
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
