import net from 'node:net';import os from 'node:os';import {createHash,randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {NativeBridge} from './bridge.mjs';import {ReminderQueue} from '../core/queue.mjs';
import {validateFact,safeInt,fail,ReminderError,VERSION,keyOf} from '../shared/contracts.mjs';
const servers=new Map();
const hash=x=>createHash('sha256').update(x).digest('hex').slice(0,32);
export function groupPipe(){return '\\\\.\\pipe\\dsh-finish-reminder-v3-'+hash(os.homedir().toLowerCase()+'\0'+(process.env.SESSIONNAME??'Console')+'\0'+process.execPath.toLowerCase());}
function wire(socket,onMessage,onClose,max=131072){
  let text='',bytes=0;const decoder=new StringDecoder('utf8');let closed=false;
  const close=()=>{if(closed)return;closed=true;try{socket.destroy();}catch{}try{onClose();}catch{}};
  socket.on('data',chunk=>{try{for(let at=0;at<chunk.length;){const next=chunk.indexOf(10,at),end=next<0?chunk.length:next,part=chunk.subarray(at,end);bytes+=part.length;if(bytes>max)throw 0;text+=decoder.write(part);if(next<0)break;const m=JSON.parse(text);text='';bytes=0;onMessage(m);at=next+1;}}catch{close();}});
  socket.on('error',close);socket.on('close',close);
  return {send:m=>{if(closed)fail('PROTOCOL_ERROR');const line=JSON.stringify(m)+'\n';if(Buffer.byteLength(line)>max)fail('PROTOCOL_ERROR');socket.write(line);},close};
}
export class GroupServer {
  constructor(path,{nativeFactory}={}){
    this.path=path;this.peers=new Set();this.sources=new Map();this.queue=new ReminderQueue();this.timer=null;this.chain=Promise.resolve();this.generation=randomUUID();this.closing=false;this.lastBadgeCount=null;this.clickTimers=new Map();this.trackedCards=new Map();this.silencedIds=new Set();
    this.native=new NativeBridge({factory:nativeFactory,onEvent:e=>this.event(e),onError:code=>{
      try{if(!this.closing){for(const p of this.peers)this.push(p,{kind:'fault',code});void this.close().catch(()=>{});}}catch{}
    }});
    this.server=net.createServer(socket=>this.connect(socket));this.server.on('error',()=>{});
  }
  listen(){return new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen({path:this.path,exclusive:true,readableAll:false,writableAll:false},()=>{this.server.off('error',reject);servers.set(this.path,this);resolve(this);});});}
  connect(socket){
    const p={source:null,nonce:null,wire:null,closed:false};this.peers.add(p);
    const timer=setTimeout(()=>{if(!p.source)p.wire.close();},3000);timer.unref?.();
    p.wire=wire(socket,m=>{
      void Promise.resolve().then(async()=>{
        if(!m||typeof m.id!=='string'||m.id.length>80||typeof m.method!=='string'||!m.payload||typeof m.payload!=='object')fail('PROTOCOL_ERROR');
        if(p.nonce!==null&&m.nonce!==p.nonce)fail('PROTOCOL_ERROR');
        if(p.nonce===null){if(m.method!=='register'||typeof m.nonce!=='string'||m.nonce.length<32)fail('PROTOCOL_ERROR');p.nonce=m.nonce;}
        const value=await this.handle(p,m.method,m.payload);if(!p.closed)p.wire.send({id:m.id,nonce:p.nonce,generation:this.generation,ok:true,value});
      }).catch(e=>{if(!p.closed)try{p.wire.send({id:m?.id,nonce:p.nonce,generation:this.generation,ok:false,code:/^[A-Z_]+$/.test(e.code??'')?e.code:'PROTOCOL_ERROR'});}catch{p.wire.close();}});
    },()=>{
      try {
        p.closed=true;clearTimeout(timer);this.peers.delete(p);if(p.source&&this.sources.get(p.source.id)===p)this.sources.delete(p.source.id);
        if(p.source) {
          this.clearSourceCards(p);
          for(const token of p.source.tokens)void this.native.request('unbindWindow',{windowToken:token}).catch(()=>{});
          const ids=[...p.source.knownIds];for(let i=0;i<ids.length;i+=16)void this.native.request('forgetCompletion',{completionIds:ids.slice(i,i+16)}).catch(()=>{});
        }
        if(!this.closing){if(this.peers.size===0)void this.close().catch(()=>{});else void this.render();}
      } catch {}
    });
  }
  async handle(p,method,data){
    if(method==='register'){
      if(p.source||typeof data.sourceId!=='string'||data.sourceId.length>80||!safeInt(data.count)||!safeInt(data.revision)||!safeInt(data.hostPid))fail('PROTOCOL_ERROR');
      if(this.sources.has(data.sourceId))fail('SOURCE_OWNER_CONFLICT');
      p.source={id:data.sourceId,count:data.count,revision:data.revision,hostPid:data.hostPid,dark:data.dark===true,quiet:data.quiet===true,running:new Map(),tokens:new Set(),knownIds:new Set()};this.sources.set(data.sourceId,p);
      const caps=await this.native.request('hello');let desktop=null;
      try{desktop=await this.native.request('registerDesktop',{hostPid:data.hostPid});}catch{}
      p.source.desktop=!!desktop;
      this.lastBadgeCount=null;
      await this.render();return {...caps,desktop:!!desktop,groupGeneration:this.generation,acceptance:'UNVERIFIED'};
    }
    if(!p.source)fail('PROTOCOL_ERROR');
    if(method==='snapshot'){
      if(!safeInt(data.count)||!safeInt(data.revision))fail('PROTOCOL_ERROR');
      if(data.revision>=p.source.revision){p.source.count=data.count;p.source.revision=data.revision;if(typeof data.dark==='boolean')p.source.dark=data.dark;}
      if(typeof data.quiet==='boolean'&&data.quiet!==p.source.quiet){p.source.quiet=data.quiet;if(data.quiet)this.clearSourceCards(p);}
      await this.render();return {applied:true,count:this.count(),queued:this.queue.entries.filter(e=>e.sourceId===p.source.id).length};
    }
    if(method==='submit'){
      if(!p.source.desktop)fail('DESKTOP_BRIDGE_UNAVAILABLE');
      const r=validateFact(data.record);r.id=data.record.id;if(r.id!==validateFact(data.record).id||r.conversation.hostInstanceId!==p.source.id)fail('INVALID_COMPLETION');
      await this.native.request('observeCompletion',{completionId:r.id});
      p.source.knownIds.add(r.id);
      if(p.source.quiet||r.silenced||this.silencedIds.has(r.id)){this.queue.ids.add(r.id);this.silencedIds.add(r.id);await this.render();return {accepted:true,inserted:false,queued:false,silenced:true};}
      const running=p.source.running.get(keyOf(r.conversation));
      r.currentlyRunning=running&&running.revision>=(data.runningRevision??0)?running.value:data.running===true;
      const inserted=this.queue.enqueue(r);const e=this.queue.entries.find(e=>e.record.id===r.id);if(e){e.sourceId=p.source.id;this.trackedCards.set(r.id,p.source.id);}
      await this.render();return {accepted:true,inserted,queued:this.queue.entries.some(e=>e.record.id===r.id),silenced:false};
    }
    if(method==='running'){
      if(data.conversation?.hostInstanceId!==p.source.id||typeof data.running!=='boolean'||!safeInt(data.revision))fail('PROTOCOL_ERROR');
      const key=keyOf(data.conversation),prior=p.source.running.get(key);
      if(!prior||data.revision>=prior.revision){p.source.running.set(key,{revision:data.revision,value:data.running});for(const e of this.queue.entries)if(keyOf(e.record.conversation)===key)e.record.currentlyRunning=data.running;}
      await this.render();return {applied:true};
    }
    if(method==='retire'){
      const r=data.conversation;if(r?.hostInstanceId!==p.source.id)fail('INVALID_IDENTITY');this.queue.retire(keyOf(r),keyOf);await this.render();return {applied:true};
    }
    if(method==='bindWindow'){const result=await this.native.request(method,{...data,hostPid:p.source.hostPid});if(!p.source.desktop){this.lastBadgeCount=null;p.source.desktop=result.bound===true;void this.render();}if(result.windowToken)p.source.tokens.add(result.windowToken);return result;}
    if(['forgetCompletion','observeCompletion'].includes(method)){const result=await this.native.request(method,data);for(const id of data.completionIds??[data.completionId]){if(method==='observeCompletion')p.source.knownIds.add(id);else p.source.knownIds.delete(id);}return result;}
    if(['foreground','verifyForeground','unbindWindow'].includes(method))return await this.native.request(method,data);
    if(method==='clickDone'){
      if(typeof data.completionId!=='string'||typeof data.ok!=='boolean')fail('PROTOCOL_ERROR');
      const front=this.queue.front;
      if(front&&front.record.id===data.completionId&&front.state==='opening'){
        this.clearClick(data.completionId);
        const token=this.queue.token();
        if(data.ok)this.queue.completeOpen(token);
        else {
          const code=typeof data.code==='string'&&/^[A-Z_]{1,64}$/.test(data.code)?data.code:'NAVIGATION_UNCONFIRMED';
          this.queue.failOpen(token,code);
          const timer=setTimeout(()=>{if(this.queue.clearError(token))void this.render();},2000);
          timer.unref?.();
        }
        await this.render();
      }
      return {applied:true};
    }
    if(method==='unregister'){p.wire.close();return {};}
    fail('PROTOCOL_ERROR');
  }
  count(){let count=0;for(const p of this.sources.values())count+=p.source.count;if(!Number.isSafeInteger(count))fail('QUEUE_CAPACITY_ERROR');return count;}
  clearSourceCards(p){this.queue.removeWhere(e=>e.sourceId===p.source.id);}
  push(p,event){try{p.wire.send({event,nonce:p.nonce,generation:this.generation});}catch{p.wire.close();}}
  event(e){
    const token={cardId:e.cardId,displayGeneration:e.displayGeneration};
    if(e.kind==='painted')this.queue.painted(token);
    else if(e.kind==='availability')this.queue.setAvailable(e.available);
    else if(e.kind==='hover'){
      if(typeof e.paused==='boolean'){this.queue.hover(token,e.paused);void this.render();}
    }
    else if(e.kind==='dismiss'){
      const removed=this.queue.dismiss(token);
      const peer=removed&&this.sources.get(removed.sourceId);
      if(peer)this.push(peer,{kind:'dismiss',cardId:removed.record.id,displayGeneration:e.displayGeneration,completionId:removed.record.id});
      void this.render();
    }
    else if(e.kind==='click'){
      // Keep the card on screen while the owning source navigates, so a failure can be shown in place.
      const opening=this.queue.beginOpen(token);
      if(opening){
        const peer=this.sources.get(opening.sourceId);
        if(peer)this.push(peer,{kind:'click',cardId:opening.record.id,displayGeneration:e.displayGeneration,completionId:opening.record.id});
        this.armClick(opening.record.id);
        void this.render();
      } else void this.render();
    }
  }
  armClick(id){
    this.clearClick(id);
    const timer=setTimeout(()=>{
      this.clickTimers.delete(id);
      const front=this.queue.front;
      if(front&&front.record.id===id&&front.state==='opening'&&this.queue.completeOpen(this.queue.token()))void this.render();
    },4000);
    timer.unref?.();this.clickTimers.set(id,timer);
  }
  clearClick(id){const timer=this.clickTimers.get(id);if(timer){clearTimeout(timer);this.clickTimers.delete(id);}}
  render(){
    const work=this.chain.catch(()=>{}).then(async()=>{
      if(this.closing)return;clearTimeout(this.timer);this.timer=null;
      const active=new Set(this.queue.entries.map(e=>e.record.id));
      for(const [id,sourceId]of this.trackedCards)if(!active.has(id)){const owner=this.sources.get(sourceId);if(owner)this.push(owner,{kind:'cardRemoved',completionId:id});this.trackedCards.delete(id);this.clearClick(id);}
      const view=this.queue.view(),peer=this.queue.front&&this.sources.get(this.queue.front.sourceId);
      try{await this.native.request('syncView',{front:view.front,previews:view.previews,queued:view.queued,available:view.available,dark:peer?.source.dark??false});}
      catch(e){if(e.code==='DISPLAY_UNAVAILABLE')this.queue.setAvailable(false);for(const p of this.peers)this.push(p,{kind:'fault',code:e.code??'HELPER_EXITED'});}
      try{if(this.sources.size&&this.lastBadgeCount!==this.count()){const count=this.count();await this.native.request('badge',{count});this.lastBadgeCount=count;for(const p of this.peers)if(p.source?.desktop)this.push(p,{kind:'badgeStatus',supported:true,code:null});}}
      catch(e){for(const p of this.peers)this.push(p,{kind:'badgeStatus',code:e.code??'BADGE_PLACEMENT_UNSUPPORTED'});}
      for(const p of this.peers)if(p.source)this.push(p,{kind:'queueStatus',queued:this.queue.entries.filter(e=>e.sourceId===p.source.id).length,aggregateCount:this.count()});
      if(this.queue.front?.state==='front'){
        const token=this.queue.token();this.timer=setTimeout(()=>{this.queue.due(token);void this.render();},Math.ceil(this.queue.remaining()));
      }
    });this.chain=work;return work;
  }
  async close(){
    if(this.closing)return;this.closing=true;
    try{
      clearTimeout(this.timer);
      for(const t of this.clickTimers.values())clearTimeout(t);
      this.clickTimers.clear();
      for(const p of this.peers)p.wire.close();
      this.peers.clear();this.sources.clear();
    }catch{}
    await this.chain.catch(()=>{});
    try{await this.native.dispose();}catch{}
    try{this.server.close();}catch{}
    if(servers.get(this.path)===this)servers.delete(this.path);
  }
}
/** A client can take ownership after an owner exits; snapshots restore counts, never old cards. */
export class GroupBridge {
  constructor({onEvent=()=>{},onError=()=>{},path=groupPipe(),nativeFactory}={}){
    Object.assign(this,{onEvent,onError,path,nativeFactory});this.pending=new Map();this.nonce=randomUUID();this.wire=null;this.closed=false;this.ready=null;this.generation=null;this.group=true;
  }
  connect(){
    if(this.ready)return this.ready;
    this.ready=(async()=>{
      const server=new GroupServer(this.path,{nativeFactory:this.nativeFactory});
      try{await server.listen();}catch(e){await server.native.dispose();if(e.code!=='EADDRINUSE'&&e.code!=='EACCES')throw e;}
      await new Promise((resolve,reject)=>{
        const socket=net.createConnection(this.path);const deadline=setTimeout(()=>{socket.destroy();reject(new ReminderError('PROTOCOL_ERROR'));},2000);
        socket.once('error',e=>{clearTimeout(deadline);reject(e);});
        socket.once('connect',()=>{clearTimeout(deadline);this.wire=wire(socket,m=>this.message(m),()=>this.broken());resolve();});
      });
    })();return this.ready;
  }
  message(m){
    if(m.event){if(m.nonce!==this.nonce||typeof m.generation!=='string'||(this.generation&&m.generation!==this.generation)||!['click','dismiss','fault','badgeStatus','queueStatus','cardRemoved'].includes(m.event.kind))return this.broken();try{this.onEvent(m.event);}catch{}return;}
    const p=this.pending.get(m.id);if(!p)return;
    if(m.nonce!==this.nonce||typeof m.ok!=='boolean'||typeof m.generation!=='string')return this.broken();
    if(this.generation&&this.generation!==m.generation)return this.broken();this.generation=m.generation;
    this.pending.delete(m.id);clearTimeout(p.timer);if(m.ok)p.resolve(m.value);else p.reject(new ReminderError(m.code??'PROTOCOL_ERROR'));
  }
  async request(method,payload={},timeoutMs=3000){
    if(this.closed)fail('HELPER_EXITED');await this.connect();const id=randomUUID();
    return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new ReminderError('HELPER_TIMEOUT'));},timeoutMs);
      this.pending.set(id,{resolve,reject,timer});try{this.wire.send({id,nonce:this.nonce,method,payload});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  broken(){if(this.closed)return;this.closed=true;this.wire?.close();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new ReminderError('HELPER_EXITED'));}this.pending.clear();try{this.onError('HELPER_EXITED');}catch{}}
  async dispose(){if(this.closed)return;this.closed=true;this.wire?.close();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new ReminderError('HELPER_EXITED'));}this.pending.clear();}
}
