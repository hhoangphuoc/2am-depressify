// Command-line parsing and the choice of target for seed.js. Pure, so it is unit tested.
import { parseArgs } from "node:util";
import { isDateKey } from "./dates.js";
import { DEFAULT_SEED, DEMO_CLINICIAN_EMAIL } from "./generate.js";

export const DEFAULT_PROJECT = "demo-twoam";
export const DEFAULT_EMULATOR_HOST = "127.0.0.1:8080";

export const USAGE = `Usage: npm run seed -- [--today yyyy-MM-dd] [--seed n] [--project id]

Deletes every Demo Patient (patients marked synthetic) and creates the three again.

Target:
  default           the Firestore emulator at $FIRESTORE_EMULATOR_HOST, or ${DEFAULT_EMULATOR_HOST},
                    project $GCLOUD_PROJECT or ${DEFAULT_PROJECT}
  --project <id>    a real Firebase project, with Application Default Credentials. Leave
                    FIRESTORE_EMULATOR_HOST unset; if it is set, the emulator is used instead.

Options:
  --today <date>    the last day of history (default: today in Europe/Helsinki)
  --seed <n>        pseudo-random seed (default: ${DEFAULT_SEED})
  CLINICIAN_EMAIL   environment variable; default ${DEMO_CLINICIAN_EMAIL}`;

/**
 * @typedef {object} SeedCommand
 * @property {boolean} help
 * @property {string} projectId
 * @property {string | null} emulatorHost null for a real project
 * @property {string | undefined} today
 * @property {number} seed
 * @property {string} clinicianEmail
 */

/**
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @returns {SeedCommand}
 */
export function parseCommand(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      today: { type: "string" },
      seed: { type: "string" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.today !== undefined && !isDateKey(values.today)) {
    throw new Error(`--today must be a yyyy-MM-dd date, got "${values.today}"`);
  }
  const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed);
  if (!Number.isSafeInteger(seed)) throw new Error(`--seed must be an integer, got "${values.seed}"`);

  const emulatorFromEnv = env.FIRESTORE_EMULATOR_HOST || null;
  /** @type {string} */
  let projectId;
  /** @type {string | null} */
  let emulatorHost;
  if (values.project !== undefined) {
    projectId = values.project;
    emulatorHost = emulatorFromEnv;
    if (!emulatorHost && projectId.startsWith("demo-")) {
      throw new Error(`"${projectId}" is an emulator-only demo project; start the emulators or drop --project`);
    }
  } else {
    projectId = env.GCLOUD_PROJECT || DEFAULT_PROJECT;
    emulatorHost = emulatorFromEnv ?? DEFAULT_EMULATOR_HOST;
  }
  return {
    help: values.help ?? false,
    projectId,
    emulatorHost,
    today: values.today,
    seed,
    clinicianEmail: env.CLINICIAN_EMAIL || DEMO_CLINICIAN_EMAIL,
  };
}
