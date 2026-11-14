// The Clinician's choice to hear a sound when a red flag arrives. Pure, so `node --test` can run it.
// Sound is off until the Clinician turns it on with a click; the choice is kept in this browser's
// localStorage. Storage can be blocked (private windows, site data off), so every access is
// wrapped and a failure reads as "off".

export const SOUND_KEY = "twoam.dashboard.sound";

/**
 * @param {{ getItem: (key: string) => string | null } | undefined | null} storage
 * @returns {boolean}
 */
export function readSoundPreference(storage) {
  try {
    return storage?.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * @param {{ setItem: (key: string, value: string) => void } | undefined | null} storage
 * @param {boolean} on
 * @returns {boolean} whether the choice was saved
 */
export function writeSoundPreference(storage, on) {
  try {
    if (!storage) return false;
    storage.setItem(SOUND_KEY, on ? "on" : "off");
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ enabled: boolean, newFlags: unknown[] }} input
 * @returns {boolean}
 */
export function shouldChime({ enabled, newFlags }) {
  return enabled && newFlags.length > 0;
}
