import {test} from 'node:test';import assert from 'node:assert/strict';import {ClientHub} from '../src/host/clients.mjs';
import {CompletionStore,MemoryStorage} from '../src/core/store.mjs';import {fact,tick} from './fixtures.mjs';
async function fixture(){const store=new CompletionStore(new MemoryStorage());await store.load();const {record}=await store.submit(fact());
  const runtime={store,enabled:true,capabilities:{},ctx:{get:()=>null},publish(){},async render(){},bridge:{group:true,async request(method){return method==='bindWindow'?{windowToken:'bound-window'}:{foreground:true,interactive:true,userInput:true};}},status:()=>({})};
  const hub=new ClientHub(runtime);runtime.clients=hub;await hub.update({clientId:'client-one',desktop:true,sessionId:'A',focused:true,userIntent:1,x:0,y:0,width:800,height:600});
  hub.clients.get('client-one').send=()=>{};return {hub,runtime,store,record};
}
test('navigation requires matching Client, visible boundary and actual foreground evidence',async()=>{
  const {hub,record}=await fixture();const abort=new AbortController();let request;
  hub.clients.get('client-one').send=(type,data)=>{if(type==='navigate')request=data;};
  const open=hub.openAndObserve({conversation:record.conversation,boundary:{streamEpoch:record.streamEpoch,throughSeq:10},requestId:'nav-one',signal:abort.signal});
  await tick();assert.equal(request.sessionId,'A');
  assert.deepEqual(await hub.navigationResult({...request,clientId:'other',ok:true}),{ignored:true});
  await hub.navigationResult({...request,clientId:'client-one',ok:true,mainView:true,visible:true,focused:true});
  assert.equal((await open).foreground,true);hub.dispose();
});
test('focus during popup navigation cannot acknowledge the previously visible conversation',async()=>{
  const {hub,record,store}=await fixture();const abort=new AbortController();
  const open=hub.openAndObserve({conversation:record.conversation,boundary:{streamEpoch:record.streamEpoch,throughSeq:10},requestId:'nav-one',signal:abort.signal});open.catch(()=>{});
  await assert.rejects(hub.manualRead({clientId:'client-one',sessionId:'A',mainView:true,visible:true,focused:true,userIntent:1,throughSeq:10,streamEpoch:'1234',completionId:record.id}),/VIEW_UNCONFIRMED/);
  assert.equal(store.snapshot().count,1);abort.abort();await assert.rejects(open);hub.dispose();
});
test('manual read rejects injected input and preserves newer terminal boundary',async()=>{
  const {hub,runtime,record,store}=await fixture();const evidence={clientId:'client-one',sessionId:'A',mainView:true,visible:true,focused:true,userIntent:1,throughSeq:10,streamEpoch:'1234',completionId:record.id};
  runtime.bridge.request=async()=>({foreground:true,userInput:false});await assert.rejects(hub.manualRead(evidence),/VIEW_UNCONFIRMED/);
  await store.submit(fact('A',20));runtime.bridge.request=async()=>({foreground:true,userInput:true});await hub.manualRead(evidence);
  assert.equal(store.snapshot().records[0].readState,'acknowledged');assert.equal(store.snapshot().records[1].readState,'unread');hub.dispose();
});
test('new user intent cancels pending navigation without acknowledging its old target',async()=>{
  const {hub,record,store}=await fixture();const abort=new AbortController();const open=hub.openAndObserve({conversation:record.conversation,boundary:{streamEpoch:'1234',throughSeq:10},requestId:'nav-one',signal:abort.signal});open.catch(()=>{});
  await tick();await hub.update({clientId:'client-one',desktop:true,sessionId:'B',focused:true,userIntent:2,x:0,y:0,width:800,height:600});
  await assert.rejects(open,/NAVIGATION_CANCELLED/);assert.equal(store.snapshot().count,1);assert.equal(hub.pending.size,0);hub.dispose();
});
test('notification center navigation explicitly selects the requesting Client window',async()=>{
  const {hub,record}=await fixture();await hub.update({clientId:'client-two',desktop:true,sessionId:'B',focused:true,userIntent:3,x:200,y:0,width:800,height:600});
  let firstNavigated=false,request;hub.clients.get('client-one').send=type=>{if(type==='navigate')firstNavigated=true;};hub.clients.get('client-two').send=(type,data)=>{if(type==='navigate')request=data;};
  const controller=new AbortController(),opened=hub.openAndObserve({conversation:record.conversation,boundary:{streamEpoch:'1234',throughSeq:10},requestId:'nav-two',clientId:'client-two',signal:controller.signal});
  await tick();assert.equal(firstNavigated,false);assert.equal(request.userIntent,3);
  await hub.navigationResult({...request,clientId:'client-two',ok:true,mainView:true,visible:true,focused:true});assert.equal((await opened).foreground,true);hub.dispose();
});
