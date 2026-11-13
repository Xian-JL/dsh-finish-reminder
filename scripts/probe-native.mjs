// Real native windows, synthetic conversations, no DSH profile or model access.
import {NativeBridge} from '../src/host/bridge.mjs';
import {ReminderQueue} from '../src/core/queue.mjs';
import {record} from '../tests/fixtures.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),timeline=[],start=performance.now();
const stamp=(kind,data={})=>{const e={kind,atMs:Math.round(performance.now()-start),...data};timeline.push(e);console.log(JSON.stringify(e));};
const queue=new ReminderQueue();let timer,chain=Promise.resolve(),before,changed=false,interacted=false;
const bridge=new NativeBridge({onEvent:event=>{
  stamp(event.kind,{card:event.cardId?.includes('"A"')?'A':event.cardId?.includes('"B"')?'B':null});
  if(event.kind==='painted')queue.painted(event);
  else if(event.kind==='availability')queue.setAvailable(event.available);
  else if(event.kind==='click'){interacted=true;queue.click(event);}
  else if(event.kind==='dismiss'){interacted=true;queue.dismiss(event);}
  void render();
},onError:code=>{if(code!=='HELPER_EXITED')stamp('error',{code});}});
function render(){
  chain=chain.then(async()=>{
    clearTimeout(timer);const v=queue.view();
    const result=await bridge.request('syncView',{front:v.front,previews:v.previews,queued:v.queued,available:v.available,dark:true});
    if(before!==undefined&&result.foregroundAfter!==before)changed=true;
    if(queue.front?.state==='front'){
      const token=queue.token();timer=setTimeout(()=>{stamp('expiry',{card:queue.front?.record.conversation.sessionId});queue.due(token);void render();},Math.ceil(queue.remaining()));
    }
  });return chain;
}
let exitResolve;const exited=new Promise(r=>exitResolve=r);
try {
  const capability=await bridge.request('hello');before=capability.foregroundBefore;stamp('hello',{capability});
  const geometry=await bridge.request('geometry');stamp('geometry',geometry);
  queue.enqueue(record('A'));await render();
  const add=setTimeout(()=>{queue.enqueue(record('B'));stamp('enqueue',{card:'B'});void render();},5000);
  const finish=setTimeout(exitResolve,22000);
  bridge.child.once('exit',()=>exitResolve());
  await exited;clearTimeout(add);clearTimeout(finish);clearTimeout(timer);await chain;
  assert.equal(queue.entries.length,0,'All synthetic reminders must expire.');
  const expiry=timeline.filter(x=>x.kind==='expiry');if(!interacted)assert.equal(expiry.length,2);
  const paint=timeline.filter(x=>x.kind==='painted');assert.equal(paint.length,2);
  if(!interacted)for(let i=0;i<2;i++)assert.ok(Math.abs(expiry[i].atMs-paint[i].atMs-10000)<150,'Foreground budget outside measurement tolerance.');
  assert.equal(changed,false,'Foreground changed during non-activating display (external user activity also invalidates this check).');
  stamp('result',{status:interacted?'PARTIAL':'PASS',scope:interacted?'real user clicked synthetic reminders; uninterrupted timing case not completed':'real native FIFO/timing/geometry and foreground handles; synthetic conversation identities; no real taskbar badge or DSH navigation test'});
} catch(e){stamp('result',{status:'FAIL',code:e.code??e.message});process.exitCode=1;}
finally {
  clearTimeout(timer);await bridge.dispose();
  await mkdir(new URL('.verification/',root),{recursive:true});
  await writeFile(new URL('.verification/native-probe.json',root),JSON.stringify({version:'0.3.0',timeline},null,2));
}
