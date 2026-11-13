import {test} from 'node:test';import assert from 'node:assert/strict';
import {CompletionStore,MemoryStorage,FileStorage} from '../src/core/store.mjs';import {fact,key} from './fixtures.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
async function setup(){const storage=new MemoryStorage(),s=new CompletionStore(storage);await s.load();return {s,storage};}
test('count is conversations, not completions or popup lifetime; profile isolation',async()=>{
  const {s}=await setup();await s.submit(fact('A',10));await s.submit(fact('B',20));await s.submit(fact('A',30));assert.equal(s.snapshot().count,2);
  await s.submit(fact('A',40,{conversation:key('A','other-profile')}));assert.equal(s.snapshot().count,3);
  await s.acknowledge(key('A'),'1234',10);assert.equal(s.snapshot().count,3);await s.acknowledge(key('A'),'1234',30);assert.equal(s.snapshot().count,2);
});
test('stale ack cannot consume newer completion or another epoch',async()=>{
  const {s}=await setup();await s.submit(fact('A',10));await s.submit(fact('A',20));await s.acknowledge(key(),'1234',10);
  assert.deepEqual(s.snapshot().records.map(r=>r.readState),['acknowledged','unread']);await s.acknowledge(key(),'different-epoch',100);assert.equal(s.snapshot().count,1);
});
test('out-of-order facts, retransmission and restart are idempotent',async()=>{
  const {s,storage}=await setup();await s.submit(fact('A',100));await s.submit(fact('A',10));assert.equal((await s.submit(fact('A',10))).inserted,false);
  const next=new CompletionStore(storage);await next.load();assert.equal((await next.submit(fact('A',100))).inserted,false);assert.equal(next.snapshot().count,1);
});
test('write failure retains memory and dedupe identity; retry flush is explicit',async()=>{
  const {s,storage}=await setup();storage.failWrites=true;await assert.rejects(s.submit(fact()),/STATE_WRITE_FAILED/);assert.equal(s.snapshot().count,1);assert.equal(s.snapshot().durable,false);
  storage.failWrites=false;await s.flush();assert.equal((await s.submit(fact())).inserted,false);assert.equal(s.snapshot().durable,true);
  const next=new CompletionStore(storage);await next.load();assert.equal(next.snapshot().count,1);
});
test('compacted acknowledged record cannot return as unread on replay',async()=>{
  const {s}=await setup();await s.submit(fact());await s.acknowledge(key(),'1234',10);await s.compact();assert.equal(s.snapshot().records.length,0);
  assert.equal((await s.submit(fact())).inserted,false);assert.equal(s.snapshot().count,0);
});
test('retire removes conversation from count; capacity never deletes existing unread',async()=>{
  const storage=new MemoryStorage(),s=new CompletionStore(storage,{limit:1});await s.load();await s.submit(fact());
  await assert.rejects(s.submit(fact('B')),/QUEUE_CAPACITY_ERROR/);assert.equal(s.snapshot().count,1);
  await s.retire(key());assert.equal(s.snapshot().count,0);await s.submit(fact('B'));assert.equal(s.snapshot().count,1);
});
test('file roundtrip and corruption do not silently reconstruct zero or overwrite evidence',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dsh-reminder-test-'));const path=join(dir,'state.json');
  try {
    const s=new CompletionStore(new FileStorage(path));await s.load();await s.submit(fact());
    const next=new CompletionStore(new FileStorage(path));await next.load();assert.equal(next.snapshot().count,1);
    const corrupt='{"data":"broken"}';await writeFile(path,corrupt);
    await assert.rejects(new CompletionStore(new FileStorage(path)).load(),/STATE_UNAVAILABLE/);assert.equal(await readFile(path,'utf8'),corrupt);
  } finally {await rm(dir,{recursive:true,force:true});}
});
