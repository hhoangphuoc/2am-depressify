// The red flag alert (issue #22): whether a newly created flag emails the Clinician, and the email.
//
// Pure: no Firestore, no clock, no logging. The trigger in alertFunctions.ts reads the flag and the
// Patient record and writes what `alertDecision` returns to `mail/{mailIdFor(...)}`, which the
// Firebase Trigger Email extension sends.
//
// Every red flag emails, whoever raised it: the phone's crisis tool, the Decisions backstop in
// Finish Check-in (#20), the phone's daily job (sleep collapse, inactive) and the hourly silence
// check (#28, "silent"). None of them has to send the email itself; creating the flag is enough.
//
// The email says only that a red flag was raised, for whom, when, the flag's reason (a plain
// sentence the writer chose, never a transcript), a fixed line per kind and a dashboard link. It
// never carries a transcript, a quote, a Summary, the Intake or any other field of the record
// (ADR 0005, ADR 0006), and it uses the companion's words: no diagnosis, treatment or score
// (ADR 0001, ADR 0009).
import { createHash } from "node:crypto";
import { isSharingActive } from "./sharing";
import type { Flag, FlagKind, MailDoc, PatientDoc } from "./types";

/** Why a created flag sends no email. Safe to log: it carries no data. */
export type AlertSkip =
  | "not_red"
  | "cleared"
  | "not_shared"
  | "no_patient"
  | "not_sharing"
  | "synthetic"
  | "no_clinician";

export type AlertDecision = { mail: MailDoc } | { skip: AlertSkip };

export interface AlertOptions {
  /** Used for the link to the Patient's page. */
  patientId: string;
  /** The dashboard's base URL (`DASHBOARD_URL`), or "" to leave the link out. */
  dashboardUrl: string;
}

/** The time zone the email gives the raised time in (the demo's, as everywhere else). */
export const ALERT_TIME_ZONE = "Europe/Helsinki";

const MAX_REASON_CHARS = 300;
const MAX_NAME_CHARS = 80;

/** Subject label and a fixed body line for each kind. A kind without an entry uses its own name. */
const KIND_WORDING: Partial<Record<FlagKind, { label: string; line: string }>> = {
  crisis: {
    label: "crisis in a Check-in",
    line: "Kind: crisis. It was raised from a Check-in.",
  },
  silent: {
    label: "quiet phone",
    line: "Kind: quiet phone. The phone has not been in touch for 24 hours. A quiet phone is not by itself a sign of self-harm.",
  },
  sleep_collapse: {
    label: "sleep collapse",
    line: "Kind: sleep collapse. It comes from the phone's sleep data compared with the Patient's own Baseline.",
  },
  inactive: {
    label: "inactive",
    line: "Kind: inactive. It comes from the phone's step and screen data.",
  },
};

function wordingFor(kind: unknown): { label: string; line: string } {
  const known = typeof kind === "string" ? KIND_WORDING[kind as FlagKind] : undefined;
  if (known) return known;
  const name = typeof kind === "string" && /^[a-z_]{1,40}$/.test(kind) ? kind.replace(/_/g, " ") : "other";
  return { label: name, line: `Kind: ${name}.` };
}

/** One line: whitespace and control characters collapsed, then capped with an ellipsis. */
function oneLine(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.replace(/[\s\p{Cc}]+/gu, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function formatRaisedAt(millis: unknown): string | null {
  if (typeof millis !== "number" || !Number.isFinite(millis)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ALERT_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(millis));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** The Clinician's address from the record, lower case, or null when it is not an address. */
function clinicianAddress(patient: Partial<PatientDoc>): string | null {
  const email = typeof patient.clinicianEmail === "string" ? patient.clinicianEmail.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

/**
 * The checks on the flag alone, so the trigger can skip an amber or green flag without reading
 * the Patient record. Red, uncleared and stamped `sharedWithClinician: true`.
 */
export function flagSkip(flag: Partial<Flag> | null | undefined): AlertSkip | null {
  if (flag?.level !== "red") return "not_red";
  if (flag.clearedAtMillis != null) return "cleared";
  if (flag.sharedWithClinician !== true) return "not_shared";
  return null;
}

/**
 * Whether a newly created flag emails the Clinician, and the email.
 *
 * Emails only for a red, uncleared flag stamped `sharedWithClinician: true`, of a Patient who is
 * sharing now (`isSharingActive`), is not a Demo Patient, and names a Clinician. A Demo Patient is
 * skipped because the seed deletes and recreates its invented history, red flags included, on
 * every run; the live demo uses a real Patient record (`synthetic: false`).
 */
export function alertDecision(
  flag: Partial<Flag> | null | undefined,
  patient: Partial<PatientDoc> | null | undefined,
  options: AlertOptions,
): AlertDecision {
  const skip = flagSkip(flag);
  if (skip) return { skip };
  if (!patient) return { skip: "no_patient" };
  if (!isSharingActive(patient)) return { skip: "not_sharing" };
  if (patient.synthetic === true) return { skip: "synthetic" };
  const to = clinicianAddress(patient);
  if (!to) return { skip: "no_clinician" };
  return { mail: buildAlertMail(flag!, patient, to, options) };
}

/** `alertDecision` without the reason: the email, or null when none is sent. */
export function alertFor(
  flag: Partial<Flag> | null | undefined,
  patient: Partial<PatientDoc> | null | undefined,
  options: AlertOptions,
): MailDoc | null {
  const decision = alertDecision(flag, patient, options);
  return "mail" in decision ? decision.mail : null;
}

function buildAlertMail(flag: Partial<Flag>, patient: Partial<PatientDoc>, to: string, options: AlertOptions): MailDoc {
  const name = oneLine(patient.displayName, MAX_NAME_CHARS) || "a Patient";
  const wording = wordingFor(flag.kind);
  const tag = flag.kind === "crisis" ? "[CRISIS]" : "[RED]";
  const reason = oneLine(flag.reason, MAX_REASON_CHARS) || "not given. See the dashboard.";
  const raisedAt = formatRaisedAt(flag.raisedAtMillis);
  const link = options.dashboardUrl ? dashboardLink(options.dashboardUrl, options.patientId) : "";

  const lines = [
    `A red Attention flag was raised for ${name}${raisedAt ? ` on ${raisedAt} (Helsinki time)` : ""}.`,
    "",
    `Reason: ${reason}`,
    "",
    wording.line,
    "",
    link
      ? `Open the dashboard to see the flag and clear it after follow-up:\n${link}`
      : "Open the Clinician dashboard to see the flag and clear it after follow-up.",
    "",
    "This is an automatic message from Depressify, a wellbeing companion. It does not contain the Check-in.",
  ];

  return {
    to,
    message: {
      subject: `${tag} Red flag for ${name}: ${wording.label}`,
      text: lines.join("\n"),
    },
  };
}

/**
 * The `mail` document id for a flag: the same for every delivery of the same flag's trigger, so
 * writing it with `create()` sends at most one email per flag. A hash of both ids, which cannot
 * contain "/", so two different (Patient, flag) pairs never share an id.
 */
export function mailIdFor(patientId: string, flagId: string): string {
  return `red-flag-${createHash("sha256").update(`${patientId}/${flagId}`).digest("hex")}`;
}

/** The Patient's page on the dashboard (the route `#/patient/{id}` in hosting/js/lib/route.js). */
export function dashboardLink(dashboardUrl: string, patientId: string): string {
  return `${dashboardUrl.replace(/\/+$/, "")}/#/patient/${encodeURIComponent(patientId)}`;
}

/**
 * The dashboard's base URL: `DASHBOARD_URL` when set, otherwise the project's default Firebase
 * Hosting site (`https://<project>.web.app`), where `firebase deploy --only hosting` puts it.
 * "" when neither is known.
 */
export function resolveDashboardUrl(configured: string, projectId: string | undefined): string {
  const url = configured.trim().replace(/\/+$/, "");
  if (url) return url;
  return projectId ? `https://${projectId}.web.app` : "";
}
