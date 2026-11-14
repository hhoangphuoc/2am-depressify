// The Attention flag write rules every function writer follows (spec #5, "Attention flag"; ADR 0009):
// - a kind that already has an uncleared flag with the same stamp is not raised again;
// - nothing but the Clinician lowers a level;
// - the Patient's level is the highest uncleared flag stamped `sharedWithClinician: true`, with
//   those flags' reasons, highest level first, then newest.
//
// Pure: no Firestore, no clock, no logging. Writers: the silence check (#28, silence.ts) and Finish
// Check-in's Decisions routing (#20, decisions.ts). The phone follows the same rules in Kotlin, and
// the dashboard's clearing helper (hosting/js/lib/clear.js) lowers the level after follow-up.
import { FLAG_LEVELS, type Flag, type FlagLevel, type PatientDoc } from "./types";

/** A flag already stored for the Patient, with its id. */
export interface StoredFlag {
  id: string;
  flag: Partial<Flag>;
}

function rank(level: unknown): number {
  return FLAG_LEVELS.indexOf(level as FlagLevel);
}

/**
 * The Patient's `flagLevel` and `flagReasons` after raising `flag`: the level only ever goes up,
 * and the reasons keep their order (highest level first, then newest), with the new reason placed
 * after any reason of a higher level. A new red reason, the newest red, therefore comes first.
 * Call it only for a flag stamped `sharedWithClinician: true`: an unshared flag never counts.
 */
export function raisedAttention(
  patient: Partial<Pick<PatientDoc, "flagLevel" | "flagReasons">>,
  flag: Pick<Flag, "level" | "reason">,
): Pick<PatientDoc, "flagLevel" | "flagReasons"> {
  const current: FlagLevel = rank(patient.flagLevel) >= 0 ? (patient.flagLevel as FlagLevel) : "green";
  const flagLevel = rank(flag.level) > rank(current) ? flag.level : current;
  const kept = (Array.isArray(patient.flagReasons) ? patient.flagReasons : []).filter(
    (reason): reason is string => typeof reason === "string" && reason !== "" && reason !== flag.reason,
  );
  // Reasons on the record are ordered highest level first. A flag below the current level goes after
  // all of them; one at or above it is the newest of the highest level, so it goes first.
  const flagReasons = rank(flag.level) >= rank(current) ? [flag.reason, ...kept] : [...kept, flag.reason];
  return { flagLevel, flagReasons };
}

/** Whether an uncleared flag of `kind` with the stamp `shared` is stored: the "not raised again" rule. */
export function hasOpenFlag(flags: readonly StoredFlag[], kind: Flag["kind"], shared: boolean): boolean {
  return flags.some((stored) => stored.flag.kind === kind && stored.flag.clearedAtMillis == null && stored.flag.sharedWithClinician === shared);
}
