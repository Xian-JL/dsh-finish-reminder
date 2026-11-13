import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateFact, unreadCount, keyOf, safeInt, fail, boundedString } from '../shared/contracts.mjs';

export class FileStorage {
  constructor(file) {this.file=file;}
  async read() {
    try {if((await stat(this.file)).size>16*1024*1024) fail('STATE_UNAVAILABLE');return await readFile(this.file,'utf8');}
    catch(e) {if(e.code==='ENOENT') return null; throw e;}
  }
  async write(text) {
    await mkdir(dirname(this.file),{recursive:true});
    const temp=this.file+'.'+randomUUID()+'.tmp';
    let handle;
    try {
      handle=await open(temp,'wx',0o600);await handle.writeFile(text,'utf8');await handle.sync();await handle.close();handle=null;
      await rename(temp,this.file);
    } finally {await handle?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT') throw e;});}
  }
}
export class MemoryStorage {
  constructor() {this.text=null;this.failWrites=false;}
  async read() {return this.text;}
  async write(text) {if(this.failWrites) fail('STATE_WRITE_FAILED');this.text=text;}
}
const checksum=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const blank=()=>({schemaVersion:1,sourceId:randomUUID(),revision:0,records:[],seen:[],boundaries:[]});
export class CompletionStore {
  constructor(storage,{limit=10000}={}) {this.storage=storage;this.limit=limit;this.data=blank();this.chain=Promise.resolve();this.error=null;this.ready=false;this.dirty=false;}
  async load() {
    try {
      const text=await this.storage.read();
      if(text!==null) {
        const parsed=JSON.parse(text),d=parsed.data;
        if(!d || parsed.checksum!==checksum(d) || d.schemaVersion!==1 || !boundedString(d.sourceId) || !safeInt(d.revision) ||
          !Array.isArray(d.records) || !Array.isArray(d.seen) || !Array.isArray(d.boundaries)) fail('STATE_UNAVAILABLE');
        const ids=new Set();
        for(const r of d.records) {
          if(validateFact(r).id!==r.id || !['unread','acknowledged','retired'].includes(r.readState) || ids.has(r.id)) fail('STATE_UNAVAILABLE');
          ids.add(r.id);
        }
        for(const s of d.seen) if(!Array.isArray(s)||s.length!==3||typeof s[0]!=='string'||!safeInt(s[1])||!safeInt(s[2])||s[2]<s[1]) fail('STATE_UNAVAILABLE');
        for(const b of d.boundaries) if(!b||typeof b.key!=='string'||!boundedString(b.streamEpoch)||!safeInt(b.throughSeq)) fail('STATE_UNAVAILABLE');
        this.data=d;
      } else {await this.persist();}
      this.ready=true;return this.snapshot();
    } catch {this.error='STATE_UNAVAILABLE';fail('STATE_UNAVAILABLE');}
  }
  snapshot() {return {revision:this.data.revision,count:unreadCount(this.data.records),records:structuredClone(this.data.records),sourceId:this.data.sourceId,error:this.error,durable:!this.dirty};}
  transaction(fn) {
    const task=this.chain.catch(()=>{}).then(async()=>{if(!this.ready) fail('STATE_UNAVAILABLE'); const value=fn();
      if(value?.changed) {this.data.revision++;this.dirty=true;}
      if(this.dirty) await this.persist();
      return value;
    }); this.chain=task;return task;
  }
  async persist() {
    const data=structuredClone(this.data);
    const text=JSON.stringify({data,checksum:checksum(data)});
    if(Buffer.byteLength(text)>16*1024*1024) {this.error='QUEUE_CAPACITY_ERROR';fail(this.error);}
    try {await this.storage.write(text);this.dirty=false;this.error=null;}
    catch {this.dirty=true;this.error='STATE_WRITE_FAILED';fail('STATE_WRITE_FAILED');}
  }
  streamKey(r) {return JSON.stringify([keyOf(r.conversation),r.streamEpoch]);}
  hasSeen(key,seq) {return this.data.seen.some(([k,a,b])=>k===key&&a<=seq&&seq<=b);}
  addSeen(key,seq) {
    const rest=this.data.seen.filter(([k])=>k!==key),ranges=this.data.seen.filter(([k])=>k===key).map(([,a,b])=>[a,b]);
    ranges.push([seq,seq]);ranges.sort((a,b)=>a[0]-b[0]);const merged=[];
    for(const r of ranges) {const p=merged.at(-1);if(p&&r[0]<=p[1]+1)p[1]=Math.max(p[1],r[1]);else merged.push([...r]);}
    this.data.seen=[...rest,...merged.map(([a,b])=>[key,a,b])];
  }
  submit(fact) {
    const record=validateFact(fact);
    return this.transaction(()=>{
      const existing=this.data.records.find(r=>r.id===record.id),stream=this.streamKey(record);
      if(existing || this.hasSeen(stream,record.terminalEventSeq)) return {changed:false,inserted:false,record:existing?structuredClone(existing):null};
      if(this.data.records.filter(r=>r.readState==='unread').length>=this.limit) {this.error='QUEUE_CAPACITY_ERROR';fail(this.error);}
      const boundary=this.data.boundaries.find(b=>b.key===keyOf(record.conversation)&&b.streamEpoch===record.streamEpoch);
      record.readState=boundary&&record.terminalEventSeq<=boundary.throughSeq?'acknowledged':'unread';
      this.data.records.push(record);this.addSeen(stream,record.terminalEventSeq);
      return {changed:true,inserted:true,record:structuredClone(record)};
    });
  }
  acknowledge(conversation,streamEpoch,throughSeq) {
    const key=keyOf(conversation);if(!safeInt(throughSeq)||!boundedString(streamEpoch)) fail('INVALID_IDENTITY');
    return this.transaction(()=>{
      let changed=false;
      for(const r of this.data.records) if(keyOf(r.conversation)===key&&r.streamEpoch===streamEpoch&&r.terminalEventSeq<=throughSeq&&r.readState==='unread') {r.readState='acknowledged';changed=true;}
      const b=this.data.boundaries.find(x=>x.key===key&&x.streamEpoch===streamEpoch);
      if(!b) {this.data.boundaries.push({key,streamEpoch,throughSeq});changed=true;}
      else if(b.throughSeq<throughSeq) {b.throughSeq=throughSeq;changed=true;}
      return {changed};
    });
  }
  retire(conversation) {
    const key=keyOf(conversation);
    return this.transaction(()=>{let changed=false;for(const r of this.data.records) if(keyOf(r.conversation)===key&&r.readState!=='retired'){r.readState='retired';changed=true;}return {changed};});
  }
  compact() {return this.transaction(()=>{const before=this.data.records.length;this.data.records=this.data.records.filter(r=>r.readState==='unread');return {changed:before!==this.data.records.length};});}
  markSilenced(id){return this.transaction(()=>{const r=this.data.records.find(r=>r.id===id);if(!r||r.silenced===true)return {changed:false};r.silenced=true;return {changed:true};});}
  pruneHistory(protectedIds=new Set(),limit=500){return this.transaction(()=>{
    const history=this.data.records.filter(r=>r.readState!=='unread'&&!protectedIds.has(r.id)).sort((a,b)=>b.endedAt-a.endedAt||b.id.localeCompare(a.id));
    const remove=new Set(history.slice(limit).map(r=>r.id));if(!remove.size)return {changed:false};
    this.data.records=this.data.records.filter(r=>!remove.has(r.id));return {changed:true,removed:remove.size};
  });}
  flush() {return this.transaction(()=>({changed:false}));}
}
