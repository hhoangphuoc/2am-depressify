// Alerts for a new red flag: a screen-reader announcement always, and a short chime when the
// Clinician has turned sound on. Sound is off until an explicit click; the first load never plays
// it (js/lib/banner.js decides what is new). The chime is generated with WebAudio, so there is no
// audio file. If the browser blocks playback, the banner is untouched and a note says how to allow it.
// The switch is the design's checkbox under the Patient list ("Sound for red flags").
import { readSoundPreference, shouldChime, writeSoundPreference } from "./lib/sound-pref.js";

const COPY = {
  unsupported: "This browser cannot play the sound.",
  notSaved: "Sound is on for this visit only; the browser would not remember the choice.",
  blocked: "The browser blocked the sound. Click anywhere on the page to allow it.",
  announce: (/** @type {string} */ name, /** @type {string} */ reason) => `New red flag for ${name}: ${reason}`,
};

const RESUME_WAIT_MILLIS = 500;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** @returns {(typeof AudioContext) | null} */
function audioContextClass() {
  return window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext ?? null;
}

/**
 * @param {{ toggle: HTMLInputElement, note: HTMLElement, announcer: HTMLElement }} elements
 *   `toggle` is a checkbox (role="switch"); its checked state is the sound setting
 */
export function createAlerts({ toggle, note, announcer }) {
  let enabled = readSoundPreference(storage());
  /** @type {AudioContext | null} */
  let context = null;

  function draw() {
    toggle.checked = enabled;
  }

  function setNote(text) {
    note.textContent = text;
    note.hidden = text === "";
  }

  /** Creates or resumes the audio context; true when it can play. Must follow a user gesture to succeed. */
  async function ready() {
    const Context = audioContextClass();
    if (!Context) return false;
    try {
      context ??= new Context();
      if (context.state !== "running") {
        // resume() can stay pending until a gesture, so do not wait on it for long.
        await Promise.race([context.resume(), new Promise((r) => setTimeout(r, RESUME_WAIT_MILLIS))]);
      }
      return context.state === "running";
    } catch {
      return false;
    }
  }

  /** Two soft notes, falling: noticeable without being alarming. */
  function chime() {
    if (!context) return;
    const start = context.currentTime;
    for (const [frequency, offset] of [
      [880, 0],
      [660, 0.2],
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.2, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.4);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.45);
    }
  }

  async function play() {
    if (await ready()) {
      chime();
      setNote("");
      return true;
    }
    setNote(audioContextClass() ? COPY.blocked : COPY.unsupported);
    return false;
  }

  async function onToggle() {
    if (enabled) {
      enabled = false;
      writeSoundPreference(storage(), false);
      setNote("");
      draw();
      return;
    }
    if (!audioContextClass()) {
      setNote(COPY.unsupported);
      draw();
      return;
    }
    enabled = true;
    draw();
    const saved = writeSoundPreference(storage(), true);
    // A sample chime, inside the click, so the Clinician hears what it will sound like.
    const played = await play();
    if (played && !saved) setNote(COPY.notSaved);
  }

  /** With sound remembered from an earlier visit, the first click or key press anywhere unlocks it. */
  function unlockOnGesture() {
    if (!enabled || context?.state === "running") return;
    ready().then((ok) => {
      if (ok && note.textContent === COPY.blocked) setNote("");
    });
  }

  toggle.addEventListener("change", onToggle);
  document.addEventListener("pointerdown", unlockOnGesture, true);
  document.addEventListener("keydown", unlockOnGesture, true);
  draw();

  return {
    /**
     * Called with the red flags that are new since the dashboard loaded.
     * @param {{ displayName: string, reason: string }[]} newFlags
     */
    notify(newFlags) {
      if (newFlags.length === 0) return;
      const first = newFlags[0];
      announcer.textContent = "";
      // A fresh text node so the live region announces even when the text repeats.
      announcer.append(COPY.announce(first.displayName, first.reason));
      if (shouldChime({ enabled, newFlags })) play();
    },
    destroy() {
      toggle.removeEventListener("change", onToggle);
      document.removeEventListener("pointerdown", unlockOnGesture, true);
      document.removeEventListener("keydown", unlockOnGesture, true);
      context?.close().catch(() => {});
    },
  };
}
