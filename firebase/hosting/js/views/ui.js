// Shared pieces of the design system's DOM: the level word with its dot (colour is never the only
// cue), and the blank state used for empty, no-match and error views.
import { DESIGN_LEVELS } from "../lib/design-model.js";

/**
 * The level word with its dot (`Flag` in design/clinician/src/App.jsx).
 * @param {string} level red, amber, green, unknown or hidden
 * @param {string} [word] defaults to the design's level word (`DESIGN_LEVELS`)
 */
export function flagChip(level, word) {
  const chip = document.createElement("span");
  chip.className = `flag ${level}`;
  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  chip.append(dot, word ?? DESIGN_LEVELS[/** @type {keyof typeof DESIGN_LEVELS} */ (level)] ?? level);
  return chip;
}

/**
 * A centred blank state: a heading, a line and an optional action.
 * @param {string} title @param {string} text @param {HTMLElement | null} [action] @param {number} [level] heading level
 */
export function blankState(title, text, action = null, level = 2) {
  const box = document.createElement("div");
  box.className = "blank-state";
  const heading = document.createElement(`h${level}`);
  heading.textContent = title;
  const line = document.createElement("p");
  line.className = "muted";
  line.textContent = text;
  box.append(heading, line);
  if (action) box.append(action);
  return box;
}
