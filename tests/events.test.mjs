import {test} from 'node:test';import assert from 'node:assert/strict';
import {EventAdapter} from '../src/host/events.mjs';import {fact,tick} from './fixtures.mjs';
function setup(){let resolve;const done=new Promise(r=>{resolve=r;});const session={id:'A',firstLiveSeq:10,isOwnSeq:s=>s>=10,header:{createdAt:1234}};
  const agent={id:'A',session,status:'running',whenIdle:()=>done,inbox:{hasPending:false}},facts=[],errors=[];
  const a=new EventAdapter({agents:{get:id=>id==='A'?agent:null},identity:()=>fact(),onFact:f=>facts.push(f),onError:c=>errors.push(c)});
  const emit=(type,seq,data)=>a.accept(session,{type,seq,data});return {a,session,agent,facts,errors,emit,finish:()=>{agent.status='idle';resolve();}};
}
for(const [reason,outcome]of Object.entries({completed:'ended',error:'error',aborted:'stopped',interrupted:'interrupted','max-tokens':'limited',blocked:'blocked',extensionReason:'unknown'}))test('real terminal classification: '+reason,async()=>{
  const s=setup();s.emit('turn/start',10,{turn:1});s.emit('step/start',11,{turn:1});s.emit('turn/end',12,{turn:1,reason:{kind:reason}});
  assert.equal(s.facts.length,0);s.finish();await tick();assert.equal(s.facts.length,1);assert.equal(s.facts[0].outcome,outcome);s.a.dispose();
});
test('idle before terminal and terminal before idle converge',async()=>{
  const s=setup();s.emit('turn/start',10,{turn:1});s.emit('step/start',11,{turn:1});s.finish();s.emit('turn/end',12,{turn:1,reason:{kind:'completed'}});await tick();assert.equal(s.facts.length,1);s.a.dispose();
});
test('waiting/continuation never commits intermediate terminal; final one only',async()=>{
  const s=setup();s.emit('turn/start',10,{turn:1});s.emit('step/start',11,{turn:1});s.emit('turn/end',12,{turn:1,reason:{kind:'completed'}});await tick();assert.equal(s.facts.length,0);
  s.emit('turn/start',13,{turn:2});s.emit('step/start',14,{turn:2});s.emit('turn/end',15,{turn:2,reason:{kind:'completed'}});s.finish();await tick();
  assert.equal(s.facts.length,1);assert.equal(s.facts[0].terminalEventSeq,15);s.a.dispose();
});
test('history, subagent, no-op and running=false alone do not create facts',async()=>{
  const s=setup();s.emit('turn/start',1,{turn:1});s.emit('turn/end',2,{turn:1,reason:{kind:'completed'}});
  s.emit('turn/start',10,{turn:2});s.emit('turn/end',11,{turn:2,reason:{kind:'completed'}});s.finish();await tick();assert.equal(s.facts.length,0);
  s.session.header.origin='subagent';s.emit('turn/start',12,{turn:3});s.emit('step/start',13,{turn:3});s.emit('turn/end',14,{turn:3,reason:{kind:'completed'}});await tick();assert.equal(s.facts.length,0);s.a.dispose();
});
test('pre-step failure over claimed work does notify and dispose cancels old result',async()=>{
  const s=setup();s.emit('turn/start',10,{turn:1});s.emit('agent/inbox/spliced',11,{removedCount:1,inserted:[]});s.emit('turn/end',12,{turn:1,reason:{kind:'error'}});
  s.finish();await tick();assert.equal(s.facts[0].outcome,'error');s.a.dispose();
  const other=setup();other.emit('turn/start',10,{turn:1});other.emit('step/start',11,{turn:1});other.emit('turn/end',12,{turn:1,reason:{kind:'completed'}});other.a.dispose();other.finish();await tick();assert.equal(other.facts.length,0);
});
test('a queued user claim establishes a new task even while the root driver stays running',async()=>{
  const s=setup();
  s.emit('turn/start',10,{turn:1});s.emit('step/start',11,{turn:1});s.emit('turn/end',12,{turn:1,reason:{kind:'completed'}});
  s.emit('agent/inbox/spliced',13,{target:'next-turn',start:0,inserted:[{id:'queued-user',source:{kind:'user'}}]});
  s.emit('turn/start',14,{turn:2});s.emit('agent/inbox/spliced',15,{target:'next-turn',start:0,removedCount:1,inserted:[]});
  s.a.claim({agent:s.agent,message:{id:'queued-user',source:{kind:'user'}},turn:2});
  await tick();assert.equal(s.facts.length,1);assert.equal(s.facts[0].terminalEventSeq,12);
  s.emit('step/start',16,{turn:2});s.emit('turn/end',17,{turn:2,reason:{kind:'completed'}});s.finish();await tick();
  assert.equal(s.facts.length,2);assert.notEqual(s.facts[0].taskEpisodeId,s.facts[1].taskEpisodeId);s.a.dispose();
});
