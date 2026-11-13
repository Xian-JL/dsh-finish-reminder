import {test} from 'node:test';import assert from 'node:assert/strict';
import {NavigationController} from '../src/core/navigation.mjs';import {CompletionStore,MemoryStorage} from '../src/core/store.mjs';import {fact,tick} from './fixtures.mjs';
async function setup(adapter,timeoutMs=50){const store=new CompletionStore(new MemoryStorage());await store.load();const {record}=await store.submit(fact());return {store,record,nav:new NavigationController({store,adapter,timeoutMs})};}
test('void openSession result or foreground alone never acknowledges',async()=>{
  const s=await setup({openAndObserve:async()=>undefined});await assert.rejects(s.nav.open(s.record,'request1'),/NAVIGATION_UNCONFIRMED/);assert.equal(s.store.snapshot().count,1);s.nav.dispose();
});
test('bounded success cannot acknowledge completion that arrives while opening',async()=>{
  let resolve;const s=await setup({openAndObserve:()=>new Promise(r=>resolve=r)});const pending=s.nav.open(s.record,'request1');await s.store.submit(fact('A',20));
  resolve({conversation:s.record.conversation,foreground:true,interactive:true,mainView:true,userIntentValid:true,streamEpoch:'1234',visibleThroughSeq:20});await pending;
  assert.equal(s.store.snapshot().records[1].readState,'unread');assert.equal(s.store.snapshot().count,1);s.nav.dispose();
});
test('ignored AbortSignal still times out and duplicate request cannot run twice',async()=>{
  let calls=0;const s=await setup({openAndObserve:()=>{calls++;return new Promise(()=>{});}},10);
  const first=s.nav.open(s.record,'request1');assert.equal(s.nav.open(s.record,'request1'),first);await assert.rejects(first,/NAVIGATION_TIMEOUT/);
  assert.equal(s.nav.open(s.record,'request1'),first);assert.equal(calls,1);assert.equal(s.store.snapshot().count,1);s.nav.dispose();
});
