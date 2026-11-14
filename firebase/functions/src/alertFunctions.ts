// The red flag alert (issue #22): `redFlagAlert` runs when any document is created in
// `patients/{patientId}/flags/{flagId}` and, for a red flag the Clinician may see, writes one email
// to the top-level `mail` collection, which the Firebase Trigger Email extension sends.
//
// Whether to send and what to say is decided by the pure `alertDecision` in alerts.ts. This file
// only reads the Patient record (the Clinician's address and the sharing state as it is now) and
// writes `mail/{mailIdFor(patientId, flagId)}` with `create()`. Firestore triggers are delivered at
// least once, and this one is retried on failure, so the fixed id keeps it to one email per flag:
// a second delivery finds the document and stops.
//
// Every red flag emails, whoever raises it (the phone's crisis tool, Finish Check-in's Decisions
// backstop, the phone's daily job, the hourly silence check #28); none of them sends mail itself.
// The one limit is MAX_RED_FLAG_EMAILS_PER_HOUR per Patient (limits.ts): a phone writes its own
// flags, so without it one phone could flood the Clinician's inbox.
//
// Log lines carry the ids, the flag's kind (a contract value, or "other") and the outcome only:
// never the reason, the display name, the address or the email (test/alert-logging.test.ts).
import type { Firestore } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { alertDecision, flagSkip, mailIdFor, resolveDashboardUrl, type AlertSkip } from "./alerts";
import { PATIENT_LIMITS, withEmail } from "./limits";
import { REGION } from "./region";
import { COLLECTIONS, FLAG_KINDS, type Flag, type FlagKind, type MailDoc, type PatientDoc } from "./types";

/**
 * The dashboard's base URL for the link in the email. Not a secret. Empty means the project's
 * default Hosting site, `https://<project>.web.app`. Set it in `firebase/functions/.env.<project>`
 * (`DASHBOARD_URL=https://...`) or answer the prompt on deploy.
 */
export const DASHBOARD_URL = defineString("DASHBOARD_URL", {
  default: "",
  description: "Clinician dashboard base URL for red flag emails. Empty uses https://<project>.web.app.",
});

/** The document the trigger listens on. */
export const FLAG_DOCUMENT = `${COLLECTIONS.patients}/{patientId}/${COLLECTIONS.flags}/{flagId}`;

/** What the alert reads and writes. */
export interface AlertStore {
  getPatient(patientId: string): Promise<Partial<PatientDoc> | undefined>;
  /**
   * Creates `mail/{id}` and counts it in `patientLimits/{patientId}`, in one transaction. Writes
   * nothing when the document already exists (`duplicate`) or the Patient has reached the hourly
   * cap (`capped`, see `withEmail`).
   */
  createMail(id: string, mail: MailDoc, patientId: string, nowMillis: number): Promise<"sent" | "duplicate" | "capped">;
}

/** The Admin SDK store used in production and in the emulator tests. */
export function adminAlertStore(db: Firestore): AlertStore {
  return {
    async getPatient(patientId) {
      const snapshot = await db.collection(COLLECTIONS.patients).doc(patientId).get();
      return snapshot.exists ? (snapshot.data() as Partial<PatientDoc>) : undefined;
    },
    async createMail(id, mail, patientId, nowMillis) {
      const mailRef = db.collection(COLLECTIONS.mail).doc(id);
      const limitsRef = db.collection(PATIENT_LIMITS).doc(patientId);
      return db.runTransaction(async (tx) => {
        const [existing, limits] = await Promise.all([tx.get(mailRef), tx.get(limitsRef)]);
        if (existing.exists) return "duplicate";
        const emails = withEmail(limits.get("redFlagEmailsAtMillis"), nowMillis);
        if (emails === null) return "capped";
        tx.create(mailRef, mail);
        tx.set(limitsRef, { redFlagEmailsAtMillis: emails }, { merge: true });
        return "sent";
      });
    },
  };
}

/** The flag's kind if it is a contract value, otherwise "other": safe to log either way. */
export type LoggedKind = FlagKind | "other";

export type AlertOutcome =
  | { outcome: "sent"; kind: LoggedKind }
  | { outcome: "duplicate"; kind: LoggedKind }
  /** The Patient has reached the hourly email cap. The flag is recorded and shows on the dashboard. */
  | { outcome: "capped"; kind: LoggedKind }
  | { outcome: "skipped"; skip: AlertSkip; kind: LoggedKind };

export interface FlagCreated {
  patientId: string;
  flagId: string;
  /** The created flag's data, or undefined when the event carried none. */
  flag: Partial<Flag> | undefined;
}

export interface AlertDeps {
  store: AlertStore;
  dashboardUrl: string;
  clock?: () => number;
}

function loggedKind(kind: unknown): LoggedKind {
  return (FLAG_KINDS as readonly unknown[]).includes(kind) ? (kind as FlagKind) : "other";
}

/**
 * Decides and writes the email for one created flag. Reads the Patient record only for a red,
 * uncleared, shared flag. A failed read or write throws, so the trigger is retried.
 */
export async function redFlagAlertHandler(event: FlagCreated, deps: AlertDeps): Promise<AlertOutcome> {
  const kind = loggedKind(event.flag?.kind);
  // Decide on the flag alone first, so an amber or green flag costs no read.
  const early = flagSkip(event.flag);
  if (early) return { outcome: "skipped", skip: early, kind };

  const patient = await deps.store.getPatient(event.patientId);
  const decision = alertDecision(event.flag, patient, { patientId: event.patientId, dashboardUrl: deps.dashboardUrl });
  if ("skip" in decision) return { outcome: "skipped", skip: decision.skip, kind };

  // The flag's reason and the Patient's name are written by the phone, and a phone can create any
  // number of flags, so the emails one record can cause are capped.
  const outcome = await deps.store.createMail(mailIdFor(event.patientId, event.flagId), decision.mail, event.patientId, (deps.clock ?? Date.now)());
  return { outcome, kind };
}

/** How the trigger gets its dependencies, built per event so parameters are read at run time. */
export interface AlertDepsFactory {
  store: () => AlertStore;
  dashboardUrl: () => string;
}

/** Builds the trigger. Production passes the Admin SDK and `DASHBOARD_URL`; tests pass fakes. */
export function createAlertFunctions(deps: AlertDepsFactory) {
  const redFlagAlert = onDocumentCreated({ document: FLAG_DOCUMENT, region: REGION, retry: true }, async (event) => {
    const { patientId, flagId } = event.params;
    const flag = event.data?.data() as Partial<Flag> | undefined;
    let result: AlertOutcome;
    try {
      result = await redFlagAlertHandler({ patientId, flagId, flag }, { store: deps.store(), dashboardUrl: deps.dashboardUrl() });
    } catch (error) {
      // Only where it stopped: an error's message or body could carry the data.
      const code = (error as { code?: unknown })?.code;
      logger.error("redFlagAlert: failed, will retry", { patientId, flagId, kind: loggedKind(flag?.kind), code: typeof code === "number" || typeof code === "string" ? code : null });
      throw new Error("redFlagAlert failed");
    }
    logger.info("redFlagAlert", { patientId, flagId, ...result });
  });
  return { redFlagAlert };
}

/** `DASHBOARD_URL`, or the project's Hosting site when it is empty. */
export function dashboardUrlFromParams(): string {
  return resolveDashboardUrl(DASHBOARD_URL.value(), process.env.GCLOUD_PROJECT);
}
