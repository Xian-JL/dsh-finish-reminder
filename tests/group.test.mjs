import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {randomUUID} from 'node:crypto';
import {GroupBridge} from '../src/host/group.mjs';import {fact,tick} from './fixtures.mjs';import {validateFact} from '../src/shared/contracts.mjs';
function nativeFactory(children){return ()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.requests=[];c.killed=false;
  c.kill=()=>{c.killed=true;};c.stdin.write=line=>{const m=JSON.parse(line);c.requests.push(m);
    let value={applied:true};if(m.type==='hello')value={version:'0.3.0',popup:true,badge:true,navigation:true};if(m.type==='registerDesktop')value={desktop:true};
    if(m.type==='bindWindow')value={bound:true,windowToken:'native-token'};
    queueMicrotask(()=>c.stdout.emit('data',Buffer.from(JSON.stringify({...m,type:'response',payload:{ok:true,value}})+'\n')));
  };children.push(c);return c;};}
test('quiet source records counts but neither queues nor replays silenced completions',async()=>{
  const path='\\\\.\\pipe\\dsh-reminder-quiet-'+randomUUID(),children=[];
  const a=new GroupBridge({path,nativeFactory:nativeFactory(children)});
  try{
    await a.request('register',{sourceId:'quiet-source',count:1,revision:1,hostPid:process.pid,quiet:true});
    const record=validateFact(fact('A',1,{conversation:{...fact().conversation,hostInstanceId:'quiet-source'}}));
    const submitted=await a.request('submit',{record});assert.equal(submitted.silenced,true);assert.equal(submitted.queued,false);
    assert.equal(children[0].requests.filter(r=>r.type==='badge').at(-1).payload.count,1);
    await a.request('snapshot',{count:1,revision:1,quiet:false});
    assert.equal(children[0].requests.filter(r=>r.type==='syncView').at(-1).payload.front,null);
    assert.equal((await a.request('submit',{record})).silenced,true,'lost-response replay must retain its silent disposition');
    const next=validateFact(fact('B',2,{conversation:{...fact('B').conversation,hostInstanceId:'quiet-source'}}));
    assert.equal((await a.request('submit',{record:next})).queued,true);
  }finally{await a.dispose();await new Promise(r=>setTimeout(r,25));}
});
test('entering quiet removes only that source queue; running context updates do not reset generations',async()=>{
  const path='\\\\.\\pipe\\dsh-reminder-quiet-'+randomUUID(),children=[],removed=[];
  const a=new GroupBridge({path,nativeFactory:nativeFactory(children),onEvent:e=>removed.push(e)}),b=new GroupBridge({path,nativeFactory:nativeFactory(children)});
  const make=(id,source)=>validateFact(fact(id,1,{conversation:{...fact(id).conversation,hostInstanceId:source},workspaceId:'workspace',workspaceTitle:'项目A',durationMs:2300}));
  try{
    await a.request('register',{sourceId:'one',count:1,revision:1,hostPid:process.pid});await b.request('register',{sourceId:'two',count:1,revision:1,hostPid:process.pid});
    const ra=make('A','one'),rb=make('B','two');await a.request('submit',{record:ra});await b.request('submit',{record:rb});
    await a.request('running',{conversation:ra.conversation,running:true,revision:2});
    let view=children[0].requests.filter(r=>r.type==='syncView').at(-1).payload.front;assert.equal(view.currentlyRunning,true);assert.equal(view.workspaceTitle,'项目A');assert.equal(view.durationMs,2300);
    const generation=view.displayGeneration;await a.request('running',{conversation:ra.conversation,running:false,revision:1});view=children[0].requests.filter(r=>r.type==='syncView').at(-1).payload.front;
    assert.equal(view.currentlyRunning,true);assert.equal(view.displayGeneration,generation);
    await a.request('snapshot',{count:1,revision:1,quiet:true});await tick();
    assert.equal(children[0].requests.filter(r=>r.type==='syncView').at(-1).payload.front.cardId,rb.id);
    assert.ok(removed.some(e=>e.kind==='cardRemoved'&&e.completionId===ra.id));
    assert.equal(children[0].requests.filter(r=>r.type==='badge').at(-1).payload.count,2);
  }finally{await a.dispose();await b.dispose();await new Promise(r=>setTimeout(r,25));}
});
test('independent hosts share one coordinator, aggregate exact counts and route each card to its source',async()=>{
  const path='\\\\.\\pipe\\dsh-reminder-test-'+randomUUID(),children=[],eventsA=[],eventsB=[];
  const a=new GroupBridge({path,nativeFactory:nativeFactory(children),onEvent:e=>eventsA.push(e)}),b=new GroupBridge({path,nativeFactory:nativeFactory(children),onEvent:e=>eventsB.push(e)});
  try{
    await a.request('register',{sourceId:'sourceA',count:1,revision:1,hostPid:process.pid});
    await b.request('register',{sourceId:'sourceB',count:2,revision:1,hostPid:process.pid});
    assert.equal(children.length,1);assert.equal(children[0].requests.filter(r=>r.type==='badge').at(-1).payload.count,3);
    const first=validateFact(fact('A',10,{conversation:{...fact().conversation,hostInstanceId:'sourceA'}}));
    const second=validateFact(fact('B',20,{conversation:{...fact().conversation,hostInstanceId:'sourceB'}}));
    await a.request('submit',{record:first});await b.request('submit',{record:second});await a.request('submit',{record:first});
    const native=children[0],front=native.requests.filter(r=>r.type==='syncView').at(-1).payload.front;
    assert.equal(front.cardId,first.id);assert.equal(native.requests.filter(r=>r.type==='syncView').at(-1).payload.previews.length,1);
    const request=native.requests.at(-1);
    const emit=payload=>native.stdout.emit('data',Buffer.from(JSON.stringify({...request,type:'event',requestId:randomUUID(),payload})+'\n'));
    emit({kind:'painted',cardId:front.cardId,displayGeneration:front.displayGeneration});await tick();
    emit({kind:'click',cardId:front.cardId,displayGeneration:front.displayGeneration});
    await new Promise(r=>setTimeout(r,15));
    assert.equal(eventsA.filter(e=>e.kind==='click').length,1);assert.equal(eventsB.filter(e=>e.kind==='click').length,0);
    // The card stays on screen while the owning source navigates; only clickDone advances the queue.
    assert.equal(native.requests.filter(r=>r.type==='syncView').at(-1).payload.front.state,'opening');
    await a.request('clickDone',{completionId:first.id,ok:true});
    assert.equal(native.requests.filter(r=>r.type==='syncView').at(-1).payload.front.cardId,second.id);
    await b.request('snapshot',{count:0,revision:2});assert.equal(native.requests.filter(r=>r.type==='badge').at(-1).payload.count,1);
  }finally{await a.dispose();await b.dispose();await new Promise(r=>setTimeout(r,25));}
  assert.equal(children[0].killed,true);
});
test('hover pauses the foreground budget and resumes it',async()=>{
  const path='\\\\.\\pipe\\dsh-reminder-test-'+randomUUID(),children=[];
  const a=new GroupBridge({path,nativeFactory:nativeFactory(children)});
  try{
    await a.request('register',{sourceId:'sourceHover',count:1,revision:1,hostPid:process.pid});
    const rec=validateFact(fact('H',10,{conversation:{...fact().conversation,hostInstanceId:'sourceHover'}}));await a.request('submit',{record:rec});
    const native=children[0],front=native.requests.filter(r=>r.type==='syncView').at(-1).payload.front;
    const request=native.requests.at(-1);
    const emit=payload=>native.stdout.emit('data',Buffer.from(JSON.stringify({...request,type:'event',requestId:randomUUID(),payload})+'\n'));
    emit({kind:'painted',cardId:front.cardId,displayGeneration:front.displayGeneration});await tick();
    emit({kind:'hover',cardId:front.cardId,displayGeneration:front.displayGeneration,paused:true});await tick();
    assert.equal(native.requests.filter(r=>r.type==='syncView').at(-1).payload.front.state,'paused');
    emit({kind:'hover',cardId:front.cardId,displayGeneration:front.displayGeneration,paused:false});await tick();
    assert.equal(native.requests.filter(r=>r.type==='syncView').at(-1).payload.front.state,'front');
  }finally{await a.dispose();await new Promise(r=>setTimeout(r,25));}
});
test('a failed navigation keeps the card with a visible error code',async()=>{
  const path='\\\\.\\pipe\\dsh-reminder-test-'+randomUUID(),children=[];
  const a=new GroupBridge({path,nativeFactory:nativeFactory(children)});
  try{
    await a.request('register',{sourceId:'sourceFail',count:1,revision:1,hostPid:process.pid});
    const rec=validateFact(fact('F',10,{conversation:{...fact().conversation,hostInstanceId:'sourceFail'}}));await a.request('submit',{record:rec});
    const native=children[0],front=native.requests.filter(r=>r.type==='syncView').at(-1).payload.front;
    const request=native.requests.at(-1);
    const emit=payload=>native.stdout.emit('data',Buffer.from(JSON.stringify({...request,type:'event',requestId:randomUUID(),payload})+'\n'));
    emit({kind:'painted',cardId:front.cardId,displayGeneration:front.displayGeneration});await tick();
    emit({kind:'click',cardId:front.cardId,displayGeneration:front.displayGeneration});await new Promise(r=>setTimeout(r,15));
    await a.request('clickDone',{completionId:rec.id,ok:false,code:'FOREGROUND_DENIED'});
    const view=native.requests.filter(r=>r.type==='syncView').at(-1).payload.front;
    assert.equal(view.state,'front');assert.equal(view.error,'FOREGROUND_DENIED');
    await new Promise(r=>setTimeout(r,2100));
    assert.equal(native.requests.filter(r=>r.type==='syncView').at(-1).payload.front.error,undefined);
  }finally{await a.dispose();await new Promise(r=>setTimeout(r,25));}
});
test('live source cannot be overwritten by a second connection with same source identity',async()=>{
  const path='\\\\.\\pipe\\dsh-reminder-test-'+randomUUID(),children=[];
  const a=new GroupBridge({path,nativeFactory:nativeFactory(children)}),b=new GroupBridge({path,nativeFactory:nativeFactory(children)});
  try{await a.request('register',{sourceId:'same-source',count:5,revision:1,hostPid:process.pid});
    await assert.rejects(b.request('register',{sourceId:'same-source',count:0,revision:2,hostPid:process.pid}),/SOURCE_OWNER_CONFLICT/);
    const result=await a.request('snapshot',{count:4,revision:2});assert.equal(result.count,4);
  }finally{await a.dispose();await b.dispose();await new Promise(r=>setTimeout(r,25));}
});
test('native death closes the dead coordinator and a new owner restores counts without old popup replay',async()=>{
  const path='\\\\.\\pipe\\dsh-reminder-test-'+randomUUID(),children=[],make=()=>new GroupBridge({path,nativeFactory:nativeFactory(children)});
  const first=make();await first.request('register',{sourceId:'sourceA',count:2,revision:1,hostPid:process.pid});
  children[0].emit('exit',1);await new Promise(r=>setTimeout(r,25));assert.equal(first.closed,true);
  const next=make();try{
    await next.request('register',{sourceId:'sourceA',count:2,revision:1,hostPid:process.pid});assert.equal(children.length,2);
    assert.equal(children[1].requests.filter(r=>r.type==='syncView').at(-1).payload.front,null);
    assert.equal(children[1].requests.filter(r=>r.type==='badge').at(-1).payload.count,2);
  }finally{await first.dispose();await next.dispose();await new Promise(r=>setTimeout(r,25));}
});

test('coordinator teardown after native death survives a bound client',async()=>{
  const path='\\\\.\\pipe\\dsh-reminder-test-'+randomUUID(),children=[];
  const a=new GroupBridge({path,nativeFactory:nativeFactory(children)});
  try{
    await a.request('register',{sourceId:'sourceT',count:1,revision:1,hostPid:process.pid});
    await a.request('bindWindow',{clientId:'client-12345678',x:0,y:0,width:10,height:10});
    children[0].emit('exit',1);
    await new Promise(r=>setTimeout(r,60));
    assert.equal(a.closed,true);
  }finally{await a.dispose();await new Promise(r=>setTimeout(r,25));}
});
