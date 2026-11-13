import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {centerPage} from '../src/core/center.mjs';import {CompletionStore,MemoryStorage} from '../src/core/store.mjs';import {fact,key} from './fixtures.mjs';
test('legacy schema retains source identity, unread count and unknown context without rewriting on read',async()=>{
  const storage=new MemoryStorage(),original=new CompletionStore(storage);await original.load();await original.submit(fact());
  const raw=JSON.parse(storage.text);for(const r of raw.data.records)for(const field of ['workspaceId','workspaceTitle','durationMs','startedAt','silenced'])delete r[field];
  raw.checksum=createHash('sha256').update(JSON.stringify(raw.data)).digest('hex');storage.text=JSON.stringify(raw);const before=storage.text;
  const next=new CompletionStore(storage);await next.load();const page=centerPage(next.snapshot().records);
  assert.equal(next.data.sourceId,original.data.sourceId);assert.equal(next.snapshot().count,1);assert.equal(storage.text,before);
  assert.equal(page.items[0].durationMs,null);assert.equal(page.items[0].workspaceTitle,'');assert.equal(page.items[0].silenced,false);
});
test('filters, stable pagination and body-free projection never acknowledge records',async()=>{
  const store=new CompletionStore(new MemoryStorage());await store.load();const now=Date.now();
  for(let i=0;i<31;i++)await store.submit(fact('A',i,{endedAt:now-i*1000,workspaceId:i%2?'workB':'workA',workspaceTitle:i%2?'B':'A',outcome:i%2?'error':'ended',displayTitle:'任务'+i}));
  const revision=store.data.revision,first=centerPage(store.data.records,{limit:'25'},revision,{now});assert.equal(first.items.length,25);assert.equal(first.total,31);assert.equal(first.hasMore,true);
  const next=centerPage(store.data.records,{offset:25,revision},revision,{now});assert.equal(next.items.length,6);assert.equal(new Set([...first.items,...next.items].map(r=>r.id)).size,31);
  const filter=centerPage(store.data.records,{workspace:'workB',outcome:'error',period:'7d'},revision,{now});assert.equal(filter.total,15);
  assert.equal(store.snapshot().count,1);assert.equal(store.data.revision,revision);assert.equal('conversation' in first.items[0],false);
  assert.throws(()=>centerPage(store.data.records,{revision:revision-1},revision),/CENTER_SNAPSHOT_CHANGED/);
  assert.throws(()=>centerPage(store.data.records,{limit:51},revision),/INVALID_REQUEST/);
});
test('center marks running context dynamically without rewriting the ended fact',async()=>{
  const s=new CompletionStore(new MemoryStorage());await s.load();await s.submit(fact('A',1,{durationMs:1200,workspaceId:'w',workspaceTitle:'工作区',silenced:true}));
  const before=JSON.stringify(s.data.records),page=centerPage(s.data.records,{},s.data.revision,{running:()=>true});assert.equal(page.items[0].currentlyRunning,true);assert.equal(page.items[0].silenced,true);assert.equal(page.items[0].durationMs,1200);assert.equal(JSON.stringify(s.data.records),before);
});
test('history cap preserves unread and active cards plus dedupe after pruning',async()=>{
  const s=new CompletionStore(new MemoryStorage());await s.load();for(let i=0;i<8;i++)await s.submit(fact('A',i,{endedAt:1000+i}));
  await s.acknowledge(key(),'1234',6);const protectedId=s.data.records[0].id;
  await s.pruneHistory(new Set([protectedId]),3);
  assert.equal(s.data.records.length,5);assert.ok(s.data.records.some(r=>r.id===protectedId));assert.ok(s.data.records.some(r=>r.terminalEventSeq===7&&r.readState==='unread'));
  assert.equal((await s.submit(fact('A',1,{endedAt:1001}))).inserted,false);
  await s.pruneHistory(new Set(),3);assert.equal(s.data.records.length,4);assert.equal(s.snapshot().count,1);
});
