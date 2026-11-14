// The silence test for the demo (#28, #31): sets one live Patient's last sign of life to 25 hours
// ago, so the next hourly silence check raises a red "silent" flag and `redFlagAlert` emails the
// Clinician. Targets the Firestore emulator unless --project names a real one.
//
//   npm run silence-test -- --patient <id>                       # emulator
//   npm run silence-test -- --patient <id> --project <project-id> # a real project (Application Default Credentials)
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SILENCE_USAGE, parseSilenceCommand } from "./src/cli.js";
import { SILENCE_TEST_HOURS, runSilenceCheckCommand, startSilenceTest } from "./src/silence-test.js";

async function main() {
  const command = parseSilenceCommand(process.argv.slice(2), process.env);
  if (command.help) {
    console.log(SILENCE_USAGE);
    return;
  }
  if (command.emulatorHost) process.env.FIRESTORE_EMULATOR_HOST = command.emulatorHost;
  const where = command.emulatorHost ? `the emulator at ${command.emulatorHost}` : "the REAL project";
  const app = initializeApp({ projectId: command.projectId });
  try {
    const { lastSeenAtMillis } = await startSilenceTest(getFirestore(app), command.patientId, Date.now());
    console.log(
      `Set the last sign of life of Patient ${command.patientId} in ${command.projectId} (${where}) to ` +
        `${new Date(lastSeenAtMillis).toISOString()}, ${SILENCE_TEST_HOURS} hours ago.`,
    );
    console.log("The next hourly silence check raises a red \"silent\" flag, and the Clinician is emailed.");
    if (command.emulatorHost) {
      console.log("Scheduled functions do not run in the emulator; the emulator tests run the check's handler instead.");
    } else {
      console.log("To run the check now instead of at the top of the hour:");
      console.log(`  ${runSilenceCheckCommand(command.projectId)}`);
    }
    console.log("The phone writes a new sign of life when its daily job runs, which ends the silence: run the check before that.");
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
