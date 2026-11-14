// The Companion's tool declarations, locked into every Live token by Start Check-in (`live.ts`).
//
// The tools run on the phone, where the Patient's data already is; the dispatcher is
// `CompanionTools` in shared/.../voice/live/CompanionTools.kt, which mirrors these names and
// arguments. All are BLOCKING, the only behaviour the #6 spike verified. find_places and
// get_weather go through the mapTool callable (mapTool.ts); suggest_music starts the
// generateMusic callable (music.ts) and returns at once. The calendar is not here: it waits on #19.
import { SUGGESTION_KINDS } from "./types";

/** A Live API parameter schema (OpenAPI subset, upper-case types, as recorded in the #6 spike). */
export interface ToolParameterSchema {
  type: "OBJECT" | "STRING" | "INTEGER" | "NUMBER" | "BOOLEAN" | "ARRAY";
  description?: string;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  enum?: string[];
  items?: ToolParameterSchema;
}

/** One entry of `tools[].functionDeclarations` in the token's `bidiGenerateContentSetup`. */
export interface FunctionDeclaration {
  name: string;
  description: string;
  /** The spike verified BLOCKING only. */
  behavior?: "BLOCKING" | "NON_BLOCKING";
  parameters: ToolParameterSchema;
}

/** The name of the crisis tool. The safety rule in the system instruction names it. */
export const RAISE_CRISIS_TOOL = "raise_crisis";

const NO_ARGUMENTS: ToolParameterSchema = { type: "OBJECT", properties: {} };

/** The tools every Check-in is locked to. */
export const LIVE_TOOL_DECLARATIONS: readonly FunctionDeclaration[] = (
  [
    {
      name: "get_patient_context",
      description: "Background about this person and whether this is their first Check-in. Call once, before greeting.",
      parameters: NO_ARGUMENTS,
    },
    {
      name: "get_health_summary",
      description: "The person's recent daily Signals (sleep, steps, heart rate, time at home) compared with their own usual, in words. Call before greeting.",
      parameters: { type: "OBJECT", properties: { days: { type: "INTEGER", description: "How many recent days, 1 to 14." } }, required: ["days"] },
    },
    {
      name: "get_recent_summaries",
      description: "Summaries of the person's most recent Check-ins, newest first.",
      parameters: { type: "OBJECT", properties: { count: { type: "INTEGER", description: "How many, 1 to 5." } }, required: ["count"] },
    },
    {
      name: "get_last_suggestion",
      description: "The Suggestion made at the previous Check-in, so you can ask how it went.",
      parameters: NO_ARGUMENTS,
    },
    {
      name: "record_suggestion",
      description: "Record the one Suggestion you are offering in this Check-in. Call as you offer it; the person sees it as a card.",
      parameters: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: [...SUGGESTION_KINDS] },
          details: { type: "STRING", description: "One short sentence, for example 'Ten minutes outside tomorrow morning'." },
        },
        required: ["kind", "details"],
      },
    },
    {
      name: "suggest_music",
      description: "Start making about a minute of calm instrumental music for the person, matched to how they feel. It is ready on their screen in about half a minute, with a play button. Call when you suggest music, then tell them it is on its way. Never say it has finished or describe how it sounds.",
      parameters: { type: "OBJECT", properties: { mood: { type: "STRING", description: "How they feel, in their own plain terms, for example 'tired and tense after a long week'. No names." } }, required: ["mood"] },
    },
    {
      name: "find_places",
      description: "Find real places of one kind near the person, from Google Maps, nearest first, with the minutes on foot when known. The person sees them as a card with links. Call when you suggest going somewhere. Name only places it returns; if it returns none or an error, suggest the kind of place without a name.",
      parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "The kind of place, for example 'park', 'yoga studio' or 'health clinic'." } }, required: ["query"] },
    },
    {
      name: "get_weather",
      description: "The current weather where the person is, from Google, and whether it suits a walk. Call before you suggest anything outdoors. The person sees it as a card.",
      parameters: NO_ARGUMENTS,
    },
    {
      name: RAISE_CRISIS_TOOL,
      description: "Call at once if the person mentions thoughts of harming themselves. Shows the help buttons on their screen.",
      parameters: { type: "OBJECT", properties: { reason: { type: "STRING", description: "One plain sentence." } }, required: ["reason"] },
    },
  ] satisfies FunctionDeclaration[]
).map((tool) => ({ ...tool, behavior: "BLOCKING" as const }));
