import assert from 'node:assert/strict';
import test from 'node:test';
import {validRating,validQuietHours,validBooking,historySeed,moodDays,signalDefinitions} from '../src/data.ts';
test('ratings distinguish missing from invalid and all seed ratings are valid',()=>{assert(validRating(null));assert(!validRating(0));assert(!validRating(6));assert(!validRating(2.5));for(const row of historySeed)assert(row.ratings.every(validRating));assert(moodDays.some(d=>d.value===null));});
test('quiet hours accept an overnight range and reject equal or malformed times',()=>{assert(validQuietHours('21:00','09:00'));assert(!validQuietHours('21:00','21:00'));assert(!validQuietHours('25:00','09:00'));});
test('booking rejects past dates, invalid times and unsupported durations',()=>{assert(validBooking('2026-11-14','11:00','10'));assert(!validBooking('2026-11-12','11:00','10'));assert(!validBooking('2026-11-14','25:00','10'));assert(!validBooking('2027-02-30','11:00','10'));assert(!validBooking('2026-11-14','11:00','0'));});
test('each collected Signal has a distinct Consent identity',()=>{assert.equal(new Set(signalDefinitions.map(s=>s.id)).size,signalDefinitions.length);assert(signalDefinitions.some(s=>s.id==='ratings'));assert(signalDefinitions.some(s=>s.id==='voice'));assert.equal(signalDefinitions.find(s=>s.id==='hrv').enabled,false);});
