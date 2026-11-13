import {test} from 'node:test';import assert from 'node:assert/strict';import {EventAdapter} from '../src/host/events.mjs';import {fact,tick} from './fixtures.mjs';
function fixture(){let wall=10000,mono=0,resolve;const idle=new Promise(r=>resolve=r),session={id:'A',header:{createdAt:1234},firstLiveSeq:0,isOwnSeq:()=>true};
  const agent={id:'A',session,status:'running',inbox:{hasPending:false},whenIdle:()=>idle},facts=[];
  const adapter=new EventAdapter({agents:{get:()=>agent},identity:()=>fact(),onFact:r=>facts.push(r),now:()=>wall,monoNow:()=>mono});
  return {adapter,agent,facts,session,at:(w,m)=>{wall=w;mono=m;},emit:(type,seq,data)=>adapter.accept(session,{type,seq,data,time:wall}),end:()=>{agent.status='idle';resolve();}};
}
test('duration uses monotonic observation across auto-continuation and a wall clock adjustment',async()=>{
  const s=fixture();try{
    s.emit('turn/start',0,{turn:1});s.emit('step/start',1,{turn:1});s.at(10500,500);s.emit('turn/end',2,{turn:1,reason:{kind:'completed'}});
    s.emit('turn/start',3,{turn:2});s.emit('step/start',4,{turn:2});s.at(5000,1500);s.emit('turn/end',5,{turn:2,reason:{kind:'completed'}});s.end();await tick();
    assert.equal(s.facts.length,1);assert.equal(s.facts[0].startedAt,10000);assert.equal(s.facts[0].durationMs,1500);assert.equal(s.facts[0].endedAt,5000);
  }finally{s.adapter.dispose();}
});
test('a task already running at activation keeps unknown start/duration instead of inventing one',async()=>{
  const s=fixture();try{s.agent.phase={kind:'running',turn:1,step:2};s.emit('turn/end',0,{turn:1,reason:{kind:'completed'}});s.agent.phase={kind:'idle'};s.end();await tick();
    assert.equal(s.facts[0].startedAt,null);assert.equal(s.facts[0].durationMs,null);
  }finally{s.adapter.dispose();}
});
test('queued user task gets its own start time rather than inheriting the earlier episode',async()=>{
  const s=fixture();try{
    s.emit('turn/start',0,{turn:1});s.emit('step/start',1,{turn:1});s.at(11000,1000);s.emit('turn/end',2,{turn:1,reason:{kind:'completed'}});
    s.emit('agent/inbox/spliced',3,{target:'next-turn',start:0,inserted:[{id:'next-user',source:{kind:'user'}}]});
    s.at(11500,1500);s.emit('turn/start',4,{turn:2});s.emit('agent/inbox/spliced',5,{target:'next-turn',start:0,removedCount:1,inserted:[]});
    s.adapter.claim({agent:s.agent,message:{id:'next-user'},turn:2});s.emit('step/start',6,{turn:2});s.at(12000,2000);s.emit('turn/end',7,{turn:2,reason:{kind:'completed'}});s.end();await tick();
    assert.equal(s.facts.length,2);assert.equal(s.facts[0].durationMs,1000);assert.equal(s.facts[1].durationMs,500);assert.equal(s.facts[1].startedAt,11500);
  }finally{s.adapter.dispose();}
});
