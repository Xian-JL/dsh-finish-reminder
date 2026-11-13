import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {NativeBridge} from '../src/host/bridge.mjs';
function fixture(){const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.sent=[];
  c.stdin.write=line=>c.sent.push(JSON.parse(line));c.kill=()=>{c.killed=true;};
  const bridge=new NativeBridge({factory:()=>c});const response=(m,payload)=>c.stdout.emit('data',Buffer.from(JSON.stringify({...m,type:'response',payload})+'\n'));
  return {c,bridge,response};
}
test('malformed error settles all pending promises, never strands one after removal',async()=>{
  const {c,bridge,response}=fixture();const a=bridge.request('hello'),b=bridge.request('geometry');
  const results=Promise.allSettled([a,b]);response(c.sent[0],{ok:false,code:{bad:true}});
  assert.deepEqual((await results).map(x=>x.reason.code),['PROTOCOL_ERROR','PROTOCOL_ERROR']);assert.equal(bridge.pending.size,0);assert.equal(c.killed,true);
});
test('wrong nonce or oversized frame closes channel and rejects outstanding request',async()=>{
  for(const kind of ['nonce','large']){
    const {c,bridge,response}=fixture();const p=bridge.request('hello');
    if(kind==='nonce')response({...c.sent[0],nonce:'incorrect'},{ok:true,value:{}});else c.stdout.emit('data',Buffer.alloc(32769,65));
    await assert.rejects(p,/PROTOCOL_ERROR/);assert.equal(bridge.pending.size,0);
  }
});
test('valid split UTF8 response resolves once, late response ignored, timeout settles',async()=>{
  const {c,bridge}=fixture();const p=bridge.request('hello');const m={...c.sent[0],type:'response',payload:{ok:true,value:{name:'娴嬭瘯'}}};
  const frame=Buffer.from(JSON.stringify(m)+'\n');for(let i=0;i<frame.length;i++)c.stdout.emit('data',frame.subarray(i,i+1));
  assert.deepEqual(await p,{name:'娴嬭瘯'});c.stdout.emit('data',frame);assert.equal(bridge.pending.size,0);
  await assert.rejects(bridge.request('hello',{},10),/HELPER_TIMEOUT/);bridge.broken('HELPER_EXITED');
});
test('hover events require a boolean paused flag',async()=>{
  const seen=[];const {c,bridge,response}=fixture();bridge.onEvent=e=>seen.push(e);
  const p=bridge.request('hello');response(c.sent[0],{ok:true,value:{}});await p;
  const envelope=payload=>({protocolVersion:1,nonce:c.sent[0].nonce,ownerInstance:c.sent[0].ownerInstance,
    generation:c.sent[0].generation,requestId:'evt',revision:1,type:'event',payload});
  c.stdout.emit('data',Buffer.from(JSON.stringify(envelope({kind:'hover',cardId:'card',displayGeneration:1,paused:true}))+'\n'));
  assert.equal(seen.length,1);assert.equal(seen[0].paused,true);
  const pending=bridge.request('hello');
  c.stdout.emit('data',Buffer.from(JSON.stringify(envelope({kind:'hover',cardId:'card',displayGeneration:1}))+'\n'));
  await assert.rejects(pending,/PROTOCOL_ERROR/);assert.equal(bridge.closed,true);
});

test('a broken bridge rejects instead of throwing so teardown cannot abort the host',async()=>{
  const {bridge}=fixture();
  bridge.broken('HELPER_EXITED');
  const pending=bridge.request('hello');
  await assert.rejects(pending,/HELPER_EXITED/);
  await bridge.dispose();
  assert.equal(bridge.closed,true);
});