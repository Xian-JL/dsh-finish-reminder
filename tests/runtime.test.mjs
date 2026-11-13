import {test} from 'node:test';import assert from 'node:assert/strict';
import {Runtime} from '../src/host/runtime.mjs';import {CompletionStore,MemoryStorage} from '../src/core/store.mjs';
import {fact,tick} from './fixtures.mjs';
async function fixture(){const children=[],storage=new MemoryStorage(),store=new CompletionStore(storage),ctx={get:k=>k==='agents'?{get:()=>null}:k==='profileContext'?{name:'fixture',dir:'C:\\fixture'}:undefined};
  const runtime=new Runtime(ctx,{store,bridge:hooks=>{const child={hooks,disposed:false,calls:[],async request(type,payload){this.calls.push({type,payload});return type==='hello'?{version:'0.3.0',popup:true,badge:false,navigation:false}:{};},async dispose(){this.disposed=true;}};children.push(child);return child;}});
  await runtime.start();await runtime.setEnabled(true);return {runtime,children,storage,store};
}
test('durable event drives native view, dismissal preserves count and click cannot fake navigation',async()=>{
  const {runtime,children}=await fixture();try{
    await runtime.commit(fact('A',10));await runtime.commit(fact('B',20));const child=children[0];
    let token=runtime.queue.token();child.hooks.onEvent({kind:'painted',...token});await runtime.renderTasks;
    child.hooks.onEvent({kind:'dismiss',...token});await runtime.renderTasks;assert.equal(runtime.status().count,2);assert.equal(runtime.queue.entries.length,1);
    token=runtime.queue.token();child.hooks.onEvent({kind:'painted',...token});await runtime.renderTasks;
    child.hooks.onEvent({kind:'click',...token});await runtime.renderTasks;assert.equal(runtime.queue.entries.length,0);
    assert.equal(runtime.status().count,2);assert.equal(runtime.status().eventError,'DESKTOP_BRIDGE_UNAVAILABLE');assert.equal(runtime.status().status,'popup-only');
  }finally{await runtime.dispose();}assert.equal(children[0].disposed,true);
});
test('failed commit can be flushed once, without losing the pending reminder or duplicating it',async()=>{
  const {runtime,storage}=await fixture();try{
    storage.failWrites=true;await runtime.commit(fact());assert.equal(runtime.status().count,1);assert.equal(runtime.queue.entries.length,0);
    storage.failWrites=false;await runtime.retryStorage();assert.equal(runtime.queue.entries.length,1);await runtime.commit(fact());assert.equal(runtime.queue.entries.length,1);
  }finally{await runtime.dispose();}
});
test('20 stop/start cycles dispose owners, preserve unread and reject old callbacks',async()=>{
  const {runtime,children}=await fixture();try{
    await runtime.commit(fact());const old=children[0],token=runtime.queue.token();
    for(let i=0;i<20;i++){await runtime.setEnabled(false);assert.equal(children.at(-1).disposed,true);await runtime.setEnabled(true);assert.equal(runtime.queue.entries.length,0);assert.equal(runtime.status().count,1);}
    old.hooks.onEvent({kind:'click',...token});assert.equal(runtime.status().eventError,null);assert.equal(runtime.queue.entries.length,0);
  }finally{await runtime.dispose();}assert.equal(children.filter(c=>!c.disposed).length,0);assert.equal(runtime.timer,null);
});
test('faulted state never advertises complete desktop support or known-zero after unread storage failure',async()=>{
  const {runtime}=await fixture();try{runtime.setError('STATE_UNAVAILABLE');assert.equal(runtime.status().status,'faulted');assert.equal(runtime.status().acceptance,'USER_PENDING');}finally{await runtime.dispose();}
});
test('metadata retirement distinguishes a released live target from a confirmed missing persisted target',async()=>{
  const {runtime}=await fixture();try{
    const old=runtime.ctx.get;runtime.ctx.get=k=>k==='sessions'?{get:id=>id==='A'?{id}:undefined}:k==='sessionPersistence'?{stat:async()=>undefined}:old(k);
    await runtime.commit(fact('A',10));await runtime.commit(fact('B',20));await runtime.sweepTargets();
    assert.equal(runtime.status().count,1);assert.equal(runtime.store.data.records.find(r=>r.conversation.sessionId==='A').readState,'unread');
    assert.equal(runtime.store.data.records.find(r=>r.conversation.sessionId==='B').readState,'retired');
  }finally{await runtime.dispose();}
});
test('temporary quiet survives configuration changes without restarting subscription or clearing unread',async()=>{
  const {runtime,children}=await fixture();try{
    const adapter=runtime.events;await runtime.commit(fact('A',1));assert.equal(runtime.queue.entries.length,1);
    await runtime.configure({enabled:true,quietUntil:Date.now()+60000});assert.equal(runtime.queue.entries.length,0);assert.equal(runtime.events,adapter);assert.equal(runtime.status().count,1);
    await runtime.commit(fact('B',2));assert.equal(runtime.queue.entries.length,0);assert.equal(runtime.status().count,2);assert.equal(runtime.store.data.records[1].silenced,true);
    await runtime.configure({enabled:true,quietUntil:0});assert.equal(runtime.queue.entries.length,0);assert.equal(runtime.events,adapter);assert.equal(children.length,1);
    await runtime.commit(fact('C',3));assert.equal(runtime.queue.entries.length,1);assert.equal(runtime.center().items.length,3);
  }finally{await runtime.dispose();}assert.equal(runtime.quietTimer!==null,false);
});
