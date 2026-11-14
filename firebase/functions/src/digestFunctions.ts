// The weekly Digest functions. Both write `patients/{patientId}/digests/{isoWeek}` with the Admin
// SDK (the rules let clients only read Digests):
//
//   weeklyDigest    Mondays 07:00 Europe/Helsinki. One Digest per sharing Patient for the previous
//                   ISO week (Monday to Sunday).
//   generateDigest  {patientId} -> {digest}. Called by the dashboard's "Generate now", for the
//                   Patient's Clinician only (`assertClinicianOf`, which also requires sharing).
//                   Covers the current ISO week from Monday to today and overwrites that week.
//
// A week with Check-ins is written by the text model with storage off, from that week's Summaries
// and daily Signals only. A week with no Check-ins gets fixed copy and the model is not called, so
// nothing can be invented.
//
// Patients who are not sharing (`isSharingActive`, issue #29) get no Digest: it is written for the
// Clinician, who cannot read it while sharing is off, and making one would send the Patient's week
// to the model for nobody. Earlier Digests are kept (the deletion policy is an open decision).
//
// Nothing logs Summary text, quotes, the prompt or the Digest text, including on error paths: log
// lines carry the Patient id, the week, counts and an HTTP status only. test/digest-logging.test.ts
// checks this through the callable's HTTP layer and the scheduled function.
import type { Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { assertClinicianOf } from "./clinician";
import {
  DIGEST_TIME_ZONE,
  buildDigestRequest,
  digestTextFromModel,
  noCheckInsText,
  onDemandPeriod,
  scheduledPeriod,
  weekData,
  type DigestPeriod,
} from "./digest";
import { GEMINI_API_KEY, type TextModelClient } from "./gemini";
import { patientIdOf } from "./intake";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall } from "./intakeFunctions";
import { isSharingActive } from "./sharing";
import { COLLECTIONS, type DailyDoc, type Digest, type PatientDoc, type Summary } from "./types";

/** Mondays at 07:00. */
export const WEEKLY_DIGEST_SCHEDULE = "0 7 * * 1";

/** What the Digest functions read and write. */
export interface DigestStore {
  getPatient(patientId: string): Promise<Partial<PatientDoc> | undefined>;
  /** Every Patient, with at least `sharingConsent`. */
  listPatients(): Promise<{ id: string; patient: Partial<PatientDoc> }[]>;
  /** Summaries created in [startMillis, endMillis). */
  summaries(patientId: string, startMillis: number, endMillis: number): Promise<Summary[]>;
  /** Daily records dated weekStart to weekEnd, inclusive. */
  days(patientId: string, weekStart: string, weekEnd: string): Promise<DailyDoc[]>;
  /** Writes `digests/{digest.isoWeek}`, replacing what was there. */
  writeDigest(patientId: string, digest: Digest): Promise<void>;
}

export interface DigestDeps {
  store: DigestStore;
  textModel: TextModelClient;
}

/** The Admin SDK store used in production and in the emulator tests. */
export function adminDigestStore(db: Firestore): DigestStore {
  const patient = (patientId: string) => db.collection(COLLECTIONS.patients).doc(patientId);
  return {
    async getPatient(patientId) {
      const snapshot = await patient(patientId).get();
      return snapshot.exists ? (snapshot.data() as Partial<PatientDoc>) : undefined;
    },
    async listPatients() {
      // Only the field the job needs; the decision is made in code by isSharingActive.
      const snapshot = await db.collection(COLLECTIONS.patients).select("sharingConsent").get();
      return snapshot.docs.map((doc) => ({ id: doc.id, patient: doc.data() as Partial<PatientDoc> }));
    },
    async summaries(patientId, startMillis, endMillis) {
      const snapshot = await patient(patientId)
        .collection(COLLECTIONS.summaries)
        .where("createdAtMillis", ">=", startMillis)
        .where("createdAtMillis", "<", endMillis)
        .get();
      return snapshot.docs.map((doc) => doc.data() as Summary);
    },
    async days(patientId, weekStart, weekEnd) {
      const snapshot = await patient(patientId)
        .collection(COLLECTIONS.daily)
        .where("date", ">=", weekStart)
        .where("date", "<=", weekEnd)
        .get();
      return snapshot.docs.map((doc) => doc.data() as DailyDoc);
    },
    async writeDigest(patientId, digest) {
      await patient(patientId).collection(COLLECTIONS.digests).doc(digest.isoWeek).set(digest);
    },
  };
}

/** Why one Patient's Digest could not be written. Carries no data, only where it stopped. */
class DigestFailure extends Error {
  constructor(
    readonly stage: "read" | "model" | "empty" | "write",
    readonly status: number | null = null,
  ) {
    super(`Digest failed at ${stage}`);
  }
}

/**
 * Reads the period's Summaries and Signals, writes the Digest and returns it. Throws a
 * DigestFailure (never an error that could carry the data) when a step fails.
 */
export async function writeDigestFor(patientId: string, period: DigestPeriod, deps: DigestDeps, nowMillis: number): Promise<Digest> {
  let summaries: Summary[];
  let days: DailyDoc[];
  try {
    [summaries, days] = await Promise.all([
      deps.store.summaries(patientId, period.startMillis, period.endMillis),
      deps.store.days(patientId, period.weekStart, period.weekEnd),
    ]);
  } catch {
    throw new DigestFailure("read");
  }
  const week = weekData(period, summaries, days);

  let text: string;
  if (week.summaries.length === 0) {
    text = noCheckInsText(period);
  } else {
    let output: string | null;
    try {
      output = await deps.textModel.generateText(buildDigestRequest(period, week.summaries, week.days));
    } catch (error) {
      throw new DigestFailure("model", statusOf(error));
    }
    text = digestTextFromModel(output);
    if (text === "") throw new DigestFailure("empty");
  }

  const digest: Digest = {
    isoWeek: period.isoWeek,
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    summaryCount: week.summaries.length,
    text,
    generatedAtMillis: nowMillis,
  };
  try {
    await deps.store.writeDigest(patientId, digest);
  } catch {
    throw new DigestFailure("write");
  }
  return digest;
}

export interface GenerateDigestResponse {
  digest: Digest;
}

/** "Generate now": this week's Digest so far, for the Patient's Clinician only. */
export async function generateDigestHandler(
  call: IntakeCall,
  deps: DigestDeps & { nowMillis: () => number },
): Promise<GenerateDigestResponse> {
  const auth = requireAuth(call.auth);
  const patientId = patientIdOf(call.data);
  let patient: Partial<PatientDoc> | undefined;
  try {
    patient = await deps.store.getPatient(patientId);
  } catch {
    logger.warn("generateDigest: could not read the Patient record", { patientId });
    throw new HttpsError("unavailable", "Could not reach the Patient record. Try again.");
  }
  assertClinicianOf(patient, auth);

  const now = deps.nowMillis();
  const period = onDemandPeriod(now);
  try {
    return { digest: await writeDigestFor(patientId, period, deps, now) };
  } catch (error) {
    const failure = error instanceof DigestFailure ? error : new DigestFailure("write");
    logger.warn("generateDigest: failed", { patientId, isoWeek: period.isoWeek, stage: failure.stage, status: failure.status });
    throw new HttpsError("unavailable", "Could not generate the Digest. Try again.");
  }
}

export interface WeeklyDigestResult {
  isoWeek: string;
  /** Digests written, including those for a week with no Check-ins. */
  written: number;
  /** Of those written, how many had no Check-ins (fixed copy, no model call). */
  noCheckIns: number;
  /** Patients skipped because they are not sharing. */
  notSharing: number;
  failed: number;
}

/** The Monday job: the previous ISO week's Digest for every sharing Patient. */
export async function weeklyDigestHandler(nowMillis: number, deps: DigestDeps): Promise<WeeklyDigestResult> {
  const period = scheduledPeriod(nowMillis);
  const result: WeeklyDigestResult = { isoWeek: period.isoWeek, written: 0, noCheckIns: 0, notSharing: 0, failed: 0 };
  const patients = await deps.store.listPatients();
  for (const { id, patient } of patients) {
    if (!isSharingActive(patient)) {
      result.notSharing += 1;
      continue;
    }
    try {
      const digest = await writeDigestFor(id, period, deps, nowMillis);
      result.written += 1;
      if (digest.summaryCount === 0) result.noCheckIns += 1;
    } catch (error) {
      result.failed += 1;
      const failure = error instanceof DigestFailure ? error : new DigestFailure("write");
      logger.warn("weeklyDigest: one Patient failed", { patientId: id, isoWeek: period.isoWeek, stage: failure.stage, status: failure.status });
    }
  }
  logger.info("weeklyDigest: done", { ...result });
  return result;
}

/** How the functions get their dependencies, built per run so secrets are read at run time. */
export interface DigestDepsFactory {
  store: () => DigestStore;
  textModel: () => TextModelClient;
}

/** Builds the two functions. Production passes the Admin SDK and Gemini; tests pass fakes. */
export function createDigestFunctions(deps: DigestDepsFactory) {
  // Built only when the model is called, so a week with no Check-ins never needs the key.
  const lazyModel: TextModelClient = { generateText: (request) => deps.textModel().generateText(request) };

  const weeklyDigest = onSchedule(
    { schedule: WEEKLY_DIGEST_SCHEDULE, timeZone: DIGEST_TIME_ZONE, secrets: [GEMINI_API_KEY], timeoutSeconds: 540 },
    async (event) => {
      // The scheduled time, not the start time, so a late run still covers the right week.
      const scheduled = Date.parse(event.scheduleTime);
      try {
        await weeklyDigestHandler(Number.isFinite(scheduled) ? scheduled : Date.now(), { store: deps.store(), textModel: lazyModel });
      } catch (error) {
        logger.error("weeklyDigest: the run failed", { status: statusOf(error) });
        throw new Error("weeklyDigest failed");
      }
    },
  );

  const generateDigest = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 }, (request) =>
    safely("generateDigest", () =>
      generateDigestHandler(callerOf(request), { store: deps.store(), textModel: lazyModel, nowMillis: () => Date.now() }),
    ),
  );

  return { weeklyDigest, generateDigest };
}
