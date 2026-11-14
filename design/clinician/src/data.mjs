export const TODAY = '2026-11-13';
export const START = '2026-10-02';
export const SUMMARY = 'You felt a little low on energy. A short walk felt manageable. You chose ten minutes outside tomorrow.';
export const levels = { red: 'Red · Needs attention', amber: 'Amber · Worth a look', green: 'Green · No current flag', unknown: 'Assessment unavailable', hidden: 'Sharing withdrawn' };
export const signalDefinitions = [
  { key: 'sleep', label: 'Sleep', unit: 'h', max: 12, source: 'Watch daily aggregate' },
  { key: 'steps', label: 'Steps', unit: 'steps', max: 10000, source: 'Phone daily aggregate' },
  { key: 'heart', label: 'Heart rate · daily mean', unit: 'bpm', max: 120, source: 'Watch daily aggregate' },
  { key: 'rhr', label: 'Resting heart rate', unit: 'bpm', max: 100, source: 'Watch daily aggregate' },
  { key: 'hrv', label: 'HRV · RMSSD', unit: 'ms', max: 90, source: 'Watch daily aggregate' },
  { key: 'home', label: 'Time at home', unit: 'h', max: 24, source: 'Phone location aggregate' },
  { key: 'radius', label: 'Movement radius', unit: 'km', max: 8, source: 'Phone location aggregate' },
  { key: 'calendar', label: 'Calendar load', unit: 'h', max: 8, source: 'Calendar busy time only' },
];

export function dateLabel(date, options = {}) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', day: 'numeric', month: 'short', ...options }).format(new Date(date.length === 10 ? `${date}T12:00:00+02:00` : date));
}
export function daysBetween(a, b) { return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000); }
export function dayAt(index) { return new Date(Date.parse(`${START}T12:00:00Z`) + index * 86400000).toISOString().slice(0, 10); }
export function orderPatients(patients) {
  const order = { red: 0, amber: 1, unknown: 2, green: 3, hidden: 4 };
  return [...patients].sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
}
export function validateVisit({ date, type, score }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date || date > TODAY) return 'Choose a valid Visit date on or before 13 Nov 2026.';
  if (!['none', 'PHQ-2', 'PHQ-9'].includes(type)) return 'Choose PHQ-2, PHQ-9, or no Questionnaire score.';
  if (type !== 'none' && (score == null || String(score).trim() === '' || !Number.isInteger(Number(score)) || Number(score) < 0 || Number(score) > (type === 'PHQ-2' ? 6 : 27))) return `Enter a whole-number ${type} score from 0 to ${type === 'PHQ-2' ? 6 : 27}.`;
  return '';
}
export function baseline(rows, key, date = TODAY) {
  const values = rows.filter(row => row.date < date && daysBetween(row.date, date) <= 14).map(row => row[key]).filter(Number.isFinite);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { validDays: values.length, value: values.length >= 5 ? median : null };
}
export function formatValue(value, unit = '') {
  return Number.isFinite(value) ? `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: unit === 'steps' ? 0 : 1 }).format(value)}${unit ? ` ${unit}` : ''}` : 'Missing';
}
export function attentionFor(patient) {
  if (patient.sharing === 'withdrawn') return { ...patient, level: 'hidden', activeFlags: [], reason: null };
  const flags = [...(patient.activeFlags || [])].sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1));
  if (flags.length) return { ...patient, ...flags[0], id: patient.id, activeFlags: flags };
  if (patient.assessmentStatus === 'unavailable') return { ...patient, level: 'unknown', reason: 'The Check-in assessment timed out. No automatic judgment is available. Review the Summary; a timeout is not a green result.', source: 'Assessment unavailable', observed: '13 Nov, 14:20' };
  return { ...patient, level: 'green' };
}
export function raiseFlag(patient, flag) {
  if (patient.sharing === 'withdrawn' || patient.activeFlags.some(f => f.id === flag.id)) return patient;
  return attentionFor({ ...patient, activeFlags: [flag, ...patient.activeFlags], history: [{ ...flag, action: 'Raised', date: `${flag.observed} 2026`, email: flag.level === 'red' ? 'Queued · simulation only, no email delivered' : 'Not applicable' }, ...patient.history] });
}
export function clearFlags(patient, note) {
  if (patient.sharing === 'withdrawn') return patient;
  return attentionFor({ ...patient, activeFlags: [], reason: 'Attention flags cleared after Clinician action. Previous reasons remain in history.', source: 'Clinician action', observed: '13 Nov, 14:20', history: [...patient.activeFlags.map(flag => ({ id: `clear-${flag.id}-${patient.history.length}`, level: flag.level, action: 'Cleared', date: '13 Nov, 14:20 2026', reason: `${note} Raised reason: ${flag.reason}`, source: 'Clinician action', email: 'No email sent' })), ...patient.history] });
}
export function withdrawSharing(patient) {
  return { id: patient.id, name: 'Patient sharing withdrawn', initials: '—', sharing: 'withdrawn', level: 'hidden', note: 'Associated data removed', activeFlags: [], history: [], summaries: [], daily: [], visits: [], intake: null, digest: null, tms: null, alertsEnabled: false };
}
export function timelinePhases(tms, visits) {
  if (!tms) return [];
  const boundaries = [...new Set([tms, ...visits.map(v => v.date).filter(date => date >= tms && date < TODAY), TODAY])].sort();
  return boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1], label: `Phase ${index + 1}` }));
}
export function effectivePatients(patients, state) {
  return orderPatients(patients.map(patient => {
    if (patient.sharing === 'withdrawn') return attentionFor(patient);
    patient = attentionFor(patient);
    if (patient.id === 'alex' && ['baseline', 'unavailable'].includes(state)) return { ...patient, reason: state === 'baseline' ? 'Building a personal Baseline. Fewer than five valid days are available; Signals cannot be compared yet.' : 'Signals are unavailable. Missing data does not mean a zero measurement.', source: 'Signal coverage', observed: '13 Nov, 14:19' };
    if (state === 'silence' && patient.id === 'elias') {
      const reason = 'Phone quiet for 26 hours. Connection and wellbeing need a check.';
      const source = 'Hourly phone freshness check';
      const flag = { id: 'silence', level: 'red', reason, source, observed: '13 Nov, 14:00' };
      return raiseFlag({ ...patient, quote: null, lastPhone: '12 Nov, 12:00', checkIn: '11 Nov, 09:15', summaries: patient.summaries.filter(s => s.date < TODAY), daily: patient.daily.map(row => row.date === TODAY ? { ...row, ...Object.fromEntries(Object.keys(row).filter(k => k !== 'date').map(k => [k, null])) } : row) }, flag);
    }
    return patient;
  }));
}
export function makeDigest(summaries) {
  const basis = summaries.filter(s => s.date >= '2026-11-07' && s.date <= TODAY);
  if (!basis.length) return null;
  const tried = basis.filter(s => s.tried);
  return { time: '13 Nov, 14:20', ids: basis.map(s => s.id), text: `${basis.length} Summaries this week describe ${[...new Set(basis.flatMap(s => s.themes))].join(', ').toLowerCase()}. ${tried.length} record a previous Suggestion tried. The latest Summary says: ${basis[0].text}` };
}
export function createPatients() {
  return [
    { id: 'elias', name: 'Elias Niemi', initials: 'EN', level: 'red', reason: 'Sleep fell to 2.4 h last night, from a 6.5 h personal Baseline.', source: 'Sleep Signal · sharp break rule', observed: '13 Nov, 08:10', lastPhone: 'Today, 14:18', checkIn: 'Today, 09:15', note: 'Recent sleep collapse', quote: null },
    { id: 'mira', name: 'Mira Koski', initials: 'MK', level: 'amber', reason: 'Mood rating was 2 in three consecutive Check-ins. Check-ins have become less frequent.', source: 'Patient Mood ratings · Check-in pattern', observed: '12 Nov, 18:05', lastPhone: 'Today, 13:52', checkIn: 'Yesterday, 18:00', note: 'Rarely checking in', quote: null },
    { id: 'aino', name: 'Aino Laine', initials: 'AL', level: 'green', reason: 'Recent Signals are close to their own Baseline. No current Attention flag.', source: 'Recent Signals and Summaries', observed: '13 Nov, 10:10', lastPhone: 'Today, 14:10', checkIn: 'Today, 10:00', note: 'Finding a steady rhythm', quote: null },
    { id: 'alex', name: 'Alex Salmi', initials: 'AS', level: 'green', reason: 'Recent Signals are close to their own Baseline. No current Attention flag.', source: 'Recent Signals and Summaries', observed: '13 Nov, 11:05', lastPhone: 'Today, 14:19', checkIn: 'Today, 11:00', note: 'Live phone scenario · simulated', quote: null },
  ].map((patient, p) => {
    const daily = Array.from({ length: 43 }, (_, i) => {
      const missing = [6, 17, 28, 36].includes(i) || (p === 1 && i % 5 === 0);
      const wave = Math.sin(i * 1.5 + p);
      const decline = p === 0 && i > 35 ? (i - 35) / 7 : 0;
      return { date: dayAt(i), mood: i % (p === 1 ? 6 : 3) === 0 ? (p === 1 ? (i > 25 ? 2 : 3) : i === 42 ? 3 : i > 35 && p === 0 ? 2 : Math.round(3.5 + wave * .6)) : null,
        sleep: missing ? null : i === 42 && p === 0 ? 2.4 : +(6.8 + wave * .5 - decline * 1.4).toFixed(1),
        steps: missing ? null : Math.round(4800 + wave * 1100 - decline * 2600 + p * 200),
        heart: missing ? null : Math.round(72 + wave * 4 + decline * 5),
        rhr: missing ? null : Math.round(62 + wave * 3 + decline * 9),
        hrv: p === 3 || missing || i % 8 === 0 ? null : Math.round(44 + wave * 7 - decline * 15),
        home: missing ? null : +(16 + wave - p * .4 + decline * 4).toFixed(1),
        radius: missing ? null : +(3.6 + wave * .7 - decline * 2.4).toFixed(1),
        calendar: i % 9 === 0 ? null : +(1.5 + (wave + 1) * .7).toFixed(1) };
    });
    const summaries = (p === 1 ? [41, 35, 29, 23, 17, 11, 5] : [42, 40, 38, 36, 34, 31, 28, 25, 22, 19, 16, 13, 10, 7, 4, 1]).map((d, i) => ({
      id: `${patient.id}-${d}`, date: dayAt(d), time: ['09:15', '18:00', '10:00', '11:00'][p], generated: ['09:16', '18:01', '10:01', '11:01'][p], text: i === 0 ? p === 1 ? 'You felt low on energy and wanted a quiet evening. Music felt manageable. You chose one favourite song for tomorrow.' : SUMMARY : ['You made room for a quiet morning. Listening to music felt comforting. You chose one favourite song for tomorrow.', 'You felt tired but enjoyed being outside. A short walk felt manageable. You chose a gentle walk tomorrow.', 'You wanted a little company. Calling someone felt possible. You chose to call a friend tomorrow.'][i % 3],
      mood: p === 1 ? 2 : i === 0 ? 3 : 3 + i % 2, energy: i === 0 ? 2 : 3, sleep: 3,
      themes: i === 0 ? ['Low energy', 'Small steps'] : ['Rest', 'Connection', 'Time outside'].slice(i % 2),
      voice: i === 0 ? 'Long pauses' : 'Gentle pace', suggestion: i === 0 ? p === 1 ? 'Listen to one favourite song tomorrow' : 'A short walk · ten minutes outside tomorrow' : ['Listen to one favourite song', 'A gentle walk outside', 'Call a friend'][i % 3], previousKind: i === 0 ? 'Walks' : ['Music', 'Walks', 'Calling someone'][i % 3], tried: i % 4 !== 3, feeling: i % 4 !== 3 ? i === 0 ? 4 : 3 + i % 3 : null,
    }));
    daily.forEach(row => { row.mood = summaries.find(s => s.date === row.date)?.mood ?? null; });
    if (p === 0) patient = { ...patient, reason: `Sleep fell to ${daily.at(-1).sleep.toFixed(1)} h last night, from a ${baseline(daily, 'sleep').value.toFixed(1)} h personal Baseline.` };
    const priorDigest = makeDigest(summaries.filter(s => s.date < TODAY));
    return { ...patient, sharing: 'active', alertsEnabled: true, assessmentStatus: 'complete', activeFlags: patient.level === 'green' ? [] : [{ id: 'current', level: patient.level, reason: patient.reason, source: patient.source, observed: patient.observed }], daily, summaries, tms: START, visits: [{ id: `${patient.id}-visit`, date: '2026-10-23', type: 'PHQ-9', score: p === 0 ? 12 : p === 1 ? 10 : 6 }],
      intake: { date: START, highlights: ['TMS course ended on 2 Oct 2026.', 'Prefers small, manageable activities.', 'Enjoys walks, music and keeping in touch with a friend.'] },
      history: [{ id: 'current', level: patient.level, action: patient.level === 'green' ? 'Reviewed' : 'Raised', date: `${patient.observed} 2026`, reason: patient.reason, source: patient.source, email: patient.level === 'red' ? 'Sent · simulation only, no email delivered' : 'Not applicable' }, { id: 'previous-clear', level: 'amber', action: 'Cleared', date: '23 Oct, 11:30 2026', reason: 'Spoke with Patient at the Visit; agreed to check in next week.', source: 'Clinician action', email: 'Not applicable' }, { id: 'previous', level: 'amber', action: 'Raised', date: '22 Oct, 08:10 2026', reason: 'Sleep below personal Baseline for three nights.', source: 'Sleep Signal', email: 'Not applicable' }], digest: priorDigest ? { ...priorDigest, time: '12 Nov, 18:30' } : null };
  });
}
