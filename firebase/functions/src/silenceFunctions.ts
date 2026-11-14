// The silence check (issue #28): `silenceCheck` runs at the top of every hour (Europe/Helsinki) and
// raises a red `silent` flag for each sharing, live Patient whose phone has shown no sign of life
// for over 24 hours. The rule and the plan are pure, in silence.ts.
//
// For each Patient the listing finds silent, one transaction re-reads the record and that Patient's
// silent flags, re-runs the rule on what it read, and creates the flag
// (`patients/{id}/flags/silent-<lastSeenAtMillis>`) and raises the record's `flagLevel` and
// `flagReasons` together, or writes nothing. The id is the same for every run during one silence,
// so a retried or overlapping run never writes a second flag for it.
//
// It sends no email itself: creating the red flag is enough, because `redFlagAlert` (#22) writes the
// email for every red flag the Clinician may see. Nothing reaches the Patient's phone: no Crisis
// notice and no notification (the app never shows flags).
//
// Scheduled functions need Cloud Scheduler, which has no europe-north1 location, so this runs in
// `SCHEDULER_REGION` (europe-west1) like the weekly Digest and reads the database in Finland.
//
// To run it once now, without waiting for the hour, force-run its Cloud Scheduler job (README,
// "Silence check"): there is deliberately no callable or HTTP way in.
//
// Log lines carry Patient and flag ids, counts and an error code only: never the display name,
// the Clinician's address or anything else from the record (test/silence-logging.test.ts).
import type { Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { SCHEDULER_REGION } from "./region";
import { SILENCE_SCHEDULE, SILENCE_TIME_ZONE, silenceDecision, silencePlan, type SilencePlan, type SilencePlanSkip, type StoredFlag } from "./silence";
import { COLLECTIONS, type Flag, type PatientDoc } from "./types";

/** What the silence check reads and writes. */
export interface SilenceStore {
  /** Every Patient, with only the fields the rule reads: `sharingConsent`, `synthetic`, `lastSeenAtMillis`. */
  listPatients(): Promise<{ id: string; patient: Partial<PatientDoc> }[]>;
  /**
   * In one transaction: reads the Patient record and the Patient's flags of kind `silent`, calls
   * `plan` with them, and, when it says raise, creates the flag and updates the record. Resolves to
   * the plan. `plan` may be called more than once if the transaction is retried.
   */
  raiseSilent(
    patientId: string,
    plan: (patient: Partial<PatientDoc> | undefined, silentFlags: StoredFlag[]) => SilencePlan,
  ): Promise<SilencePlan>;
}

/** The Admin SDK store used in production and in the emulator tests. */
export function adminSilenceStore(db: Firestore): SilenceStore {
  const patients = db.collection(COLLECTIONS.patients);
  return {
    async listPatients() {
      // Only the fields the rule needs: the check never reads a name or an address.
      const snapshot = await patients.select("sharingConsent", "synthetic", "lastSeenAtMillis").get();
      return snapshot.docs.map((doc) => ({ id: doc.id, patient: doc.data() as Partial<PatientDoc> }));
    },
    async raiseSilent(patientId, plan) {
      const patientRef = patients.doc(patientId);
      const flags = patientRef.collection(COLLECTIONS.flags);
      return db.runTransaction(async (transaction) => {
        const record = await transaction.get(patientRef);
        const silent = await transaction.get(flags.where("kind", "==", "silent"));
        const result = plan(
          record.exists ? (record.data() as Partial<PatientDoc>) : undefined,
          silent.docs.map((doc) => ({ id: doc.id, flag: doc.data() as Partial<Flag> })),
        );
        if (result.raise) {
          transaction.create(flags.doc(result.flagId), result.flag);
          transaction.update(patientRef, result.update);
        }
        return result;
      });
    },
  };
}

export interface SilenceCheckResult {
  /** Patients listed. */
  patients: number;
  /** New silent flags written. */
  raised: number;
  /** Silent, but a silent flag is open or this silence was flagged already. */
  alreadyFlagged: number;
  /** Seen in the last 24 hours, never seen, seen "in the future", or the record is gone. */
  notSilent: number;
  /** Not sharing with the Clinician: skipped. */
  notSharing: number;
  /** Demo Patients: never silent. */
  synthetic: number;
  failed: number;
}

export interface SilenceDeps {
  store: SilenceStore;
}

function count(result: SilenceCheckResult, skip: SilencePlanSkip): void {
  if (skip === "already_open" || skip === "episode_flagged") result.alreadyFlagged += 1;
  else if (skip === "not_sharing") result.notSharing += 1;
  else if (skip === "synthetic") result.synthetic += 1;
  else result.notSilent += 1;
}

/** One run: a red silent flag for every Patient silent at `nowMillis` who has none open. */
export async function silenceCheckHandler(nowMillis: number, deps: SilenceDeps): Promise<SilenceCheckResult> {
  const result: SilenceCheckResult = { patients: 0, raised: 0, alreadyFlagged: 0, notSilent: 0, notSharing: 0, synthetic: 0, failed: 0 };
  const patients = await deps.store.listPatients();
  result.patients = patients.length;
  for (const { id, patient } of patients) {
    const decision = silenceDecision(patient, nowMillis);
    if (!decision.silent) {
      count(result, decision.skip);
      continue;
    }
    try {
      const plan = await deps.store.raiseSilent(id, (fresh, silentFlags) => silencePlan(fresh, silentFlags, nowMillis));
      if (plan.raise) {
        result.raised += 1;
        logger.info("silenceCheck: raised", { patientId: id, flagId: plan.flagId });
      } else {
        count(result, plan.skip);
      }
    } catch (error) {
      result.failed += 1;
      // Only where it stopped: an error's message could carry the record.
      const code = (error as { code?: unknown })?.code;
      logger.warn("silenceCheck: one Patient failed", { patientId: id, code: typeof code === "number" || typeof code === "string" ? code : null });
    }
  }
  logger.info("silenceCheck: done", { ...result });
  return result;
}

/** How the function gets its dependencies, built per run. */
export interface SilenceDepsFactory {
  store: () => SilenceStore;
}

/** Builds the scheduled function. Production passes the Admin SDK; tests pass fakes. */
export function createSilenceFunctions(deps: SilenceDepsFactory) {
  const silenceCheck = onSchedule(
    {
      schedule: SILENCE_SCHEDULE,
      timeZone: SILENCE_TIME_ZONE,
      region: SCHEDULER_REGION,
      timeoutSeconds: 300,
    },
    async () => {
      // The time it actually runs: a late run must measure silence up to now.
      try {
        await silenceCheckHandler(Date.now(), { store: deps.store() });
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        logger.error("silenceCheck: the run failed", { code: typeof code === "number" || typeof code === "string" ? code : null });
        throw new Error("silenceCheck failed");
      }
    },
  );
  return { silenceCheck };
}
