import test from 'node:test';
import assert from 'node:assert/strict';
import {nextReminderOccurrence,resolveReminderWallTime,validateReminderSchedule} from '../worker/daily-reminder-schedule.mjs';
const s=(overrides={})=>({frequency:'daily',weekdays:[1],localTime:'09:00',timeZone:'America/New_York',...overrides});
test('default opt-in is not represented by the schedule helper',()=>{
 const config=validateReminderSchedule(s());
 assert.deepEqual(config.weekdays,[1]);
 assert.throws(()=>validateReminderSchedule(s({timeZone:'Not/A_Real_Zone'})),/timezone/);
 assert.throws(()=>validateReminderSchedule(s({weekdays:[1,1]})),/weekdays/);
 assert.throws(()=>validateReminderSchedule(s({localTime:'24:00'})),/time/);
});
test('spring nonexistent time rolls forward to 03:00 EDT',()=>{
 assert.equal(resolveReminderWallTime('2026-03-08',s({localTime:'02:30'})),'2026-03-08T07:00:00.000Z');
});
test('fall repeated 01:30 uses first occurrence only',()=>{
 assert.equal(resolveReminderWallTime('2026-11-01',s({localTime:'01:30'})),'2026-11-01T05:30:00.000Z');
 assert.equal(nextReminderOccurrence(s({localTime:'01:30'}),Date.parse('2026-11-01T05:30:00Z')).localDay,'2026-11-02');
});
test('weekly weekdays use account timezone, not Pacific game day',()=>{
 const next=nextReminderOccurrence(s({frequency:'weekly',weekdays:[1],timeZone:'Asia/Tokyo'}),Date.parse('2026-10-18T23:00:00Z'));
 assert.equal(next.localDay,'2026-10-19');
 assert.equal(next.dueAt,'2026-10-19T00:00:00.000Z');
});
test('schedule edits and timezone changes select a future occurrence',()=>{
 const before=nextReminderOccurrence(s(),Date.parse('2026-10-18T15:00:00Z'));
 const after=nextReminderOccurrence(s({timeZone:'America/Los_Angeles'}),Date.parse('2026-10-18T15:00:00Z'));
 assert.notEqual(before.dueAt,after.dueAt);
 const custom=nextReminderOccurrence(s({frequency:'custom',weekdays:[2,4]}),Date.parse('2026-10-18T15:00:00Z'));
 assert.equal(custom.localDay,'2026-10-20');
});
