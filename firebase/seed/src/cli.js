// Command-line parsing and the choice of target for seed.js and allow-clinician.js. Pure, so it is
// unit tested.
import { parseArgs } from "node:util";
import { isDateKey } from "./dates.js";
import { DEFAULT_SEED, DEMO_CLINICIAN_EMAIL } from "./generate.js";
import { LIVE_DEFAULT_DISPLAY_NAME } from "./live-patient.js";

export const DEFAULT_PROJECT = "demo-twoam";
export const DEFAULT_EMULATOR_HOST = "127.0.0.1:8080";
export const DEFAULT_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const TARGET_HELP = `Target:
  default           the Firestore emulator at $FIRESTORE_EMULATOR_HOST, or ${DEFAULT_EMULATOR_HOST},
                    project $GCLOUD_PROJECT or ${DEFAULT_PROJECT}
  --project <id>    a real Firebase project ID (not a .firebaserc alias), with Application Default
                    Credentials. Leave FIRESTORE_EMULATOR_HOST unset; if it is set, the emulator is
                    used instead.`;

export const USAGE = `Usage: npm run seed -- [--clinician email] [--today yyyy-MM-dd] [--seed n] [--project id]

Deletes every Demo Patient (patients marked synthetic) and creates the three again, linked to the
Clinician, and adds that Clinician to the clinicians allowlist.

${TARGET_HELP}

Options:
  --clinician <email>  the Clinician the Demo Patients are linked to. Also the environment variable
                       CLINICIAN_EMAIL; the option wins. Required for a real project; the emulator
                       defaults to the placeholder ${DEMO_CLINICIAN_EMAIL}.
  --today <date>       the last day of history (default: today in Europe/Helsinki)
  --seed <n>           pseudo-random seed (default: ${DEFAULT_SEED})`;

export const ALLOW_USAGE = `Usage: npm run allow-clinician -- --email <email> [--project id]

Adds a Clinician to the clinicians allowlist (clinicians/{email}), so a new Patient's app may link
to them. Writing it again changes nothing.

${TARGET_HELP}`;

export const SILENCE_USAGE = `Usage: npm run silence-test -- --patient <id> [--project id]

The silence test for the demo: sets one live Patient's last sign of life (lastSeenAtMillis) to 25
hours ago, so the next hourly silence check raises a red "silent" flag and the Clinician is emailed.
Writes nothing else. Refuses a Demo Patient (synthetic Patients are never silent) and a Patient who
is not sharing. The Patient id is the phone's auth uid, also in the dashboard's address bar
(#/patient/<id>). Prints the command that runs the deployed check once now.

${TARGET_HELP}`;

export const LIVE_PATIENT_USAGE = `Usage: npm run seed-live-patient -- --email <patient email> [--clinician email]
         [--display-name name] [--today yyyy-MM-dd] [--seed n] [--reset] [--project id]

Gives one real test account six weeks of invented history, so the Companion and "what seems to
help" have context: Daily Signals with a drift in the last days, Check-ins with Summaries,
Suggestions with Outcomes (the latest still open), an amber flag, Visits and Consents. The record is
not synthetic (only the account and its Clinician can read it) and its health source says
"synthetic". Finds the account by email, or creates it with a verified email and no password.

${TARGET_HELP} The Auth emulator is used with the Firestore emulator
                    ($FIREBASE_AUTH_EMULATOR_HOST, or ${DEFAULT_AUTH_EMULATOR_HOST}).

Options:
  --email <email>        the Patient's account (required). Printed only masked.
  --clinician <email>    the Clinician, who should be on the clinicians allowlist (a warning if
                         not). Also CLINICIAN_EMAIL. Required for a real project; the emulator
                         defaults to ${DEMO_CLINICIAN_EMAIL}.
  --display-name <name>  default: ${LIVE_DEFAULT_DISPLAY_NAME}
  --today <date>         the last day of history (default: today in Europe/Helsinki)
  --seed <n>             pseudo-random seed (default: ${DEFAULT_SEED})
  --reset                delete this Patient's mock history and write it again. Without it, the
                         command refuses a Patient who already has mock history. What the app
                         wrote is never deleted.`;

/**
 * Where to write: a project and, unless it is a real project, the emulator host.
 * @typedef {object} Target
 * @property {string} projectId
 * @property {string | null} emulatorHost null for a real project
 */

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
 * @typedef {object} AllowCommand
 * @property {boolean} help
 * @property {string} projectId
 * @property {string | null} emulatorHost null for a real project
 * @property {string} email
 */

/**
 * @typedef {object} LivePatientCommand
 * @property {boolean} help
 * @property {string} projectId
 * @property {string | null} emulatorHost null for a real project
 * @property {string | null} authEmulatorHost null for a real project
 * @property {string} email the Patient's
 * @property {string} clinicianEmail
 * @property {string} displayName
 * @property {string | undefined} today
 * @property {number} seed
 * @property {boolean} reset
 */

/**
 * @typedef {object} SilenceCommand
 * @property {boolean} help
 * @property {string} projectId
 * @property {string | null} emulatorHost null for a real project
 * @property {string} patientId
 */

/**
 * The emulator by default; a real project only with --project and no emulator running. A demo-
 * project exists only in the emulator, so it is refused outside it.
 * @param {string | undefined} project the --project value
 * @param {Record<string, string | undefined>} env
 * @returns {Target}
 */
export function resolveTarget(project, env) {
  const emulatorFromEnv = env.FIRESTORE_EMULATOR_HOST || null;
  if (project === undefined) {
    return { projectId: env.GCLOUD_PROJECT || DEFAULT_PROJECT, emulatorHost: emulatorFromEnv ?? DEFAULT_EMULATOR_HOST };
  }
  if (!emulatorFromEnv && project.startsWith("demo-")) {
    throw new Error(`"${project}" is an emulator-only demo project; start the emulators or drop --project`);
  }
  return { projectId: project, emulatorHost: emulatorFromEnv };
}

const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

/**
 * A Clinician's email as the allowlist and the Patient record store it: trimmed and in lower case,
 * as Firebase Auth puts it in the sign-in token. The placeholder is refused outside the emulator.
 * @param {string} raw
 * @param {string} source where the value came from, for the error message
 * @param {Target} target
 * @returns {string}
 */
export function clinicianEmail(raw, source, target) {
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error(`${source} must be an email address, got "${raw}"`);
  if (!target.emulatorHost && email === DEMO_CLINICIAN_EMAIL) {
    throw new Error(
      `${DEMO_CLINICIAN_EMAIL} is the emulator placeholder, not a real Clinician. ` +
        `Give the real Clinician's email for project "${target.projectId}".`,
    );
  }
  return email;
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @returns {SeedCommand}
 */
export function parseCommand(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      clinician: { type: "string" },
      today: { type: "string" },
      seed: { type: "string" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  const today = todayOption(values.today);
  const seed = seedOption(values.seed);
  const target = resolveTarget(values.project, env);
  // Unused with --help, which prints the usage and exits.
  const email = values.help ? DEMO_CLINICIAN_EMAIL : seedClinician(values.clinician, env, target);
  return { help: values.help ?? false, ...target, today, seed, clinicianEmail: email };
}

/** @param {string | undefined} value */
function todayOption(value) {
  if (value !== undefined && !isDateKey(value)) throw new Error(`--today must be a yyyy-MM-dd date, got "${value}"`);
  return value;
}

/** @param {string | undefined} value */
function seedOption(value) {
  const seed = value === undefined ? DEFAULT_SEED : Number(value);
  if (!Number.isSafeInteger(seed)) throw new Error(`--seed must be an integer, got "${value}"`);
  return seed;
}

/**
 * The Clinician to seed for: --clinician, else CLINICIAN_EMAIL, else (emulator only) the placeholder.
 * @param {string | undefined} option
 * @param {Record<string, string | undefined>} env
 * @param {Target} target
 */
function seedClinician(option, env, target) {
  if (option !== undefined) return clinicianEmail(option, "--clinician", target);
  if (env.CLINICIAN_EMAIL) return clinicianEmail(env.CLINICIAN_EMAIL, "CLINICIAN_EMAIL", target);
  if (target.emulatorHost) return DEMO_CLINICIAN_EMAIL;
  throw new Error(
    `Seeding the real project "${target.projectId}" needs the Clinician's email: ` +
      `pass --clinician <email> or set CLINICIAN_EMAIL. The placeholder ${DEMO_CLINICIAN_EMAIL} is for the emulator only.`,
  );
}

/**
 * The Auth emulator goes with the Firestore emulator; a real project uses real Auth. A mix is
 * refused: it would create the account in one place and its data in another.
 * @param {Target} target
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
function authTarget(target, env) {
  const fromEnv = env.FIREBASE_AUTH_EMULATOR_HOST || null;
  if (target.emulatorHost) return fromEnv ?? DEFAULT_AUTH_EMULATOR_HOST;
  if (fromEnv) {
    throw new Error(
      `FIREBASE_AUTH_EMULATOR_HOST is set, but Firestore targets the real project "${target.projectId}". ` +
        "Unset it to use real Auth, or start the Firestore emulator too: the Auth emulator and a real project are never mixed.",
    );
  }
  return null;
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @returns {LivePatientCommand}
 */
export function parseLivePatientCommand(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      email: { type: "string" },
      clinician: { type: "string" },
      "display-name": { type: "string" },
      today: { type: "string" },
      seed: { type: "string" },
      reset: { type: "boolean" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  const today = todayOption(values.today);
  const seed = seedOption(values.seed);
  const target = resolveTarget(values.project, env);
  const authEmulatorHost = authTarget(target, env);
  const displayName = (values["display-name"] ?? LIVE_DEFAULT_DISPLAY_NAME).trim();
  if (displayName === "" || displayName.length > 100) throw new Error("--display-name must be a name of 1 to 100 characters");
  const common = { ...target, authEmulatorHost, displayName, today, seed, reset: values.reset ?? false };
  if (values.help) return { help: true, ...common, email: "", clinicianEmail: DEMO_CLINICIAN_EMAIL };

  if (values.email === undefined) throw new Error("--email <patient email> is required: the Patient's account");
  // Never echo the Patient's email: the output of this command may be shared.
  const email = values.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("--email must be an email address");
  const clinician = seedClinician(values.clinician, env, target);
  if (email === clinician) throw new Error("--email must not be the Clinician's email: the Patient and the Clinician are different accounts");
  return { help: false, ...common, email, clinicianEmail: clinician };
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @returns {AllowCommand}
 */
export function parseAllowCommand(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      email: { type: "string" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  const help = values.help ?? false;
  const target = resolveTarget(values.project, env);
  if (help) return { help, ...target, email: "" };
  if (values.email === undefined) throw new Error("--email <email> is required: the Clinician to allow");
  return { help, ...target, email: clinicianEmail(values.email, "--email", target) };
}

/** A single Firestore document id: no "/", not "." or "..", not reserved (`__...__`). */
const DOCUMENT_ID = /^(?!\.\.?$)(?!__.*__$)[^/]{1,1500}$/;

/**
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @returns {SilenceCommand}
 */
export function parseSilenceCommand(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      patient: { type: "string" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  const help = values.help ?? false;
  const target = resolveTarget(values.project, env);
  if (help) return { help, ...target, patientId: "" };
  if (values.patient === undefined) throw new Error("--patient <id> is required: the live Patient to make silent");
  if (!DOCUMENT_ID.test(values.patient)) throw new Error(`--patient must be a Patient id, got "${values.patient}"`);
  return { help, ...target, patientId: values.patient };
}
