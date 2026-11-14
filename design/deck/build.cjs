// Builds the screen deck: captures every patient and clinician state through deep links,
// writes design/deck/index.html and exports design/deck/depressify-screens.pdf. Needs both dev servers running.
const fs = require('fs'), path = require('path');
const { chromium } = require('../patient/node_modules/@playwright/test');
const OUT = __dirname, SHOTS = path.join(OUT, 'shots'), QA = path.join(OUT, '..', 'qa');
const P = 'http://127.0.0.1:5173/?', C = 'http://127.0.0.1:5174/?';

const patient = [
  ['First use', 'One plain promise, then a real choice about sharing. Declining never blocks the app.', [
    ['welcome', 'Welcome', 'Wellbeing support, not treatment.', 'scenario=first'],
    ['sharing', 'Sharing choice', 'Continue without sharing is equal weight.', 'screen=sharing'],
    ['intro', 'Before the first Check-in', 'AI disclosure and what happens to the conversation.', 'screen=intro'],
    ['mic-declined', 'Microphone declined', 'Typing is offered at once.', 'scenario=permission'],
  ]],
  ['Today', 'One invitation. The greeting follows the time of day; after 22:00 the app turns dark and softer.', [
    ['today', 'Today · morning', 'Check-in card with Talk and Type, then the week.', 'screen=today'],
    ['today-night', 'Today · 02:00', 'Night theme, gentler words.', 'screen=today&hour=2'],
    ['today-empty', 'No history yet', 'No empty dashboard, just a start.', 'scenario=empty'],
    ['nudge', 'Nudge', 'At most once a day; nothing private on the lock screen.', 'scenario=nudge'],
  ]],
  ['Progress and places', 'What was done is counted; nothing is marked as missed. Places for a next small step sit on a map.', [
    ['today-places', 'Places near you', 'Park, yoga and meditation, one tap to Google Maps.', 'screen=today&y=470'],
    ['today-places-night', 'Places at night', 'The same card in the night theme.', 'screen=today&hour=2&y=470'],
    ['history-path', 'Your path', 'Check-ins as steps on one line.', 'screen=history&y=420'],
    ['signals-more', 'More Signals', 'Places, Your day and Check-ins groups.', 'screen=signals&y=560'],
  ]],
  ['Voice Check-in · Gemini Live', 'A real-time voice session. The orb is the only focal point; its colour shows who is talking and its size follows the audio. The live caption is always on.', [
    ['live-connecting', 'Connecting', 'Short-lived token, then setupComplete.', 'screen=check&at=0'],
    ['live-speaking', 'Companion speaking', 'Words appear as the transcript streams. Tap the orb to interrupt.', 'screen=check&at=1'],
    ['live-listening', 'Listening', 'The orb follows the microphone level.', 'screen=check&at=2'],
    ['live-noted', 'Outcome noted', 'What the Companion records is shown plainly.', 'screen=check&at=5'],
  ]],
  ['Voice Check-in · one idea', 'Tool calls run quietly, then one Suggestion arrives as a card the Patient can accept by voice or touch.', [
    ['live-thinking', 'Looking something up', 'Weather and places tool call.', 'screen=check&at=7'],
    ['live-offer', 'One Suggestion', 'That works · Something smaller · Not now.', 'screen=check&at=8'],
    ['live-smaller', 'Something smaller', 'The proposal shrinks; no pressure.', 'screen=check&at=10&reply=smaller'],
    ['live-accepted', 'Chosen', 'Optional calendar booking, then wrap up.', 'screen=check&at=11&reply=accept'],
  ]],
  ['Voice Check-in · interruptions', 'Every break in the session keeps what was said and offers one calm way on.', [
    ['live-muted', 'Microphone off', 'Paused orb; typing stays one tap away.', 'screen=check&at=6&mute=1'],
    ['live-lost', 'Connection lost', 'Retry, or finish with what we have.', 'scenario=connect&screen=check&at=3'],
    ['live-late', 'Near the time limit', 'Target 3 minutes, cap about 8.', 'scenario=late&screen=check&at=8'],
    ['live-night', 'Voice at night', 'Same session in the night theme.', 'screen=check&at=8&hour=2'],
  ]],
  ['Typed, booking and pauses', 'The same conversation by text, an explicit agreement before anything reaches the calendar, and a calm pause.', [
    ['typed', 'Typed Check-in', 'Transcript with gentle answer choices.', 'screen=check&typed=1'],
    ['booking', 'Add to calendar', 'Date, time and duration, validated.', 'screen=check&at=11&reply=accept&sheet=booking'],
    ['suggestion', 'Suggestion detail', 'Place sources from Google Maps.', 'screen=suggestion'],
    ['paused', 'Check-in paused', 'After a call or app switch; resume when ready.', 'scenario=background&screen=check&at=3'],
  ]],
  ['Finishing and Summary', 'Three optional ratings, then the same Summary the Clinician reads.', [
    ['ratings', 'Ratings', 'Skip is always there; skipped stays unanswered.', 'screen=ratings'],
    ['finishing', 'Making the Summary', 'Leave without a Summary is possible.', 'screen=finishing'],
    ['summary', 'Summary', 'How you felt, the next small step, no transcript.', 'screen=summary'],
    ['summary-fail', 'Summary failure', 'Never invents success.', 'scenario=summary-fail'],
  ]],
  ['History', 'A calm record. Missing days are gaps, never zero.', [
    ['history', 'History', 'Week row, trend card and the path of Check-ins.', 'screen=history'],
    ['history-empty', 'No history', 'Illustration and one action.', 'scenario=empty&screen=history'],
    ['offline', 'Offline', 'Saved content stays readable.', 'scenario=offline'],
    ['history-night', 'History at night', 'Chart colours follow the theme.', 'screen=history&hour=23'],
  ]],
  ['Settings and Consent', 'Each Signal has its own Consent, and stopping deletes what was collected.', [
    ['settings', 'Settings', 'Four plain rows.', 'screen=settings'],
    ['signals', 'Signals', 'Grouped cards with icon, value and On or Off.', 'screen=signals'],
    ['signal', 'Signal detail', 'Why it helps and where it comes from.', 'screen=signal&signal=sleep'],
    ['delete', 'Stop and delete', 'States plainly that it cannot be undone.', 'screen=signal&signal=sleep&sheet=delete'],
  ]],
  ['Privacy, quiet hours and support', 'Sharing can be withdrawn at any time. Help is human and the app never dials.', [
    ['privacy', 'Sharing and privacy', 'AI processing and retention, in plain words.', 'screen=privacy'],
    ['withdraw', 'Stop sharing', 'Explains what the Clinician loses.', 'screen=privacy&sheet=withdraw'],
    ['quiet', 'Quiet hours', 'No Nudges overnight.', 'screen=quiet'],
    ['baseline', 'Building a Baseline', 'Five valid days before comparisons.', 'scenario=baseline'],
  ]],
  ['Crisis', 'Appears before any network call. The Patient places the call; the app never does.', [
    ['support', 'Support', 'The Companion is not monitored continuously.', 'screen=support'],
    ['crisis', 'Crisis notice', 'Two human options and a quiet way back.', 'scenario=crisis'],
    ['dialler', 'Simulated dialler', 'Demo number only.', 'scenario=crisis&sheet=dialler'],
    ['crisis-night', 'Crisis at night', 'Same calm layout, dark.', 'scenario=crisis&hour=3'],
  ]],
];

const clinician = [
  ['Patients', 'People and reasons first. Red, then amber, then green. Each row shows the last 14 nights of sleep against the Patient’s own Baseline, with hatched days where there is no data.', [
    ['c-list', 'Patient list with a red flag', '', ''],
    ['c-filter', 'Filtered to amber', '', 'filter=amber'],
    ['c-tablet', 'Tablet · 768', '', '', 768],
    ['c-phone', 'Phone · 390', '', '', 390],
  ]],
  ['Patient', 'One Patient, four views. The flag explains itself with its source and time.', [
    ['c-elias', 'Overview · red flag', '', 'patient=elias'],
    ['c-mira', 'Overview · amber flag', '', 'patient=mira'],
    ['c-summaries', 'Summaries and Digest', '', 'patient=elias&tab=Summaries'],
    ['c-signals', 'Signals against Baseline', '', 'patient=elias&tab=Signals'],
    ['c-intake', 'Intake and Visits', '', 'patient=elias&tab=Intake%20%26%20Visits'],
  ]],
  ['Actions', 'Recording a Visit never changes the flag. Clearing a flag keeps its history.', [
    ['c-visit', 'Record a Visit', '', 'patient=elias&modal=visit'],
    ['c-clear', 'Clear the Attention flag', '', 'patient=elias&modal=clear'],
    ['c-history', 'Flag history', '', 'patient=elias&modal=history'],
    ['c-intake-modal', 'Add fictional Intake', '', 'patient=elias&modal=intake'],
  ]],
  ['States', 'Every failure says what is still true and offers one way on.', [
    ['c-silence', 'Phone silent for 24 hours', '', 'state=silence'],
    ['c-consent', 'Consent withdrawn', '', 'state=consent'],
    ['c-baseline', 'Building a Baseline', '', 'state=baseline'],
    ['c-unavailable', 'Signal unavailable', '', 'state=unavailable'],
    ['c-assessment', 'Assessment unknown', '', 'state=assessment'],
    ['c-genfail', 'Digest generation failed', '', 'state=generationfail'],
    ['c-offline', 'Offline', '', 'state=offline'],
    ['c-loading', 'Loading', '', 'state=loading'],
    ['c-empty', 'No Patients yet', '', 'state=empty'],
    ['c-denied', 'No access', '', 'state=denied'],
    ['c-signin', 'Session expired', '', 'state=expired'],
  ]],
];

const QA_KEYS = { today: 'patient-today-screen', 'live-offer': 'patient-voice-offer-screen', 'live-speaking': 'patient-voice-speaking-screen', 'today-night': 'patient-today-night-screen' };

// node build.cjs peek 3 5 → screenshot existing slides to /private/tmp/peek-N.png without recapturing.
async function peek(ns) { const b = await chromium.launch(); const d = await b.newPage({ viewport: { width: 1600, height: 900 } }); await d.goto('file://' + path.join(OUT, 'index.html')); await d.waitForTimeout(500); for (const n of ns) { await d.evaluate(k => document.querySelectorAll('.slide')[k].scrollIntoView(), n); await d.screenshot({ path: '/private/tmp/peek-' + n + '.png' }); } await b.close(); }
if (process.argv[2] === 'peek') { peek(process.argv.slice(3).map(Number)).then(() => console.log('peeked')); return; }
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const phone = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2 });
  phone.on('pageerror', e => errors.push('patient: ' + e.message));
  for (const [, , shots] of patient) for (const [id, , , q] of shots) {
    await phone.goto(P + q + (q.includes('hour=') ? '' : '&hour=10')); await phone.waitForTimeout(q.includes('sheet=') ? 1500 : 1000);
    const y = /[?&]y=(\d+)/.exec(q); if (y) { await phone.evaluate(v => { const el = document.querySelector('.mobile-scroll'); if (el) el.scrollTop = v; }, Number(y[1])); await phone.waitForTimeout(300); }
    const screen = phone.getByTestId('device-screen'), box = await screen.boundingBox();
    if (Math.abs(box.width - 393) > 1 || Math.abs(box.height - 852) > 1) throw new Error(id + ' screen scaled: ' + box.width + 'x' + box.height);
    await phone.getByTestId('phone-frame').screenshot({ path: path.join(SHOTS, id + '.png') });
    if (QA_KEYS[id]) await screen.screenshot({ path: path.join(QA, QA_KEYS[id] + '.png') });
  }
  for (const [, , shots] of clinician) for (const [id, , , q, width] of shots) {
    const page = await browser.newPage({ viewport: { width: width || 1440, height: width === 390 ? 844 : width === 768 ? 1024 : 960 }, deviceScaleFactor: width ? 2 : 1.5 });
    page.on('pageerror', e => errors.push('clinician: ' + e.message));
    await page.goto(C + q); await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, id + '.png') });
    await page.close();
  }
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const slides = [];
  slides.push('<section class="slide cover"><p class="kicker">Depressify · Small Step</p><h1>Patient app and<br>Clinician dashboard</h1><p class="lede">Every screen and state, including the Gemini Live voice Check-in. Synthetic data; no live services.</p><p class="meta">' + patient.reduce((n, s) => n + s[2].length, 0) + ' patient screens · ' + clinician.reduce((n, s) => n + s[2].length, 0) + ' dashboard screens · 13 November 2026</p></section>');
  slides.push('<section class="slide divider"><p class="kicker">Part 1</p><h1>Patient app</h1><p class="lede">iPhone 393 × 852. One main action per screen. Patients never see Attention flags or scores.</p></section>');
  for (const [title, desc, shots] of patient) slides.push('<section class="slide"><header><h2>' + esc(title) + '</h2><p>' + esc(desc) + '</p></header><div class="phones">' + shots.map(([id, label, note]) => '<figure><img src="shots/' + id + '.png" alt="' + esc(label) + '"><figcaption><strong>' + esc(label) + '</strong><span>' + esc(note) + '</span></figcaption></figure>').join('') + '</div></section>');
  slides.push('<section class="slide"><header><h2>Voice session states</h2><p>Each state maps to an event in the Gemini Live API. The orb changes colour on every state, including under Reduce Motion, where its size stays still.</p></header><table class="map"><thead><tr><th>State</th><th>Live API event</th><th>What the Patient sees</th></tr></thead><tbody>' + [['Connecting','Ephemeral token, setupComplete','Still orb, “Connecting”'],['Speaking','Model audio + outputTranscription','Warm orb sized by output level; caption streams word by word'],['Listening','Mic stream + inputTranscription','Teal orb sized by mic level; caption under “You”'],['One moment','toolCall (weather, places, calendar, health)','Blue orb with a thin arc; the tool is named'],['Interrupted','serverContent.interrupted','Playback stops at once; back to listening'],['Microphone off','audioStreamEnd','Grey orb; typing offered'],['Connection lost','Socket closed','Retry, or finish with what we have'],['Wrap up','Client timer: target 3 min, cap ~8','One line, then ratings'],['Crisis','Raise-crisis tool','Crisis notice before any network call']].map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></section>');
  slides.push('<section class="slide divider"><p class="kicker">Part 2</p><h1>Clinician dashboard</h1><p class="lede">Desktop 1440, with tablet and phone layouts. Same Summary as the Patient; never transcripts or audio.</p></section>');
  for (const [title, desc, shots] of clinician) shots.forEach(([id, label, , , width], i) => {
    if (width) { if (width === 768) slides.push('<section class="slide"><header><h2>' + esc(title) + ' · smaller screens</h2><p>The sidebar folds; freshness moves into each row.</p></header><div class="phones wide">' + shots.filter(s => s[4]).map(([sid, sl]) => '<figure><img src="shots/' + sid + '.png" alt="' + esc(sl) + '"><figcaption><strong>' + esc(sl) + '</strong></figcaption></figure>').join('') + '</div></section>'); return; }
    slides.push('<section class="slide"><header><h2>' + esc(title) + ' · ' + esc(label) + '</h2><p>' + (i === 0 ? esc(desc) : '') + '</p></header><div class="desk"><img src="shots/' + id + '.png" alt="' + esc(label) + '"></div></section>');
  });
  slides.push('<section class="slide"><header><h2>Decisions from the Claude Design artifacts</h2><p>Two artifact boards (patient flow and clinician dashboard) were reviewed against the requirements.</p></header><table class="map"><thead><tr><th>Idea</th><th>Decision</th></tr></thead><tbody><tr><td>Voice orb with a live caption and step marker</td><td>Adopted, with an always-on caption (no captions toggle)</td></tr><tr><td>Time-of-day greeting and a night theme</td><td>Adopted</td></tr><tr><td>14-day sleep sparkline with hatched missing days</td><td>Adopted in the list and the Signal charts</td></tr><tr><td>Crisis and No data as extra flag levels</td><td>Not adopted: three flag levels (ADR 0009)</td></tr><tr><td>BDI and HAM-D discharge scores</td><td>Not adopted: PHQ-2 and PHQ-9 at Visits</td></tr><tr><td>Export report and Log a call</td><td>Not adopted: not in the requirements</td></tr><tr><td>Voice-feature charts (pitch, pace, pauses)</td><td>Not adopted: on-phone voice analysis is a stretch goal</td></tr><tr><td>Microphone permission during onboarding</td><td>Not adopted: asked at first Check-in, with typing as the fallback</td></tr><tr><td>Did the walk help? on Today</td><td>Not adopted: the Outcome is asked in the next Check-in</td></tr></tbody></table></section>');
  slides.push('<section class="slide"><header><h2>Today · first target and current build</h2><p>The first Small Step target on the left, the current Today screen on the right. After review the build moved to health-style cards: a Check-in card with the date, a week row and a places map.</p></header><div class="phones compare"><figure class="flat"><img src="../patient/reference/small-step-refined.png" alt="Selected visual target"><figcaption><strong>First target</strong><span>852 × 1846 source image</span></figcaption></figure><figure class="flat"><img src="../qa/patient-today-screen.png" alt="Built Today screen"><figcaption><strong>Build</strong><span>393 × 852 CSS px at 2×</span></figcaption></figure></div></section>');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Depressify · Screen deck</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + fs.readFileSync(path.join(OUT, 'deck.css'), 'utf8') + '</style></head><body>' + slides.join('\n') + '</body></html>';
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  const deck = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await deck.goto('file://' + path.join(OUT, 'index.html')); await deck.waitForTimeout(800);
  await deck.pdf({ path: path.join(OUT, 'depressify-screens.pdf'), width: '1600px', height: '900px', printBackground: true });
  for (const [n, i] of [[0, 'cover'], [4, 'voice'], [slides.length - 2, 'compare'], [slides.length - 1, 'today-compare']]) { await deck.evaluate(k => document.querySelectorAll('.slide')[k].scrollIntoView(), n); await deck.screenshot({ path: path.join(QA, 'deck-' + i + '.png') }); }
  await browser.close();
  console.log(JSON.stringify({ slides: slides.length, errors }));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
