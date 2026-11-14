// Health-style cards for Today, History, Signals and Summary.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { CheckIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { Icon, Orb } from './live';
import { nearbyPlaces, weekDays } from './data';

export type Entry = { id: string; date: string; title: string; text: string; ratings: (number|null)[]; kind?: string; tried?: boolean; previousOutcome?: string; feeling?: number|null; suggestion?: string|null; voiceCue?: string };
export const KIND_ICON: Record<string, string> = { walk: 'person-simple-walk', music: 'music-notes', call: 'phone', small: 'sun-horizon', class: 'flower-lotus' };
const METRICS = [['Mood', 'sun-horizon'], ['Energy', 'lightning'], ['Sleep quality', 'moon']] as const;

// A day counts once a Check-in exists for it. Days without one stay neutral: nothing is marked as missed and nothing resets.
const weekOf = (history: Entry[]) => weekDays.map(d => ({ ...d, done: history.some(h => h.date === d.date + ' November') }));

export function RatingDots({ value, label }: { value: number|null; label: string }) {
  if (value === null) return null;
  return <span className="dots" role="img" aria-label={label + ' ' + value + ' of 5'}>{[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= value ? 'on' : ''} />)}</span>;
}

export function WeekBar({ history }: { history: Entry[] }) {
  const days = weekOf(history), count = days.filter(d => d.done).length;
  return <section className="week-bar" aria-label={count + ' Check-ins in the last 7 days'}><p className="p-meta">This week · {count} Check-ins</p><ol aria-hidden="true">{days.map((d, i) => <li key={i} className={d.done ? 'done' : d.today ? 'today' : ''}><span /><small>{d.day}</small></li>)}</ol></section>;
}

export function CheckinCard({ night, onTalk, onType }: { night: boolean; onTalk: () => void; onType: () => void }) {
  return <section className="h-card checkin-card" aria-label="Check-in">
    <div className="card-top"><span className="p-meta">Fri 13 Nov</span><span className="p-meta">About 3 min · AI Companion</span></div>
    <div className="checkin-body"><Orb state="listening" frozen decorative /><h2>{night ? 'Talk for a bit' : 'Your Check-in'}</h2></div>
    <div className="checkin-actions"><button className="p-primary" onClick={onTalk}><Icon name="microphone" />Talk</button><button className="p-secondary" onClick={onType}><Icon name="keyboard" />Type</button></div>
  </section>;
}

// Synthetic places on an illustrated map. Swap the image for the Google Maps SDK once an API key and location Consent exist.
export function PlacesCard({ title, onOpen }: { title: string; onOpen: () => void }) {
  const [sel, setSel] = useState(nearbyPlaces[0].id), place = nearbyPlaces.find(p => p.id === sel)!;
  return <section className="h-card places-card" aria-label="Places near you">
    <div className="card-top"><span className="p-meta">Near you</span><span className="p-meta">Demo places</span></div>
    <div className="places-map" aria-hidden="true"><img src="/assets/nearby-map.jpg" alt="" width="1200" height="600" /><span className="you-dot" />{nearbyPlaces.map(p => <span key={p.id} className={'map-pin' + (sel === p.id ? ' on' : '')} style={{ left: p.x + '%', top: p.y + '%' }}><Icon name={p.icon} /></span>)}</div>
    <div className="place-chips" role="group" aria-label="Kind of place">{nearbyPlaces.map(p => <button key={p.id} aria-pressed={sel === p.id} onClick={() => setSel(p.id)}><Icon name={p.icon} />{p.kind}</button>)}</div>
    <div className="place-detail"><span><strong>{place.name}</strong><small>{place.detail}</small></span><a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.query)} target="_blank" rel="noreferrer" aria-label={'Open ' + place.name + ' in Google Maps'}>Maps<Icon name="arrow-square-out" /></a></div>
    <button className="stat-next" onClick={onOpen}><span>Your Suggestion · <strong>{title}</strong></span><ChevronRightIcon /></button>
  </section>;
}

export function TrendCard({ history }: { history: Entry[] }) {
  const [metric, setMetric] = useState(0), ref = useRef<HTMLCanvasElement>(null);
  const rows = weekDays.map(d => ({ date: d.date + ' Nov', value: history.find(h => h.date === d.date + ' November')?.ratings[metric] ?? null }));
  useEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx) return;
    const cs = getComputedStyle(ref.current!), muted = cs.getPropertyValue('--p-muted').trim(), grid = cs.getPropertyValue('--p-border').trim(), accent = cs.getPropertyValue('--p-accent').trim();
    const x = (i: number) => 42 + i * 98, y = (v: number) => 190 - (v - 1) * 40;
    ctx.clearRect(0, 0, 660, 250); ctx.font = '24px system-ui'; ctx.fillStyle = muted; ctx.lineWidth = 1;
    [1, 3, 5].forEach(v => { ctx.fillText(String(v), 0, y(v) + 8); ctx.beginPath(); ctx.strokeStyle = grid; ctx.moveTo(36, y(v)); ctx.lineTo(648, y(v)); ctx.stroke(); });
    // Unanswered days break the line and draw nothing: a gap, never a low value.
    let connected = false; ctx.beginPath(); ctx.strokeStyle = accent; ctx.lineWidth = 4;
    rows.forEach((d, i) => { if (d.value === null) { connected = false; return; } if (connected) ctx.lineTo(x(i), y(d.value)); else ctx.moveTo(x(i), y(d.value)); connected = true; }); ctx.stroke();
    rows.forEach((d, i) => { if (d.value === null) return; ctx.beginPath(); ctx.fillStyle = accent; ctx.arc(x(i), y(d.value), 6, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = muted; ctx.font = '22px system-ui'; ctx.fillText('7 Nov', 34, 238); ctx.fillText('10 Nov', 286, 238); ctx.fillText('13 Nov', 570, 238);
  }, [metric, history]);
  return <section className="h-card trend">
    <div className="seg" role="group" aria-label="Rating">{METRICS.map(([label], i) => <button key={label} aria-pressed={metric === i} onClick={() => setMetric(i)}>{label}</button>)}</div>
    <p className="p-meta">7–13 November · Your ratings, from 1 to 5</p>
    <canvas width="660" height="250" ref={ref} role="img" aria-label={METRICS[metric][0] + ' ratings with gaps for unanswered days'} />
    <details><summary>View ratings</summary><table><thead><tr><th>Date</th><th>{METRICS[metric][0]}</th></tr></thead><tbody>{rows.map(d => <tr key={d.date}><td>{d.date}</td><td>{d.value ?? '—'}</td></tr>)}</tbody></table></details>
  </section>;
}

function JournalCard({ entry, onOpen }: { entry: Entry; onOpen: (e: Entry) => void }) {
  return <button className="journal-card" onClick={() => onOpen(entry)}><span><small>{entry.date}</small><strong>{entry.title}</strong><span className="journal-meta"><RatingDots value={entry.ratings[0]} label="Mood" />{entry.tried && <span className="p-status"><CheckIcon />Tried</span>}</span></span><ChevronRightIcon /></button>;
}

// Check-ins as a path: newest first, each one a step on the same line.
export function JournalPath({ entries, onOpen }: { entries: Entry[]; onOpen: (e: Entry) => void }) {
  return <ol className="path">{entries.map(e => <li key={e.id}><span className="tile node"><Icon name={KIND_ICON[e.kind ?? ''] ?? 'chat-circle'} /></span><JournalCard entry={e} onOpen={onOpen} /></li>)}</ol>;
}

type Signal = { id: string; name: string; group: string; icon: string; value: string };
export function SignalGroups({ signals, consents, scenario, onOpen }: { signals: Signal[]; consents: Record<string, boolean>; scenario: string; onOpen: (id: string) => void }) {
  return <>{[...new Set(signals.map(s => s.group))].map(group => <section key={group} className="h-card signal-group"><h2>{group}</h2>{signals.filter(s => s.group === group).map(s => {
    const on = consents[s.id], detail = scenario === 'unsupported' && group === 'Body' ? 'Unavailable on this device' : on ? scenario === 'signal-empty' ? 'No data yet' : s.value : 'Not collected';
    return <button key={s.id} className="signal-row" onClick={() => onOpen(s.id)}><span className={'tile' + (on ? '' : ' off')}><Icon name={s.icon} /></span><span className="signal-text"><strong>{s.name}</strong><small>{detail}</small></span><span className={'pill' + (on ? ' on' : '')}>{on ? 'On' : 'Off'}</span><ChevronRightIcon /></button>;
  })}</section>)}</>;
}

export function FeltCard({ ratings }: { ratings: (number|null)[] }) {
  return <section className="h-card felt-card"><p className="p-meta">How you felt</p><div className="felt-grid">{METRICS.map(([label, icon], i) => <div key={label}><span className="tile"><Icon name={icon} /></span><small>{label}</small><strong>{ratings[i] ?? '—'}{ratings[i] !== null && <small> / 5</small>}</strong><RatingDots value={ratings[i]} label={label} /></div>)}</div></section>;
}

type TodayProps = { night: boolean; greeting: string; hasHistory: boolean; history: Entry[]; suggestionTitle: string; headingRef: RefObject<HTMLHeadingElement | null>; onTalk: () => void; onType: () => void; onSuggestion: () => void };
// Check-in first: the invitation stays the hero, the week is one quiet row, then places for the next small step.
export function TodayView(p: TodayProps) {
  return <>
    <section className="today-intro"><p className="p-meta today-greeting">{p.greeting}</p><h1 ref={p.headingRef} tabIndex={-1}>{p.night ? <>Nights can<br />feel long.</> : <>One small thing<br />is enough.</>}</h1><p>{p.night ? 'I’m here if you want company.' : 'A few minutes, at your pace.'}</p></section>
    <CheckinCard night={p.night} onTalk={p.onTalk} onType={p.onType} />
    {p.hasHistory ? <><WeekBar history={p.history} /><PlacesCard title={p.suggestionTitle} onOpen={p.onSuggestion} /></> : <p className="p-meta first-note">You can start wherever you are.</p>}
  </>;
}
