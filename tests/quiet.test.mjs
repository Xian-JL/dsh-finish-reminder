import {test} from 'node:test';import assert from 'node:assert/strict';
import {quietState,quietDelay} from '../src/core/quiet.mjs';import {decodeSettings} from '../src/shared/contracts.mjs';
const at=(day,hour,minute=0)=>new Date(2026,10,9+day,hour,minute); // Monday 9th, local time.
const schedule={quietScheduleEnabled:true,quietStart:'22:00',quietEnd:'08:00',quietDays:1<<1};
test('default upgrade leaves reminders on and quiet scheduling off',()=>{const s=decodeSettings({enabled:false,diagnosticsEnabled:false});assert.equal(s.enabled,false);assert.equal(s.quietUntil,0);assert.equal(s.quietScheduleEnabled,false);assert.equal(quietDelay(s),null);});
test('overnight schedule belongs to its start weekday with inclusive start/exclusive end',()=>{
  for(const [day,h,m,expected]of [[0,21,59,false],[0,22,0,true],[1,0,0,true],[1,7,59,true],[1,8,0,false],[1,22,0,false],[6,23,0,false]])
    assert.equal(quietState(schedule,at(day,h,m)).active,expected,`${day}/${h}:${m}`);
});
test('daytime schedules, all-day endpoints and no chosen weekday are explicit',()=>{
  const s={...schedule,quietStart:'09:00',quietEnd:'17:00'};
  assert.equal(quietState(s,at(0,9)).active,true);assert.equal(quietState(s,at(0,17)).active,false);
  assert.equal(quietState({...s,quietStart:'09:00',quietEnd:'09:00'},at(0,0)).active,true);
  assert.equal(quietState({...s,quietStart:'09:00',quietEnd:'09:00'},at(1,0)).active,false);
  assert.equal(quietState({...s,quietDays:0},at(0,10)).active,false);
});
test('temporary and schedule combine, cancellation does not cancel an active schedule',()=>{
  const now=at(0,23),until=now.getTime()+60000,s={...schedule,quietUntil:until};
  assert.equal(quietState(s,now).reason,'temporary');assert.equal(quietState({...s,quietUntil:0},now).reason,'schedule');
  assert.equal(quietState({quietUntil:until},new Date(until)).active,false);
  assert.equal(quietState(JSON.parse(JSON.stringify(s)),now).active,true,'restart must retain the deadline');
});
test('timers target expiry/minute boundaries and malformed settings never silently disable controls',()=>{
  assert.equal(quietDelay({quietUntil:10499},10000),499);assert.equal(quietDelay({quietUntil:10000},10000),null);
  assert.equal(quietDelay(schedule,60001),59999);
  for(const bad of [{quietStart:'24:00'},{quietEnd:'8:30'},{quietDays:128},{quietDays:-1},{quietUntil:NaN},{quietScheduleEnabled:'true'}])assert.throws(()=>decodeSettings(bad),/CONFIG_UNAVAILABLE/);
});
