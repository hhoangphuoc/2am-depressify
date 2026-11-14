// The silence check (issue #28): which Patients' phones have gone quiet, and what to write for one.
//
// Pure: no Firestore, no clock, no logging. The scheduled `silenceCheck` in silenceFunctions.ts
// lists the Patients, runs `silenceDecision` on each, and for a silent one runs `silencePlan` inside
// a transaction on the fresh record and that Patient's silent flags, then writes what it returns.
//
// The rule (spec #5, "Attention flag"): red `silent` when the last sign of life
// (`lastSeenAtMillis`) is older than 24 hours; never for a synthetic Patient; the reason says the
// phone has been quiet and infers nothing else. Edge cases, all "not silent":
// - exactly 24 hours: the rule is "older than", so only strictly more than 24 hours is silent;
// - never seen (`lastSeenAtMillis` null, missing or not a number): the issue's acceptance criteria
//   say a Patient never seen is not silent. The phone writes the sign of life itself, so null means
//   the app has not yet reported one, and there is no sign of life to have gone quiet from;
// - a sign of life in the future (the phone's clock ahead): it was seen, so it is not silent;
// - not sharing (`isSharingActive` false): the Clinician's monitoring stops for that Patient;
// - synthetic: the seeded Demo Patients never send a sign of life of their own.
//
// The three write rules: a kind that already has an uncleared flag with the same stamp is not raised
// again; nothing but the Clinician lowers a level; the Patient's level is the highest uncleared flag
// stamped `sharedWithClinician: true`. The silence check only ever writes a shared flag (it skips
// Patients who are not sharing), so it raises the level to red and adds its reason.
//
// One flag per silence episode: the flag id is `silent-<lastSeenAtMillis>`. Every hourly run during
// the same silence computes the same id, so a retried or overlapping run never writes a second one,
// and an episode whose flag the Clinician has cleared is not flagged again until the phone has been
// seen and gone quiet once more.
import { hasOpenFlag, raisedAttention, type StoredFlag } from "./flags";
import { isSharingActive, sharingStamp } from "./sharing";
import type { Flag, PatientDoc } from "./types";

/** At the top of every hour. */
export const SILENCE_SCHEDULE = "0 * * * *";

/** The schedule's time zone (the demo's, as everywhere else). */
export const SILENCE_TIME_ZONE = "Europe/Helsinki";

/** A phone is silent when its last sign of life is older than this. */
export const SILENCE_THRESHOLD_MILLIS = 24 * 60 * 60 * 1000;

/**
 * The flag's reason, a plain sentence (ADR 0009). It says only that the phone has been quiet: no
 * inference about mood, risk or self-harm, and no number but the fixed 24 hours.
 */
export const SILENT_REASON = "The phone has been quiet: it has not connected for over 24 hours.";

/** Why a Patient is not silent, or gets no flag. Safe to log: it carries no data. */
export type SilenceSkip = "no_patient" | "not_sharing" | "synthetic" | "never_seen" | "future" | "recent";

/** Why a silent Patient still gets no new flag. */
export type SilencePlanSkip = SilenceSkip | "already_open" | "episode_flagged";

export type SilenceDecision = { silent: true; lastSeenAtMillis: number } | { silent: false; skip: SilenceSkip };

type SilenceFields = Pick<PatientDoc, "sharingConsent" | "synthetic" | "lastSeenAtMillis">;

/** Whether the Patient's phone is silent at `nowMillis`, or why not. */
export function silenceDecision(patient: Partial<SilenceFields> | null | undefined, nowMillis: number): SilenceDecision {
  if (!patient) return { silent: false, skip: "no_patient" };
  if (!isSharingActive(patient)) return { silent: false, skip: "not_sharing" };
  if (patient.synthetic === true) return { silent: false, skip: "synthetic" };
  const lastSeen = patient.lastSeenAtMillis;
  if (typeof lastSeen !== "number" || !Number.isFinite(lastSeen)) return { silent: false, skip: "never_seen" };
  if (lastSeen > nowMillis) return { silent: false, skip: "future" };
  if (nowMillis - lastSeen <= SILENCE_THRESHOLD_MILLIS) return { silent: false, skip: "recent" };
  return { silent: true, lastSeenAtMillis: lastSeen };
}

/** The flag id for the silence that began after `lastSeenAtMillis`. */
export function silentFlagId(lastSeenAtMillis: number): string {
  return `silent-${lastSeenAtMillis}`;
}

/** The red silent flag, stamped with `sharingStamp` (true: only sharing Patients are flagged). */
export function silentFlag(patient: Partial<Pick<PatientDoc, "sharingConsent">>, nowMillis: number): Flag {
  return {
    level: "red",
    kind: "silent",
    reason: SILENT_REASON,
    raisedAtMillis: nowMillis,
    clearedAtMillis: null,
    sharedWithClinician: sharingStamp(patient),
  };
}

export type SilencePlan =
  | { raise: true; flagId: string; flag: Flag; update: Pick<PatientDoc, "flagLevel" | "flagReasons"> }
  | { raise: false; skip: SilencePlanSkip };

/**
 * What one Patient's transaction writes, from the fresh record and the Patient's silent flags.
 * Nothing when the Patient is not silent now, when a silent flag with the same stamp is still open
 * (the "not raised again" rule), or when this episode's flag exists already, open or cleared.
 */
export function silencePlan(
  patient: Partial<PatientDoc> | null | undefined,
  silentFlags: readonly StoredFlag[],
  nowMillis: number,
): SilencePlan {
  const decision = silenceDecision(patient, nowMillis);
  if (!decision.silent) return { raise: false, skip: decision.skip };
  const flag = silentFlag(patient!, nowMillis);
  const flagId = silentFlagId(decision.lastSeenAtMillis);
  const silent = silentFlags.filter((stored) => stored.flag.kind === "silent");
  if (hasOpenFlag(silent, "silent", flag.sharedWithClinician)) return { raise: false, skip: "already_open" };
  if (silent.some((stored) => stored.id === flagId)) return { raise: false, skip: "episode_flagged" };
  return { raise: true, flagId, flag, update: raisedAttention(patient!, flag) };
}
