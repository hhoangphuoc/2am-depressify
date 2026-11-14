export const anchorDate = '2026-11-13';
export const sharedSummary = 'You felt a little low on energy. A short walk felt manageable. You chose ten minutes outside tomorrow.';
export const signalDefinitions = [
  { id: 'sleep', group: 'Body', icon: 'moon', name: 'Sleep', source: 'Health Connect', detail: 'Sleep duration, not a sleep score. Daily totals are shared.', value: '7 h 10 min', enabled: true },
  { id: 'steps', group: 'Body', icon: 'footprints', name: 'Steps', source: 'Health Connect', detail: 'Your daily step total. Raw movement samples stay on your phone.', value: '4,280 steps', enabled: true },
  { id: 'heart', group: 'Body', icon: 'heart', name: 'Heart rate', source: 'Health Connect', detail: 'Daily heart-rate aggregates in beats per minute.', value: '72 bpm', enabled: false },
  { id: 'resting', group: 'Body', icon: 'heartbeat', name: 'Resting heart rate', source: 'Health Connect', detail: 'Daily resting heart rate, compared with your own Baseline.', value: '64 bpm', enabled: true },
  { id: 'hrv', group: 'Body', icon: 'pulse', name: 'Heart rate variability', source: 'Health Connect · RMSSD', detail: 'Daily HRV in milliseconds. Android RMSSD is not compared with iOS SDNN.', value: 'No data available', enabled: false },
  { id: 'home', group: 'Places', icon: 'house-line', name: 'Time at home', source: 'Location on this phone', detail: 'Only daily time at home is shared. Raw location samples stay on your phone.', value: '18 h 20 min', enabled: false },
  { id: 'radius', group: 'Places', icon: 'map-pin', name: 'Movement radius', source: 'Location on this phone', detail: 'Only a daily movement radius in kilometres is shared, not a location trail.', value: '1.8 km', enabled: false },
  { id: 'calendar', group: 'Your day', icon: 'calendar-blank', name: 'Calendar', source: 'Google Calendar', detail: 'Free time and calendar load help time Suggestions. Booking always needs your agreement.', value: 'Connected', enabled: false },
  { id: 'weather', group: 'Your day', icon: 'cloud-sun', name: 'Weather', source: 'Google Maps', detail: 'Local conditions for outdoor Suggestions. A place lookup uses relevant location.', value: 'Available during a Check-in', enabled: true },
  { id: 'ratings', group: 'Check-ins', icon: 'sliders-horizontal', name: 'Your ratings', source: 'You', detail: 'Mood, energy and sleep quality from 1 to 5. Each answer is optional.', value: 'Asked during Check-ins', enabled: true },
  { id: 'voice', group: 'Check-ins', icon: 'waveform', name: 'Voice observations', source: 'AI Companion', detail: 'Observations such as pauses may appear in your Summary. They are not a diagnosis.', value: 'Observations only', enabled: true },
  { id: 'screen', group: 'Your day', icon: 'device-mobile', name: 'Late-night screen time', source: 'Optional Android feature', detail: 'Available only if device support is confirmed. It is not collected in this prototype.', value: 'Not available in this demo', enabled: false },
];
export const historySeed = [
  { id: 'nov12', date: '12 November', title: 'A little time outside', text: sharedSummary, ratings: [3, 2, 3] as (number|null)[], kind: 'walk', tried: true },
  { id: 'nov10', date: '10 November', title: 'Some music, a quieter evening', text: 'You enjoyed a quiet evening with music. You chose a short walk for the next day.', ratings: [3, 3, 4] as (number|null)[], kind: 'music', tried: true },
  { id: 'nov08', date: '8 November', title: 'Making room to rest', text: 'You wanted a slower day. You chose to call someone close to you when you felt ready.', ratings: [2, 2, null] as (number|null)[], kind: 'call', tried: false },
  { id: 'nov07', date: '7 November', title: 'A slow start', text: 'You talked about a tired week. You chose some music for the evening.', ratings: [3, 3, 3] as (number|null)[], kind: 'music', tried: false },
];
// The seven days ending today (Friday 13 November).
export const weekDays = [
  { day: 'S', date: '7' }, { day: 'S', date: '8' }, { day: 'M', date: '9' }, { day: 'T', date: '10' },
  { day: 'W', date: '11' }, { day: 'T', date: '12' }, { day: 'F', date: '13', today: true },
];
// Synthetic places; x and y place each pin on nearby-map.jpg in percent.
export const nearbyPlaces = [
  { id: 'park', kind: 'Park', icon: 'tree', name: 'Töölönlahti Park', detail: '9 min walk', x: 37, y: 24, query: 'Töölönlahti park Helsinki' },
  { id: 'yoga', kind: 'Yoga', icon: 'person-simple-tai-chi', name: 'Quiet Room Yoga', detail: '12 min walk · demo place', x: 76, y: 36, query: 'yoga near Töölönlahti Helsinki' },
  { id: 'meditation', kind: 'Meditation', icon: 'flower-lotus', name: 'Still Point Meditation', detail: '15 min walk · demo place', x: 66, y: 76, query: 'meditation near Töölönlahti Helsinki' },
];
export function validRating(value: number|null) { return value === null || Number.isInteger(value) && value >= 1 && value <= 5; }
export function validQuietHours(start: string, end: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end) && start !== end; }
export function validBooking(date: string, time: string, duration: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === date && date >= anchorDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && ['10', '15', '20'].includes(duration);
}
