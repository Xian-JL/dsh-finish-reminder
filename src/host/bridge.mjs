import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { PROTOCOL, envelope, fail, ReminderError, isObject } from '../shared/contracts.mjs';

export class NativeBridge {
  constructor({factory,onEvent=()=>{},onError=()=>{}}={}) {
    const helper=new URL(typeof __REMINDER_PACKAGED__!=='undefined'&&__REMINDER_PACKAGED__?'../native/Reminder.exe':'../../native/Reminder.exe',import.meta.url);
    this.factory=factory??(()=>spawn(fileURLToPath(helper),
      [String(process.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false}));
    this.onEvent=onEvent;this.onError=onError;this.child=null;this.pending=new Map();
    this.identity={nonce:randomUUID(),ownerInstance:randomUUID(),generation:1};
    this.revision=0;this.bytes=0;this.line='';this.decoder=new StringDecoder('utf8');this.closed=false;
  }
  start() {
    if(this.closed)fail('HELPER_EXITED');if(this.child)return;
    try {this.child=this.factory();}catch{this.broken('HELPER_EXITED');fail('HELPER_EXITED');}
    this.child.stdout.on('data',c=>this.data(c));
    this.child.stderr.on('data',()=>{});
    this.child.on('error',()=>this.broken('HELPER_EXITED'));this.child.on('exit',()=>this.broken('HELPER_EXITED'));
    this.child.stdin.on('error',()=>this.broken('PROTOCOL_ERROR'));
  }
  data(chunk) {
    if(this.closed)return;
    try {
      for(let offset=0;offset<chunk.length;) {
        const lf=chunk.indexOf(10,offset),end=lf<0?chunk.length:lf,piece=chunk.subarray(offset,end);
        this.bytes+=piece.length;if(this.bytes>32768)fail('PROTOCOL_ERROR');
        this.line+=this.decoder.write(piece);
        if(lf<0)break;
        const raw=JSON.parse(this.line);this.line='';this.bytes=0;
        this.message(envelope(raw,this.identity,32768));offset=lf+1;
      }
    } catch {this.broken('PROTOCOL_ERROR');}
  }
  message(m) {
    if(m.type==='event') {
      if(!['painted','click','dismiss','availability','hover'].includes(m.payload.kind))fail('PROTOCOL_ERROR');
      if(m.payload.kind==='availability') {if(typeof m.payload.available!=='boolean')fail('PROTOCOL_ERROR');}
      else {
        if(typeof m.payload.cardId!=='string'||!Number.isSafeInteger(m.payload.displayGeneration))fail('PROTOCOL_ERROR');
        if(m.payload.kind==='hover'&&typeof m.payload.paused!=='boolean')fail('PROTOCOL_ERROR');
      }
      try{this.onEvent(m.payload);}catch{}return;
    }
    const p=this.pending.get(m.requestId);if(!p)return;
    if(m.type!=='response'||typeof m.payload.ok!=='boolean')fail('PROTOCOL_ERROR');
    if(m.payload.ok===false && (typeof m.payload.code!=='string'||!/^[A-Z_]{1,64}$/.test(m.payload.code)))fail('PROTOCOL_ERROR');
    if(m.payload.ok===true && !isObject(m.payload.value))fail('PROTOCOL_ERROR');
    this.pending.delete(m.requestId);clearTimeout(p.timer);
    if(m.payload.ok)p.resolve(m.payload.value);else p.reject(new ReminderError(m.payload.code));
  }
  request(type,payload={},timeoutMs=2000) {
    // Never throw synchronously: callers use `void request(...).catch(...)` for best-effort
    // teardown, and a synchronous throw there escapes the promise chain and can abort the
    // whole host when the helper has already exited.
    if(this.closed)return Promise.reject(new ReminderError('HELPER_EXITED'));
    try{this.start();}catch(e){return Promise.reject(e instanceof ReminderError?e:new ReminderError('HELPER_EXITED'));}
    const requestId=randomUUID();
    const m={protocolVersion:PROTOCOL,...this.identity,requestId,revision:++this.revision,type,payload};
    const frame=JSON.stringify(m)+'\n';
    if(Buffer.byteLength(frame)>131072){this.broken('PROTOCOL_ERROR');return Promise.reject(new ReminderError('PROTOCOL_ERROR'));}
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new ReminderError('HELPER_TIMEOUT'));this.broken('HELPER_TIMEOUT');},timeoutMs);
      this.pending.set(requestId,{resolve,reject,timer});
      try{this.child.stdin.write(frame);}catch{this.broken('PROTOCOL_ERROR');}
    });
  }
  broken(code) {
    if(this.closed)return;this.closed=true;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new ReminderError(code));}
    this.pending.clear();
    try{this.child?.kill();}catch{}
    try{this.onError(code);}catch{}
  }
  async dispose() {
    try {
      if(!this.closed&&this.child) {try{await this.request('shutdown',{},1000);}catch{}}
    } finally {
      try{this.broken('HELPER_EXITED');}catch{}
    }
  }
}
