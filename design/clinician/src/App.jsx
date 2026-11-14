import React, { useEffect, useId, useRef, useState } from 'react';
import { ProgressTimeline, SignalTrends, Sparkline } from './Charts.jsx';
import { TODAY, clearFlags, createPatients, dateLabel, daysBetween, effectivePatients, levels, makeDigest, raiseFlag, validateVisit, withdrawSharing } from './data.mjs';

function useSimulation() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const timer = useRef(null);
  const failed = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  function run(task, fail = false, message = 'That did not save. Your changes are still here. Try again.') {
    if (status === 'pending') return;
    setStatus('pending'); setError('');
    timer.current = setTimeout(() => {
      if (fail && !failed.current) { failed.current = true; setError(message); setStatus('error'); }
      else { setStatus('success'); task(); }
    }, 850);
  }
  return { status, error, run };
}

function ErrorText({ children, id }) { return children ? <p id={id} className="error-text" role="alert">{children}</p> : null; }
function Flag({ level }) { return <span className={`flag ${level}`}><span className="status-dot" aria-hidden="true" />{levels[level]}</span>; }
function Blank({ title, children, action, onAction }) { return <div className="blank-state"><h2>{title}</h2>{children && <p className="muted">{children}</p>}{action && <button onClick={onAction}>{action}</button>}</div>; }

function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    (dialog.querySelector('[data-initial-focus]') || dialog.querySelector('input, textarea, button'))?.focus();
    return () => { dialog.close(); if (trigger?.isConnected) trigger.focus(); else document.querySelector('h1')?.focus(); };
  }, []);
  return <dialog className="modal" ref={ref} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-heading"><h2 id={id}>{title}</h2><button className="text-button" aria-label={`Close ${title}`} onClick={onClose}>Close</button></div>
    <p className="small muted modal-disclosure">Synthetic demo · changes stay in this page.</p>{children}
  </dialog>;
}

function VisitForm({ patient, onSave, onClose, fail, offline }) {
  const [form, setForm] = useState({ date: TODAY, type: 'none', score: '' });
  const [validation, setValidation] = useState('');
  const job = useSimulation();
  const change = (key, value) => { setForm(f => ({ ...f, [key]: value, ...(key === 'type' ? { score: '' } : {}) })); setValidation(''); };
  function submit(event) {
    event.preventDefault();
    const message = validateVisit(form) || (patient.tms && form.date < patient.tms ? 'The Visit must be on or after the TMS end date.' : '') || (patient.visits.some(v => v.date === form.date) ? 'A Visit is already recorded on that date. Choose another date.' : '') || (offline ? 'You are offline. Reconnect to save. Your entries are still here.' : '');
    setValidation(message);
    if (message) return;
    job.run(() => onSave({ ...form, id: `visit-${Date.now()}`, score: form.type === 'none' ? null : Number(form.score) }), fail);
  }
  return <form onSubmit={submit} noValidate aria-busy={job.status === 'pending'}>
    <p className="muted">Record a completed Visit and, if available, its Questionnaire score.</p>
    <fieldset disabled={job.status === 'pending'}><label>Visit date<input data-initial-focus type="date" min={patient.tms || undefined} max={TODAY} value={form.date} onChange={e => change('date', e.target.value)} required aria-describedby="visit-error" /></label>
      <label>Questionnaire score <span className="muted">(optional)</span><select value={form.type} onChange={e => change('type', e.target.value)}><option value="none">No score</option><option>PHQ-2</option><option>PHQ-9</option></select></label>
      {form.type !== 'none' && <label>{form.type} score · 0–{form.type === 'PHQ-2' ? 6 : 27}<input type="number" inputMode="numeric" min="0" max={form.type === 'PHQ-2' ? 6 : 27} step="1" value={form.score} onChange={e => change('score', e.target.value)} aria-describedby="visit-error" required /></label>}
    </fieldset>
    <p className="small muted">This records a score already taken. Scores do not affect the Attention flag.</p>
    <ErrorText id="visit-error">{validation || job.error}</ErrorText>
    <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={job.status === 'pending'}>{job.status === 'pending' ? 'Saving…' : job.error ? 'Try saving again' : 'Save Visit'}</button></div>
  </form>;
}

function ClearFlagForm({ patient, onSave, onClose, fail, offline }) {
  const [acted, setActed] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const job = useSimulation();
  function submit(event) {
    event.preventDefault();
    if (!acted) { setError('Confirm you have acted before clearing the Attention flag.'); return; }
    if (offline) { setError('You are offline. Reconnect to save. Your note is still here.'); return; }
    job.run(() => onSave(note.trim() || 'Clinician confirmed action taken; no additional note.'), fail, 'The flag was not cleared. Your note is still here. Try again.');
  }
  return <form onSubmit={submit} aria-busy={job.status === 'pending'}>
    <p>Clear {patient.activeFlags.length === 1 ? 'this Attention flag' : `all ${patient.activeFlags.length} Attention flags`} after acting on each reason. Every raised reason stays in the history.</p>
    <fieldset disabled={job.status === 'pending'}><label className="checkbox-label"><input data-initial-focus type="checkbox" checked={acted} onChange={e => { setActed(e.target.checked); setError(''); }} />I have checked the situation and taken action.</label>
      <label>Action note <span className="muted">(optional · demo only)</span><textarea rows="3" maxLength="800" value={note} onChange={e => setNote(e.target.value)} placeholder="For example, spoke with Patient and agreed next contact." /></label></fieldset>
    <p className="small muted">Prototype proposal: keep a short local action note. No message is sent.</p>
    <ErrorText>{error || job.error}</ErrorText><div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={job.status === 'pending'}>{job.status === 'pending' ? 'Clearing…' : job.error ? 'Try clearing again' : 'Clear flag after action'}</button></div>
  </form>;
}

function TmsForm({ patient, onSave, onClose, fail, offline }) {
  const [date, setDate] = useState(patient.tms || '');
  const [error, setError] = useState('');
  const job = useSimulation();
  return <form onSubmit={event => {
    event.preventDefault();
    const validation = validateVisit({ date, type: 'none', score: '' });
    if (validation || patient.visits.some(v => v.date < date) || offline) { setError(offline ? 'Reconnect to save. Your date is still here.' : validation ? 'Choose a valid TMS end date on or before 13 Nov 2026.' : 'TMS must end on or before the first recorded Visit.'); return; }
    job.run(() => onSave(date), fail);
  }}><label>TMS end date<input data-initial-focus type="date" max={TODAY} value={date} onChange={e => { setDate(e.target.value); setError(''); }} disabled={job.status === 'pending'} /></label><ErrorText>{error || job.error}</ErrorText><div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={job.status === 'pending'}>{job.status === 'pending' ? 'Saving…' : 'Save TMS end date'}</button></div></form>;
}

function IntakeForm({ onSave, onClose, fail, generationFail, offline }) {
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [highlights, setHighlights] = useState(null);
  const [error, setError] = useState('');
  const extract = useSimulation();
  const save = useSimulation();
  const reading = useRef(0);
  useEffect(() => () => { reading.current += 1; }, []);
  const pending = extract.status === 'pending' || save.status === 'pending';
  async function readFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(''); setHighlights(null); setFilename(''); setText('');
    const request = ++reading.current;
    if (file.size > 100000 || (!file.name.toLowerCase().endsWith('.txt') && !file.name.toLowerCase().endsWith('.md'))) { setError('Choose a fictional .txt or .md report under 100 KB, or paste text.'); event.target.value = ''; return; }
    try { const value = await file.text(); if (request === reading.current) { setText(value); setFilename(file.name); } }
    catch { if (request === reading.current) setError('The file could not be read. Try again or paste text.'); }
  }
  function extractReport(event) {
    event.preventDefault();
    if (!text.trim()) { setError('Add a fictional report before extracting highlights.'); return; }
    if (offline) { setError('Reconnect to simulate extraction. Your report is still here.'); return; }
    setError('');
    // shortcut: sentence splitting stands in for extraction; replace it when a real, authorised service exists.
    extract.run(() => setHighlights(text.trim().split(/(?:\n+|(?<=[.!?])\s+)/).map(s => s.trim()).filter(Boolean).slice(0, 4)), generationFail, 'Extraction did not finish. Your report is still here. Try extraction again.');
  }
  return <form onSubmit={extractReport} aria-busy={pending}><p className="muted">Fictional reports only. Text and files stay in this page.</p>
    {!highlights ? <><fieldset disabled={pending}><label>Report text<textarea data-initial-focus rows="6" maxLength="100000" value={text} onChange={e => { reading.current += 1; setText(e.target.value); setFilename(''); setError(''); }} placeholder="Paste a fictional Intake report…" /></label><label>Or choose a text file<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={readFile} /></label>{filename && <p className="small muted">{filename} · local file</p>}<button type="button" className="text-button" onClick={() => { reading.current += 1; setText('TMS course ended on 2 October 2026. Enjoys quiet walks and music. Prefers small, manageable activities. Keeps in touch with a friend.'); setFilename(''); setError(''); }}>Use fictional example</button></fieldset><ErrorText>{error || extract.error}</ErrorText><div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={pending}>{pending ? 'Extracting…' : extract.error ? 'Try extraction again' : 'Extract highlights'}</button></div></> : <><h3>Extracted highlights</h3><p className="small muted">Simulated extraction · review before saving</p><ul className="highlights">{highlights.map((h, i) => <li key={i}>{h}</li>)}</ul><ErrorText>{error || save.error}</ErrorText><div className="dialog-actions"><button type="button" onClick={() => setHighlights(null)} disabled={pending}>Back to report</button><button className="primary" type="button" disabled={pending} onClick={() => { if (offline) { setError('Reconnect to save. Your highlights are still here.'); return; } save.run(() => onSave({ date: TODAY, highlights }), fail); }}>{pending ? 'Saving…' : save.error ? 'Try saving again' : 'Save Intake'}</button></div></>}
  </form>;
}

function FlagHistory({ patient }) {
  const history = patient.history;
  return <div className="history-list">{history.map(item => <article key={item.id}><div className="between"><strong>{item.action} · {item.level}</strong><time>{item.date}</time></div><p>{item.reason}</p><p className="small muted">Source: {item.source}</p><p className="small muted">Email: {item.email}</p></article>)}</div>;
}

function SummaryDetail({ summary }) {
  return <article className="summary-detail"><div className="between"><h3>{dateLabel(summary.date)} · {summary.time}</h3><span className="generated">Generated Summary</span></div><p className="small muted">Generated {dateLabel(summary.date)}, {summary.generated} · Helsinki</p><p className="summary-text">{summary.text}</p>
    <dl className="rating-list"><div><dt>Mood rating</dt><dd>{summary.mood}/5</dd></div><div><dt>Energy</dt><dd>{summary.energy}/5</dd></div><div><dt>Sleep quality</dt><dd>{summary.sleep}/5</dd></div></dl>
    <dl className="summary-fields"><div><dt>Themes</dt><dd>{summary.themes.join(', ')}</dd></div><div><dt>Voice cue <span className="muted">· observation</span></dt><dd>{summary.voice}</dd></div><div><dt>Suggestion</dt><dd>{summary.suggestion}</dd></div><div><dt>Previous Outcome · {summary.previousKind}</dt><dd>{summary.tried ? `Tried · reported feeling ${summary.feeling}/5` : 'Not tried · no feeling reported'}</dd></div></dl>
    <p className="small muted">The Patient sees this same Summary. Voice cues are observations.</p>
  </article>;
}

function WhatHelps({ summaries }) {
  return <section className="content-section helps"><h2>What seems to help</h2><p className="muted">Patient reported Outcomes</p><div>{['Walks', 'Music', 'Calling someone'].map(kind => {
    const outcomes = summaries.filter(s => s.previousKind === kind && s.tried && Number.isFinite(s.feeling));
    const average = outcomes.length ? outcomes.reduce((a, s) => a + s.feeling, 0) / outcomes.length : null;
    return <div className="help-row" key={kind}><span>{kind}</span><span>{outcomes.length} reported {outcomes.length === 1 ? 'Outcome' : 'Outcomes'}<small>{average === null ? 'No feeling reported' : `Felt ${average.toFixed(1)}/5 on average`}</small></span></div>;
  })}</div><p className="small muted">These reports show an association, not an effect caused by the activity.</p></section>;
}

function WeeklyDigest({ patient, onUpdate, fail, offline, compact = false }) {
  const job = useSimulation();
  const [error, setError] = useState('');
  const digest = patient.digest;
  const basis = patient.summaries.filter(s => s.date >= '2026-11-07' && s.date <= TODAY);
  const content = digest ? <><p>{digest.text}</p><p className="small muted">Generated {digest.time} · Helsinki · based on {digest.ids.length} Summaries</p><details><summary>View source Summaries</summary><ul>{digest.ids.map(id => { const summary = patient.summaries.find(s => s.id === id); return summary && <li key={id}>{dateLabel(summary.date)}, {summary.time} · {summary.text}</li>; })}</ul></details></> : <p className="muted">No Digest generated for this week yet.</p>;
  return <section className={`digest content-section${compact ? ' compact-digest' : ''}`}>
    <div className="section-heading"><div><h2>Weekly Digest</h2><p className="muted">{compact && digest ? `Generated ${digest.time}` : `7–13 Nov 2026 · ${basis.length} actual Summaries in this demo`}</p></div>
      <button className={compact ? 'text-button' : 'primary'} disabled={job.status === 'pending' || !basis.length} onClick={() => {
        if (offline) { setError('Reconnect to generate. The previous Digest is still available.'); return; }
        setError(''); job.run(() => onUpdate(makeDigest(patient.summaries)), fail, 'The Digest could not be generated. Try again; the previous Digest is unchanged.');
      }}>{job.status === 'pending' ? 'Generating…' : job.error ? 'Try generation again' : 'Generate now'}</button>
    </div>
    <ErrorText>{error || job.error}</ErrorText>
    <div aria-live="polite" aria-busy={job.status === 'pending'}>
      {job.status === 'pending' && <p className="muted">Preparing a Digest from this week’s Summaries…</p>}
      {compact ? <details><summary>Read Digest</summary>{content}</details> : content}
    </div>
  </section>;
}

function SummariesView({ patient, selectedId, setSelectedId, onDigest, state }) {
  const selected = patient.summaries.find(s => s.id === selectedId) || patient.summaries[0];
  return <><section className="content-section"><div className="section-heading"><h2>Check-in Summaries</h2><p className="small muted">Europe/Helsinki</p></div><div className="summary-browser"><div className="summary-list" aria-label="Choose a Summary">{patient.summaries.map(s => <button key={s.id} aria-pressed={selected.id === s.id} onClick={() => setSelectedId(s.id)}><strong>{dateLabel(s.date)}</strong><span>{s.time} · Mood {s.mood}/5</span></button>)}</div><SummaryDetail summary={selected} /></div></section><WeeklyDigest patient={patient} onUpdate={onDigest} fail={state === 'generationfail'} offline={state === 'offline'} /><WhatHelps summaries={patient.summaries} /></>;
}

function Attention({ patient, onHistory, onClear, onRetryAssessment }) {
  const job = useSimulation();
  return <section className={`attention ${patient.level}`} aria-label="Attention flag"><div className="between"><Flag level={patient.level} /><button className="text-button" onClick={onHistory}>View history</button></div>{patient.activeFlags.length > 1 ? <ul className="flag-reasons">{patient.activeFlags.map(flag => <li key={flag.id}><strong>{flag.level === 'red' ? 'Red' : 'Amber'}</strong> · {flag.reason}<span className="small muted">Observed {flag.observed} · {flag.source}</span></li>)}</ul> : <p>{patient.reason}</p>}{patient.assessmentStatus === 'unavailable' && patient.activeFlags.length > 0 && <p className="small">Latest assessment unavailable. Uncleared Attention flags are retained.</p>}{patient.quote && <blockquote>{patient.quote}</blockquote>}<div className="attention-footer"><span className="small muted">{patient.activeFlags.length > 1 ? `${patient.activeFlags.length} uncleared reasons · highest level retained` : `Observed ${patient.observed} · ${patient.source}`}</span>{patient.assessmentStatus === 'unavailable' && <button disabled={job.status === 'pending'} onClick={() => job.run(onRetryAssessment)}>{job.status === 'pending' ? 'Retrying assessment…' : 'Retry automatic assessment'}</button>}{patient.activeFlags.length > 0 && <button onClick={onClear}>Clear flag after action</button>}</div></section>;
}

const stateOptions = [
  ['default', 'Typical view'], ['empty', 'Empty Patient list'], ['nomatches', 'No search matches'], ['loading', 'Loading Patients'], ['offline', 'Offline / stale data'], ['denied', 'Permission denied'], ['expired', 'Session expired'], ['unavailable', 'Signals unavailable'], ['baseline', 'New Baseline (<5 days)'], ['assessment', 'Assessment timed out'], ['newamber', 'New amber · retain red'], ['missingtms', 'TMS end date missing'], ['consent', 'Withdraw sharing Consent (deletes demo data)'], ['generationfail', 'Generation / extraction failure'], ['savefail', 'Save failure'], ['silence', 'Red · phone quiet'], ['authfail', 'Sign-in retry'],
];

function PrototypeStates({ state, apply, reset }) {
  return <details className="prototype-states"><summary>Prototype states</summary><div className="prototype-controls"><p className="small muted">Design utility · changes this local prototype. Failures happen once; retry succeeds.</p><label>Simulate a view<select value={state} onChange={e => apply(e.target.value)}>{stateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button onClick={reset}>Reset demo views</button><p className="small muted">Reset keeps withdrawn records deleted. Reload starts a new synthetic dataset. All times: Europe/Helsinki. No real authentication, email or health connection.</p></div></details>;
}

function SignIn({ onSignIn, expired, fail }) {
  const [email, setEmail] = useState('clinician@example.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const job = useSimulation();
  return <div className="signin-wrap"><section className="signin"><span className="wordmark">Depressify</span><p className="muted">Clinician workspace</p><h1>Welcome back</h1>{expired && <p className="notice" role="status">Your demo session expired. Sign in again to continue.</p>}<form noValidate onSubmit={e => {
    e.preventDefault();
    if (email.trim().toLowerCase() !== 'clinician@example.test' || password !== 'smallstep') { setError('Email or password did not match. Use the demo details below and try again.'); return; }
    setError(''); job.run(onSignIn, fail, 'Sign-in could not finish. Your demo details are still here. Try again.');
  }} aria-busy={job.status === 'pending'}><fieldset disabled={job.status === 'pending'}><label>Email<input type="email" autoComplete="username" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby="signin-error" /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby="signin-error" /></label></fieldset><ErrorText id="signin-error">{error || job.error}</ErrorText><button className="primary full-width" disabled={job.status === 'pending'}>{job.status === 'pending' ? 'Signing in…' : job.error ? 'Try signing in again' : 'Sign in'}</button></form><details className="demo-credentials"><summary>Demo sign-in details</summary><p>clinician@example.test<br />Password: smallstep</p><button onClick={() => { setEmail('clinician@example.test'); setPassword('smallstep'); setError(''); }}>Fill demo details</button></details></section></div>;
}

export function App() {
  const [patients, setPatients] = useState(createPatients);
  const [signedIn, setSignedIn] = useState(true);
  const [patientId, setPatientId] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [summaryId, setSummaryId] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState('default');
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState('');
  const [sound, setSound] = useState(false);
  const [soundError, setSoundError] = useState('');
  const pageHeading = useRef(null);
  const all = effectivePatients(patients, state);
  const patient = all.find(p => p.id === patientId);
  const withdrawn = patient?.sharing === 'withdrawn';
  const visible = state === 'empty' ? [] : all;
  const filtered = visible.filter(p => p.name.toLowerCase().includes(query.toLowerCase().trim()) && (filter === 'all' || p.level === filter));
  const reds = visible.filter(p => p.level === 'red');
  useEffect(() => { document.title = `${signedIn && patient ? `${patient.name} · ` : ''}Depressify · Clinician workspace`; }, [patient?.name, signedIn]);
  useEffect(() => { if (signedIn) pageHeading.current?.focus(); }, [patientId, signedIn]);
  function openPatient(id) { setPatientId(id); setTab('Overview'); setSummaryId(null); setNotice(''); }
  function updatePatient(changes) { setPatients(current => current.map(p => p.id === patientId ? { ...p, ...changes } : p)); }
  function closeModal() { setModal(null); }
  async function tone() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('unavailable');
      const context = new Audio(); await context.resume();
      const oscillator = context.createOscillator(), volume = context.createGain();
      oscillator.frequency.value = 540; volume.gain.setValueAtTime(.035, context.currentTime); volume.gain.exponentialRampToValueAtTime(.001, context.currentTime + .25);
      oscillator.connect(volume); volume.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .25); oscillator.onended = () => context.close();
      setSoundError(''); return true;
    } catch { setSoundError('Sound is unavailable in this browser. Written flags remain visible.'); return false; }
  }
  function applyState(next) {
    setState(next); setModal(null); setNotice('');
    if (next === 'consent') setPatients(current => current.map(p => p.id === 'elias' ? withdrawSharing(p) : p));
    if (next === 'assessment') setPatients(current => current.map(p => p.id === (patientId || 'aino') && p.sharing !== 'withdrawn' ? { ...p, assessmentStatus: 'unavailable' } : p));
    if (next === 'missingtms') setPatients(current => current.map(p => p.id === 'elias' && p.sharing !== 'withdrawn' ? { ...p, tms: null } : p));
    if (next === 'newamber') setPatients(current => current.map(p => p.id === 'elias' ? raiseFlag(p, { id: 'steps-drift', level: 'amber', reason: 'Steps have fallen alongside more time at home over the last week.', source: 'Steps and location aggregates', observed: '13 Nov, 14:20' }) : p));
    if (next === 'expired' || next === 'authfail') { setSignedIn(false); return; }
    setSignedIn(true);
    if (['empty', 'nomatches', 'loading', 'denied', 'default'].includes(next)) { setPatientId(null); setQuery(next === 'nomatches' ? 'No matching name' : ''); setFilter('all'); }
    if (['unavailable', 'baseline', 'consent', 'generationfail', 'savefail', 'silence', 'assessment', 'newamber', 'missingtms'].includes(next)) {
      setPatientId(['unavailable', 'baseline'].includes(next) ? 'alex' : next === 'assessment' ? patientId || 'aino' : 'elias'); setTab(['unavailable', 'baseline'].includes(next) ? 'Signals' : next === 'generationfail' ? 'Summaries' : 'Overview');
      if (next === 'silence' && sound && patients.some(p => p.id === 'elias' && p.sharing !== 'withdrawn')) tone();
    }
  }
  // Deep links (?state=offline&patient=elias&tab=Signals&modal=visit) let the screen deck open any state.
  const linked = useRef(false);
  useEffect(() => { if (linked.current) return; linked.current = true; const q = new URLSearchParams(window.location.search); const s = q.get('state'); if (s) applyState(s); const p = q.get('patient'); if (p) { setPatientId(p); setTab(q.get('tab') || 'Overview'); } if (q.get('summary')) setSummaryId(q.get('summary')); if (q.get('modal')) setModal(q.get('modal')); if (q.get('query')) setQuery(q.get('query')); if (q.get('filter')) setFilter(q.get('filter')); }, []);
  function reset() { setPatients(current => createPatients().map(seed => current.find(p => p.id === seed.id && p.sharing === 'withdrawn') || seed)); setSignedIn(true); setPatientId(null); setTab('Overview'); setQuery(''); setFilter('all'); setState('default'); setModal(null); setNotice(''); setSound(false); setSoundError(''); }
  const utilities = <PrototypeStates state={state} apply={applyState} reset={reset} />;
  const disclosure = <div className="demo-disclosure">Synthetic demo · All people and data are invented. No live connections.</div>;

  if (!signedIn) return <>{disclosure}<SignIn key={state} expired={state === 'expired'} fail={state === 'authfail'} onSignIn={() => { setSignedIn(true); setState('default'); setNotice('Signed in to the demo workspace.'); }} /><footer className="signin-footer">{utilities}</footer></>;

  return <div className="workspace"><a className="skip-link" href="#workspace-main">Skip to main content</a><aside className="sidebar"><div><button className="brand-button" onClick={() => { setPatientId(null); setNotice(''); }} aria-label="Depressify Patients"><span className="wordmark">Depressify</span></button><p className="workspace-label">Clinician workspace</p><nav aria-label="Workspace"><button className="nav-item active" aria-current="page" onClick={() => { setPatientId(null); setNotice(''); }}>Patients <span>{visible.length}</span></button></nav></div><div className="account"><span className="account-avatar" aria-hidden="true">CL</span><div><span>Demo clinician</span><button className="text-button" onClick={() => { setSignedIn(false); setModal(null); setNotice(''); }}>Sign out</button></div></div></aside>
    <div className="workspace-body">{disclosure}<main id="workspace-main" className="main-content">
      <div className="workspace-meta"><span>Friday, 13 November 2026</span><span>Helsinki · 14:20</span></div>
      {state === 'offline' && <div className="notice stale" role="status"><strong>Offline · showing saved data</strong><span>Last refreshed today, 14:19. Changes need a connection.</span><button onClick={() => setState('default')}>Reconnect</button></div>}
      {notice && <div className="notice success" role="status"><span>{notice}</span><button className="text-button" onClick={() => setNotice('')} aria-label="Dismiss confirmation">Dismiss</button></div>}
      {state === 'denied' ? <><h1 ref={pageHeading} tabIndex="-1">Patients</h1><Blank title="You don’t have access to these Patients" action="Retry access" onAction={() => { setState('default'); setPatientId(null); }}>No Patient data is shown. Retry the demo connection or sign out.</Blank></> : state === 'loading' ? <><h1 ref={pageHeading} tabIndex="-1">Patients</h1><div className="loading-view" role="status" aria-busy="true"><p>Loading Patients…</p><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div><button onClick={() => setState('default')}>Finish demo loading</button></> : !patient ? <>
        <header className="page-heading"><div><h1 ref={pageHeading} tabIndex="-1">Patients</h1><p className="muted">A little context for your next conversation.</p></div><span className="freshness">{state === 'offline' ? 'Saved view · 14:19' : 'Demo connection · updated 14:19'}</span></header>
        {reds.map(red => <section key={red.id} className="red-banner" aria-label={`Red Attention flag for ${red.name}`}><div><strong>{red.name} needs attention</strong><p>{red.reason}</p></div><button className="primary" onClick={() => openPatient(red.id)}>Open Patient</button></section>)}
        <div className="list-tools"><label className="search-label"><span className="sr-only">Search Patients by name</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Patients" /></label><div className="filter-group" aria-label="Filter by Attention flag">{[['all', 'All'], ['red', 'Red'], ['amber', 'Amber'], ...(visible.some(p => p.level === 'unknown') ? [['unknown', 'Unassessed']] : []), ['green', 'Green']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span>{value === 'all' ? visible.length : visible.filter(p => p.level === value).length}</span></button>)}</div></div>
        {state === 'empty' ? <Blank title="No Patients linked yet" action="Restore demo Patients" onAction={() => setState('default')}>Linked Patients will appear here.</Blank> : !filtered.length ? <Blank title="No matching Patients" action="Clear search and filters" onAction={() => { setQuery(''); setFilter('all'); if (state === 'nomatches') setState('default'); }}>Try another name or Attention flag.</Blank> : <div className="patient-table-wrap"><table className="patient-table"><caption className="sr-only">Synthetic Patients, red first, then amber and green</caption><thead><tr><th scope="col">Patient</th><th scope="col">Attention</th><th scope="col" className="desktop-column">Sleep · 14 days</th><th scope="col" className="desktop-column">Last Check-in</th><th scope="col" className="desktop-column">Phone last seen</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead><tbody>{filtered.map(p => <tr key={p.id}><th scope="row"><button className="patient-name" onClick={() => openPatient(p.id)}><span className="avatar" aria-hidden="true">{p.initials}</span><span><strong>{p.name}</strong><small>{p.sharing === 'withdrawn' ? 'Sharing Consent withdrawn' : p.note}</small>{p.sharing !== 'withdrawn' && <small className="patient-mobile-meta">Check-in {p.checkIn} · Phone {p.lastPhone}</small>}</span></button></th><td><Flag level={p.level} /></td><td className="desktop-column">{p.sharing === 'withdrawn' ? 'Hidden' : <Sparkline rows={p.daily} />}</td><td className="desktop-column">{p.sharing === 'withdrawn' ? 'Hidden' : p.checkIn}</td><td className="desktop-column">{p.sharing === 'withdrawn' ? 'Hidden' : p.lastPhone}</td><td><button className="text-button open-patient" aria-label={`Open ${p.name}`} onClick={() => openPatient(p.id)}>Open</button></td></tr>)}</tbody></table></div>}
        <div className="list-footer"><span className="small muted">{filtered.length} of {visible.length} Patients · ordered by Attention flag</span><label className="checkbox-label sound-control"><input type="checkbox" checked={sound} onChange={async e => { if (e.target.checked) setSound(await tone()); else setSound(false); }} />Sound for red flags <span className="small muted">(plays a test when enabled)</span></label></div><ErrorText>{soundError}</ErrorText>
      </> : <>
        <button className="back-button text-button" onClick={() => { setPatientId(null); setNotice(''); }}>← Patients</button><header className="page-heading patient-heading"><div><h1 ref={pageHeading} tabIndex="-1">{patient.name}</h1><p className="muted">{withdrawn ? 'Sharing Consent withdrawn' : patient.tms ? `Week ${Math.floor(daysBetween(patient.tms, TODAY) / 7)} since TMS` : 'TMS end date not recorded'}<span className="meta-separator">·</span>Synthetic Demo Patient</p></div>{!withdrawn && <button className={['Overview', 'Signals'].includes(tab) ? 'primary' : ''} onClick={() => setModal('visit')}>Record a Visit</button>}</header>
        {withdrawn ? <Blank title="Sharing Consent withdrawn">Associated Summaries, Signals, Intake, Visits and flag records have been removed from this demo. Collection and future alerts are stopped. Switching views or resetting the view cannot restore deleted records.</Blank> : <>
          <Attention key={patient.id} patient={patient} onHistory={() => setModal('history')} onClear={() => setModal('clear')} onRetryAssessment={() => { updatePatient({ assessmentStatus: 'complete' }); setNotice('Simulated assessment completed. Earlier Attention flags are unchanged.'); }} />
          <nav className="patient-tabs" aria-label="Patient sections">{['Overview', 'Summaries', 'Signals', 'Intake & Visits'].map(name => <button key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>{name}</button>)}</nav>
          <div key={patient.id}>
            {tab === 'Overview' && <div className="overview-layout">
              <ProgressTimeline patient={patient} onSetTms={() => setModal('tms')} />
              <aside className="overview-support" aria-label="Summaries and reported Outcomes">
                <section className="content-section latest-summary"><h2>Latest Summary</h2><p className="small muted">{dateLabel(patient.summaries[0].date)}, {patient.summaries[0].time} · generated</p><p className="summary-text">{patient.summaries[0].text}</p><button className="text-button" onClick={() => { setTab('Summaries'); setSummaryId(patient.summaries[0].id); }}>Read Summary</button></section>
                <WhatHelps summaries={patient.summaries} />
                <WeeklyDigest compact patient={patient} onUpdate={digest => updatePatient({ digest })} fail={state === 'generationfail'} offline={state === 'offline'} />
              </aside>
            </div>}

            {tab === 'Summaries' && <SummariesView key={patient.id} patient={patient} selectedId={summaryId} setSelectedId={setSummaryId} onDigest={digest => updatePatient({ digest })} state={state} />}
            {tab === 'Signals' && <SignalTrends patient={patient} state={state} />}
            {tab === 'Intake & Visits' && <><section className="content-section"><div className="section-heading"><div><h2>Intake</h2><p className="muted">Fictional report · saved {dateLabel(patient.intake.date)}</p></div><button className="primary" onClick={() => setModal('intake')}>Replace Intake</button></div><ul className="highlights">{patient.intake.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul><p className="small muted">Saved highlights only. No raw report retained or Companion steering controls.</p></section><section className="content-section"><div className="section-heading"><div><h2>Visits</h2><p className="muted">Questionnaire scores recorded by the Clinician</p></div><button onClick={() => setModal('visit')}>Record a Visit</button></div><div className="table-scroll"><table><thead><tr><th scope="col">Date</th><th scope="col">Questionnaire</th><th scope="col">Score</th></tr></thead><tbody>{[...patient.visits].sort((a, b) => b.date.localeCompare(a.date)).map(v => <tr key={v.id}><th scope="row">{dateLabel(v.date, { year: 'numeric' })}</th><td>{v.type === 'none' ? 'No score recorded' : v.type}</td><td>{v.type === 'none' ? '—' : `${v.score}/${v.type === 'PHQ-2' ? 6 : 27}`}</td></tr>)}</tbody></table></div><div className="tms-row"><span>{patient.tms ? `TMS ended ${dateLabel(patient.tms, { year: 'numeric' })}` : 'TMS end date not recorded'}</span><button className="text-button" onClick={() => setModal('tms')}>{patient.tms ? 'Edit TMS end date' : 'Add TMS end date'}</button></div></section></>}
          </div>
        </>}
      </>}
    </main><footer className="page-footer workspace-footer"><p className="small muted">Depressify · Clinician workspace</p>{utilities}</footer></div>
    {modal && patient && !withdrawn && <Modal key={`${patient.id}-${modal}`} title={{ visit: 'Record a Visit', clear: 'Clear Attention flag', history: 'Attention flag history', intake: 'Add fictional Intake', tms: patient.tms ? 'Edit TMS end date' : 'Add TMS end date' }[modal]} onClose={closeModal}>
      {modal === 'visit' && <VisitForm patient={patient} onClose={closeModal} fail={state === 'savefail'} offline={state === 'offline'} onSave={visit => { updatePatient({ visits: [...patient.visits, visit] }); setModal(null); setNotice(`Visit saved for ${dateLabel(visit.date)}${visit.type !== 'none' ? ` · ${visit.type} ${visit.score}` : ''}. Attention flag unchanged.`); }} />}
      {modal === 'clear' && <ClearFlagForm patient={patient} onClose={closeModal} fail={state === 'savefail'} offline={state === 'offline'} onSave={note => { updatePatient(clearFlags(patient, note)); if (state === 'silence') setState('default'); setModal(null); setNotice('Attention flag cleared. History preserved.'); }} />}
      {modal === 'history' && <FlagHistory patient={patient} />}
      {modal === 'intake' && <IntakeForm onClose={closeModal} fail={state === 'savefail'} generationFail={state === 'generationfail'} offline={state === 'offline'} onSave={intake => { updatePatient({ intake }); setModal(null); setNotice('Intake highlights saved locally. The report was not retained.'); }} />}
      {modal === 'tms' && <TmsForm patient={patient} onClose={closeModal} fail={state === 'savefail'} offline={state === 'offline'} onSave={tms => { updatePatient({ tms }); setModal(null); setNotice('TMS end date saved. Weeks and Phases updated.'); }} />}
    </Modal>}
  </div>;
}
