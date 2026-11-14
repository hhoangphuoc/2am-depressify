export const anchorDate = '2026-11-13';
export const sharedSummary = 'You felt a little low on energy. A short walk felt manageable. You chose ten minutes outside tomorrow.';
export const signalDefinitions = [
  { id: 'sleep', name: 'Sleep', source: 'Health Connect', detail: 'Sleep duration, not a sleep score. Daily totals are shared.', value: '7 h 10 min', enabled: true },
  { id: 'steps', name: 'Steps', source: 'Health Connect', detail: 'Your daily step total. Raw movement samples stay on your phone.', value: '4,280 steps', enabled: true },
  { id: 'heart', name: 'Heart rate', source: 'Health Connect', detail: 'Daily heart-rate aggregates in beats per minute.', value: '72 bpm', enabled: false },
  { id: 'resting', name: 'Resting heart rate', source: 'Health Connect', detail: 'Daily resting heart rate, compared with your own Baseline.', value: '64 bpm', enabled: true },
  { id: 'hrv', name: 'Heart rate variability', source: 'Health Connect · RMSSD', detail: 'Daily HRV in milliseconds. Android RMSSD is not compared with iOS SDNN.', value: 'No data available', enabled: false },
  { id: 'home', name: 'Time at home', source: 'Location on this phone', detail: 'Only daily time at home is shared. Raw location samples stay on your phone.', value: '18 h 20 min', enabled: false },
  { id: 'radius', name: 'Movement radius', source: 'Location on this phone', detail: 'Only a daily movement radius in kilometres is shared, not a location trail.', value: '1.8 km', enabled: false },
  { id: 'calendar', name: 'Calendar', source: 'Google Calendar', detail: 'Free time and calendar load help time Suggestions. Booking always needs your agreement.', value: 'Connected', enabled: false },
  { id: 'weather', name: 'Weather', source: 'Google Maps', detail: 'Local conditions for outdoor Suggestions. A place lookup uses relevant location.', value: 'Available during a Check-in', enabled: true },
  { id: 'ratings', name: 'Your ratings', source: 'You', detail: 'Mood, energy and sleep quality from 1 to 5. Each answer is optional.', value: 'Asked during Check-ins', enabled: true },
  { id: 'voice', name: 'Voice observations', source: 'AI Companion', detail: 'Observations such as pauses may appear in your Summary. They are not a diagnosis.', value: 'Observations only', enabled: true },
  { id: 'screen', name: 'Late-night screen time', source: 'Optional Android feature', detail: 'Available only if device support is confirmed. It is not collected in this prototype.', value: 'Not available in this demo', enabled: false },
];
export const historySeed = [
  { id: 'nov12', date: '12 November', title: 'A little time outside', text: sharedSummary, ratings: [3, 2, 3] as (number|null)[] },
  { id: 'nov10', date: '10 November', title: 'Some music, a quieter evening', text: 'You enjoyed a quiet evening with music. You chose a short walk for the next day.', ratings: [3, 3, 4] as (number|null)[] },
  { id: 'nov08', date: '8 November', title: 'Making room to rest', text: 'You wanted a slower day. You chose to call someone close to you when you felt ready.', ratings: [2, 2, null] as (number|null)[] },
];
export const moodDays = [
  { date: '7 Nov', value: 3 }, { date: '8 Nov', value: 2 }, { date: '9 Nov', value: null },
  { date: '10 Nov', value: 3 }, { date: '11 Nov', value: null }, { date: '12 Nov', value: 3 }, { date: '13 Nov', value: null },
];
export function validRating(value: number|null) { return value === null || Number.isInteger(value) && value >= 1 && value <= 5; }
export function validQuietHours(start: string, end: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end) && start !== end; }
export function validBooking(date: string, time: string, duration: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === date && date >= anchorDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && ['10', '15', '20'].includes(duration);
}
