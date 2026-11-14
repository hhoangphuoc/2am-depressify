// Outcomes and learning what helps (#21; spec #5, "Learning what helps" and "Suggestion
// lifecycle"), all pure: which Suggestion a Check-in's answer belongs to, which answer counts, the
// day's steps against Baseline, the Outcome score, and the ranking of kinds. No Firebase, no
// network, no clock, no logging.
//
// The score and the ranking are pinned by the shared fixture fixtures/outcomes/outcome-cases.json,
// which core's Kotlin tests (app.depressify.core.learning) and the seed's tests also read: the phone
// ranks kinds for its Brief, the seed writes scores, Finish Check-in writes the real ones. Change the
// rule only by changing the fixture and every copy together.
import { WINDOW_DAYS, compareWithBaseline, oriented } from "./baseline";
import type { Tried } from "./decisions";
import { addDays, dateInZone } from "./digest";
import { SUGGESTION_KINDS, type DailyDoc, type Suggestion, type SuggestionKind } from "./types";

// ---------------------------------------------------------------------------------------------
// The Outcome score
// ---------------------------------------------------------------------------------------------

/** "Not this time": a small negative value, whatever the sensors say. */
export const NOT_TRIED_SCORE = -0.1;
/** Weight of the Patient's feeling (1 to 5, centred on 3 and scaled to plus or minus 1). */
export const FEELING_WEIGHT = 0.7;
/** Weight of the day's steps against Baseline, itself clamped to plus or minus 1 first. */
export const STEPS_WEIGHT = 0.3;

/** Dates of daily records are in the device time zone, Europe/Helsinki in the demo. */
export const OUTCOME_TIME_ZONE = "Europe/Helsinki";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRating = (value: unknown): value is number => isNumber(value) && Number.isInteger(value) && value >= 1 && value <= 5;

/**
 * The Outcome score (spec #5): null until the Patient answers (`tried` null, including "prefer not
 * to say"); `NOT_TRIED_SCORE` for "not this time"; otherwise
 * `0.7 x (felt - 3) / 2 + 0.3 x clamp(objectiveChange, -1, 1)`, clamped to plus or minus 1. A
 * feeling not given (or outside 1 to 5) and a missing step change each contribute nothing.
 *
 * The step change is clamped before it is weighted, so it moves the score by at most 0.3: an
 * Outcome is the Patient's report, and sensors inform it but cannot turn a bad feeling good.
 */
export function outcomeScore(tried: boolean | null | undefined, felt: number | null | undefined, objectiveChange: number | null | undefined): number | null {
  if (tried === true) {
    const feeling = isRating(felt) ? (felt - 3) / 2 : 0;
    const steps = isNumber(objectiveChange) ? clamp(objectiveChange, -1, 1) : 0;
    return clamp(FEELING_WEIGHT * feeling + STEPS_WEIGHT * steps, -1, 1);
  }
  return tried === false ? NOT_TRIED_SCORE : null;
}

// ---------------------------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------------------------

/**
 * The Patient's answer about the previous Suggestion. `tried` true (with an optional 1 to 5
 * `felt`), false ("not this time"), or null ("prefer not to say": answered, but unknown).
 */
export interface OutcomeAnswer {
  tried: boolean | null;
  felt: number | null;
}

/** What the text model heard about the previous Suggestion (the structured output's fields). */
export interface HeardOutcome {
  previousTried: boolean | null;
  previousFelt: number | null;
  previousPreferNotToSay: boolean;
}

/**
 * Which answer counts. The text model's extraction comes first: tried or not tried, then "prefer
 * not to say". Only when it is unsure (said nothing either way, or there was no usable reply) does
 * the Decisions answer (#20) decide, and then only a clear yes or no. Null: nothing was heard, and
 * the Outcome stays open for the next Check-in.
 */
export function resolveOutcome(heard: HeardOutcome | null, decisionsTried: Tried): OutcomeAnswer | null {
  const felt = isRating(heard?.previousFelt) ? heard!.previousFelt : null;
  if (heard?.previousTried === true) return { tried: true, felt };
  if (heard?.previousTried === false) return { tried: false, felt: null };
  if (heard?.previousPreferNotToSay === true) return { tried: null, felt: null };
  if (decisionsTried === "yes") return { tried: true, felt };
  if (decisionsTried === "no") return { tried: false, felt: null };
  return null;
}

// ---------------------------------------------------------------------------------------------
// The target
// ---------------------------------------------------------------------------------------------

/** A Suggestion as stored, with its document id. */
export interface StoredSuggestion {
  id: string;
  suggestion: Partial<Suggestion>;
}

/** Whether a Suggestion already has an Outcome: answered by a Check-in, or (older documents) a stored answer or score. */
export function hasOutcome(s: Partial<Suggestion>): boolean {
  return typeof s.outcomeCheckInId === "string" || typeof s.tried === "boolean" || isNumber(s.outcomeScore);
}

/**
 * The Suggestion a Check-in's answer belongs to (spec #5): the most recent accepted Suggestion,
 * made before the Check-in started and not one of its own (`excludeIds`, the draft's Suggestions),
 * that has no Outcome yet, or whose Outcome this same Check-in recorded (a retried finish). A
 * proposed or declined Suggestion never gets an Outcome.
 */
export function outcomeTarget(
  suggestions: readonly StoredSuggestion[],
  checkIn: { id: string; startedAtMillis?: number | null },
  excludeIds: readonly string[] = [],
): StoredSuggestion | undefined {
  const startedAt = checkIn.startedAtMillis;
  return suggestions
    .filter(({ id, suggestion: s }) =>
      s.status === "accepted" &&
      isNumber(s.suggestedAtMillis) &&
      (!isNumber(startedAt) || s.suggestedAtMillis < startedAt) &&
      !excludeIds.includes(id) &&
      (s.outcomeCheckInId === checkIn.id || !hasOutcome(s)),
    )
    .sort((a, b) => b.suggestion.suggestedAtMillis! - a.suggestion.suggestedAtMillis! || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
}

// ---------------------------------------------------------------------------------------------
// The day's steps against Baseline
// ---------------------------------------------------------------------------------------------

/** The day whose steps count for a Suggestion: the date it was made, in the device time zone. */
export function outcomeDay(suggestedAtMillis: number): string {
  return dateInZone(suggestedAtMillis, OUTCOME_TIME_ZONE);
}

/** The daily records to read for that day: the day itself and the 14 before it (its Baseline window). */
export function outcomeDailyRange(date: string): { start: string; end: string } {
  return { start: addDays(date, -WINDOW_DAYS), end: date };
}

/**
 * The daily records a finish must read for the Outcome's `objectiveChange`, or null when it needs
 * none: no write will happen (see `outcomeWrite`), the answer is "prefer not to say", or the Patient
 * has left steps out.
 */
export function outcomeDailyNeeded(target: StoredSuggestion | undefined, plan: OutcomePlan | null): { start: string; end: string } | null {
  if (plan === null || target === undefined || target.id !== plan.suggestionId) return null;
  const s = target.suggestion;
  if (s.status !== "accepted" || hasOutcome(s) || plan.answer.tried === null || !plan.stepsAllowed || !isNumber(s.suggestedAtMillis)) return null;
  return outcomeDailyRange(outcomeDay(s.suggestedAtMillis));
}

/**
 * The day's oriented steps comparison with the Patient's Baseline. The daily record's stored
 * `vsBaseline.steps` when it has one; otherwise computed by the shared Baseline rule from the
 * records' `values.steps`. Null when there is no record for the day, no steps that day, or too few
 * valid days before it.
 */
export function objectiveChange(daily: readonly Partial<DailyDoc>[], date: string): number | null {
  const day = daily.find((d) => d.date === date);
  if (!day) return null;
  const stored = day.vsBaseline?.steps;
  if (isNumber(stored)) return oriented("steps", stored);
  const history = daily.filter((d) => typeof d.date === "string").map((d) => ({ date: d.date!, value: d.values?.steps }));
  return oriented("steps", compareWithBaseline(history, { date, value: day.values?.steps }));
}

// ---------------------------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------------------------

/** The function-only Outcome fields of a Suggestion. */
export type OutcomeFields = Pick<Suggestion, "tried" | "felt" | "objectiveChange" | "outcomeScore" | "outcomeCheckInId">;

/** What a finish wants to record, decided before the transaction. */
export interface OutcomePlan {
  /** The target found before the model call; the transaction writes only if it is still the target. */
  suggestionId: string;
  answer: OutcomeAnswer;
  /** False when the Patient has left steps out (`consents/steps`): no `objectiveChange`. */
  stepsAllowed: boolean;
  /** The draft's own Suggestions, never a target. */
  excludeIds: string[];
}

/**
 * The Outcome one finish writes, given the target as the transaction reads it now and the daily
 * records around its day. Nothing when there is no plan, the target has changed, or the target
 * already has an Outcome: an Outcome is applied once, so a retried finish of the same Check-in
 * leaves the one it recorded, and nothing overwrites one another Check-in recorded.
 *
 * `objectiveChange` is stored for tried and not tried; "prefer not to say" stores none. Only the
 * Outcome fields change: the Suggestion's stamp, status and the rest stay as they are.
 */
export function outcomeWrite(
  target: StoredSuggestion | undefined,
  plan: OutcomePlan | null,
  daily: readonly Partial<DailyDoc>[],
  checkInId: string,
): { id: string; fields: OutcomeFields } | null {
  if (plan === null || target === undefined || target.id !== plan.suggestionId) return null;
  const s = target.suggestion;
  if (s.status !== "accepted" || hasOutcome(s)) return null;
  const { tried } = plan.answer;
  const change = tried !== null && plan.stepsAllowed && isNumber(s.suggestedAtMillis) ? objectiveChange(daily, outcomeDay(s.suggestedAtMillis)) : null;
  const felt = tried === true && isRating(plan.answer.felt) ? plan.answer.felt : null;
  return {
    id: target.id,
    fields: { tried, felt, objectiveChange: change, outcomeScore: outcomeScore(tried, felt, change), outcomeCheckInId: checkInId },
  };
}

// ---------------------------------------------------------------------------------------------
// Ranking: which kinds help this Patient
// ---------------------------------------------------------------------------------------------

/** How many kinds go into the Brief. */
export const PREFERRED_KINDS = 3;
/** About one Check-in in five tries something new. */
export const TRY_NEW_RATE = 0.2;

export interface KindScore {
  kind: SuggestionKind;
  /** Mean Outcome score; for ordering only, never shown to anyone. */
  mean: number;
  /** Scored Suggestions of this kind. */
  n: number;
}

export interface Guidance {
  /** The best kinds, at most three. */
  preferred: KindScore[];
  /** A kind to try for something new, or null. */
  tryNew: SuggestionKind | null;
}

/**
 * Kinds by their mean Outcome score, then by how many were scored, both descending; ties in the
 * kinds' contract order. Only scored Suggestions count: unanswered, declined and "prefer not to say"
 * have no score.
 */
export function rankKinds(history: readonly Partial<Pick<Suggestion, "kind" | "outcomeScore">>[]): KindScore[] {
  const scores = new Map<SuggestionKind, number[]>();
  for (const s of history) {
    if (!SUGGESTION_KINDS.includes(s.kind as SuggestionKind) || !isNumber(s.outcomeScore)) continue;
    const kind = s.kind as SuggestionKind;
    scores.set(kind, [...(scores.get(kind) ?? []), s.outcomeScore]);
  }
  return [...scores.entries()]
    .map(([kind, values]) => ({ kind, mean: values.reduce((sum, v) => sum + v, 0) / values.length, n: values.length }))
    .sort((a, b) => b.mean - a.mean || b.n - a.n || SUGGESTION_KINDS.indexOf(a.kind) - SUGGESTION_KINDS.indexOf(b.kind));
}

/**
 * What the Brief gets: the top three kinds and, when the injected `random()` is below 0.2, one kind
 * to try: the first kind in contract order with no score yet, or else the least-scored kind outside
 * the top three. `random` is called exactly once.
 */
export function guidance(history: readonly Partial<Pick<Suggestion, "kind" | "outcomeScore">>[], random: () => number): Guidance {
  const ranked = rankKinds(history);
  const preferred = ranked.slice(0, PREFERRED_KINDS);
  if (random() >= TRY_NEW_RATE) return { preferred, tryNew: null };
  const untried = SUGGESTION_KINDS.find((kind) => !ranked.some((r) => r.kind === kind));
  if (untried !== undefined) return { preferred, tryNew: untried };
  const rest = ranked
    .filter((r) => !preferred.includes(r))
    .sort((a, b) => a.n - b.n || SUGGESTION_KINDS.indexOf(a.kind) - SUGGESTION_KINDS.indexOf(b.kind));
  return { preferred, tryNew: rest[0]?.kind ?? null };
}
