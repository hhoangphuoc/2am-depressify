# Check-in session cards

Native Operate mode: extend the established Small Step UI for typing and voice.
Keep the approved cream, ink, soft-blue and teal visual world and existing design files.
The [interface design](interface-design.md) supplies visual intent; current native sources own implementation details below.

## Components and token reuse

- [CheckInScreen](../../shared/src/commonMain/kotlin/app/depressify/shared/screens/CheckInScreens.kt) owns one in-memory player above the typing/voice split, shared across both modes.
- [SessionToolCards](../../shared/src/commonMain/kotlin/app/depressify/shared/screens/SessionCards.kt) renders embedded music first, then the other tool cards newest first; both modes use this component.
- `MusicSuggestionCard` is a compact artwork row with generation/readiness status, a listening-session entry point and suggestion actions.
- `MusicListeningScreen` presents a full-screen player over the Check-in. It reuses the existing lakeside photo and theme tokens, with a large cover, mood description and fixed playback controls. No decorative waveform, fabricated track name or unsupported skip controls are shown.
- Context tools return health comparisons and recent summaries only to Gemini, without creating session cards. The brief asks Gemini to use them for proactive, relevant suggestions rather than reciting the records.
- History owns the compact recent Check-in and daily signal rows. These load the selected patient's stored records, show the latest mood and recorded daily averages, and exclude days outside the last seven calendar days. Missing values are never filled with zero or a health score.
- Stored summaries populate the History journal; loading and retry states replace unrelated local demo records for connected patients. The fixed-date local demo chart remains limited to offline demo mode.
- Cards reuse `SoftCard`, `Txt`, `TextLink`, `Disclosure` and Phosphor icons. Flat tonal surfaces and compact rows preserve the incumbent hierarchy.
- [Theme.kt](../../shared/src/commonMain/kotlin/app/depressify/shared/ui/theme/Theme.kt) remains the token authority: `ground`, `soft`, `ink`, `onInk`, `muted`, `border`, `accent` and `error`; no duplicate palette is introduced.
- Card titles use `DepressifyType.titleSmall`; content uses `body`, `meta` and `small`. These are the existing system-sans styles, with theme-aware colors and reduced-motion handling.

## Playback and recovery

[MusicPlayback](../../shared/src/commonMain/kotlin/app/depressify/shared/voice/live/MusicPlayback.kt) coordinates the platform player, progress updates and prior microphone state.

| State | Behavior |
| --- | --- |
| Loading | Generation copy explains the wait; preparing playback offers cancel. |
| Ready | Explicit Play starts audio. No autoplay; duration is approximate until the player reports it. |
| Playing | Show measured duration/progress; interrupt companion output, pause companion audio and mute the microphone. |
| Paused | Retain position for Resume. The listening screen keeps the conversation paused; Back restores the prior microphone state. |
| Completed | Stop/reset playback; the conversation stays paused until returning from the listening screen. |
| Error | Generation failure offers regeneration; playback failure offers another Play attempt. Back restores the prior microphone state. |

Mode switches pause playback. App backgrounding pauses and leaves the microphone off; returning does not restart it automatically.
Opening the listening screen pauses the Check-in microphone and Companion audio without autoplay. Back pauses playback, retains position and restores the prior microphone state. The same music card updates in place as generation finishes, including while the listening screen is open. Pausing or completing music keeps the conversation paused until the person returns.
Backgrounding invalidates any saved unmuted state, so Back after returning cannot silently enable the microphone.
Disposal removes the lifecycle observer and stops playback; stopping cancels progress work and invalidates old callbacks.
"That works", "Smaller" and "Not now" pause before sending a response; their shared text actions have Button semantics. Typed replies and other suggestion actions also pause music before continuing the conversation.

## Verification evidence

Reported Android emulator checks: measured duration `1:02`, progress reached `12s`; voice pause retained `14s` and restored listening; resume advanced `2s` to `4s`. Font scale `1.3` wrapped.
The final emulator pass verified that Smaller paused a playing clip at `0:28 / 1:04` in typing mode, and Not now paused it at `0:29 / 1:04` in voice mode and restored Listening. The action semantics expose commands, without a selected or checkable state.
All 29 shared tests pass, including context-only tool responses, stored History loading/filtering/retry, listening-screen microphone restoration and the background/return/Back sequence. Android builds and iOS simulator compilation pass with `./gradlew :shared:testAndroid :androidApp:assembleDebug :shared:compileKotlinIosSimulatorArm64`.
The full-screen player was checked with a real generated clip of measured duration `0:58`. Playback advanced to `0:04`; Android Back paused at `0:18`, the compact card showed that position and reopening offered Resume at `0:18` without autoplay.
History was checked on the Android emulator for Aino and Sara. Sara's daily averages show four recorded days for steps and late-night screen time, and three for sleep; missing values do not become zero.
Physical-device audio, iOS playback and dark-theme captures remain unchecked. Activity recreation retains the clip but resets playback position.
