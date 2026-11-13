import {test} from 'node:test';import assert from 'node:assert/strict';
import {ReminderQueue} from '../src/core/queue.mjs';import {record} from './fixtures.mjs';
function setup(){let time=0;return {q:new ReminderQueue({now:()=>time}),at:x=>{time=x;}};}
test('A@0/B@5000: independent 10000ms foreground budgets, preview never consumes time',()=>{
  const {q,at}=setup();q.enqueue(record('A'));q.painted(q.token());at(5000);q.enqueue(record('B'));
  assert.equal(q.front.record.conversation.sessionId,'A');assert.equal(q.remaining(),5000);assert.equal(q.entries[1].remainingFrontMs,10000);
  at(10000);assert.equal(q.due(q.token()).state,'expired');assert.equal(q.front.record.conversation.sessionId,'B');assert.equal(q.remaining(),10000);
  q.painted(q.token());at(19999);assert.equal(q.due(q.token()),null);at(20000);q.due(q.token());assert.equal(q.front,undefined);
});
test('click A@7000 gives B until17000 and stale deadline cannot remove it',()=>{
  const {q,at}=setup();q.enqueue(record('A'));q.painted(q.token());const old=q.token();at(5000);q.enqueue(record('B'));at(7000);
  assert.equal(q.click(old).state,'opening');q.painted(q.token());at(10000);assert.equal(q.due(old),null);assert.equal(q.remaining(),7000);
  at(17000);q.due(q.token());assert.equal(q.entries.length,0);
});
test('simultaneous endings preserve FIFO and render at most two previews',()=>{
  const {q,at}=setup();for(const s of ['A','B','C','D'])q.enqueue(record(s));assert.equal(q.view().previews.length,2);
  for(let i=0;i<4;i++){assert.equal(q.front.record.conversation.sessionId,'ABCD'[i]);q.painted(q.token());at((i+1)*10000);q.due(q.token());}
  assert.equal(q.entries.length,0);
});
test('suspension and renderer replacement preserve remaining budget, old paint ignored',()=>{
  const {q,at}=setup();q.enqueue(record());const initial=q.token();q.painted(initial);at(4000);q.setAvailable(false);
  at(100000);assert.equal(q.remaining(),6000);q.setAvailable(true);assert.equal(q.painted(initial),false);q.painted(q.token());
  at(102000);q.rendererLost();assert.equal(q.remaining(),4000);at(105000);q.painted(q.token());at(109000);q.due(q.token());assert.equal(q.front,undefined);
});
test('expiry wins over late click and down/up across generations never clicks next',()=>{
  const {q,at}=setup();q.enqueue(record('A'));q.enqueue(record('B'));q.painted(q.token());const old=q.token();at(10000);
  assert.equal(q.click(old),null);q.painted(q.token());assert.equal(q.click(q.token(),old),null);assert.equal(q.front.record.conversation.sessionId,'B');
});
test('duplicate completion and disable/reenable cannot duplicate an old card',()=>{
  const {q}=setup();const a=record();assert.equal(q.enqueue(a),true);assert.equal(q.enqueue(a),false);q.disable();assert.equal(q.enqueue(record('B')),false);
  q.enable();assert.equal(q.enqueue(a),false);assert.equal(q.front,undefined);
});
test('capacity failure preserves existing queue',()=>{const q=new ReminderQueue({limit:1});q.enqueue(record('A'));assert.throws(()=>q.enqueue(record('B')),/QUEUE_CAPACITY_ERROR/);assert.equal(q.front.record.conversation.sessionId,'A');});
test('hover freezes the foreground budget and resumes it without resetting',()=>{
  const {q,at}=setup();q.enqueue(record('A'));q.painted(q.token());at(3000);
  assert.equal(q.hover(q.token(),true),true);assert.equal(q.front.state,'paused');
  at(9000);assert.equal(q.remaining(),7000);assert.equal(q.due(q.token()),null);
  assert.equal(q.hover(q.token(),false),true);assert.equal(q.front.state,'front');
  at(12000);assert.equal(q.remaining(),4000);at(16000);q.due(q.token());assert.equal(q.front,undefined);
});
test('click keeps the card while the source navigates and a failure is shown in place',()=>{
  const {q,at}=setup();q.enqueue(record('A'));q.painted(q.token());const t=q.token();at(2000);
  assert.equal(q.beginOpen(t).state,'opening');assert.equal(q.click(t),null);
  assert.equal(q.failOpen(t,'FOREGROUND_DENIED').error,'FOREGROUND_DENIED');
  assert.equal(q.front.state,'front');assert.equal(q.clearError(t),true);assert.equal(q.front.error,undefined);
  assert.equal(q.beginOpen(t).state,'opening');assert.equal(q.completeOpen(t).state,'opening');assert.equal(q.front,undefined);
});
