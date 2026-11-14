// The Companion's tool declarations, locked into every Live token by Start Check-in (`live.ts`).
//
// SEAM FOR #17. The spec's ten tools are declared once in `core` (`ToolCatalog`) and exported to
// `test/fixtures/tool-catalog.json`; #17 replaces the empty list below with declarations built
// from that catalog and adds the test that compares the two. Until then a Check-in is locked to no
// tools: the phone has no dispatcher yet (#17), and a declared tool that nobody answers would stall
// a BLOCKING call. Nothing else changes when the list fills: the token body, the field mask and the
// crisis rule in the system instruction all read it from here.

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

/** The name of the crisis tool in the spec's catalog. The safety rule names it once it is declared. */
export const RAISE_CRISIS_TOOL = "raise_crisis";

/** The tools every Check-in is locked to. Empty until #17 exports the real catalog. */
export const LIVE_TOOL_DECLARATIONS: readonly FunctionDeclaration[] = [];
