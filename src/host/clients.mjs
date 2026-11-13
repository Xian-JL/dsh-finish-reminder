import {randomUUID} from 'node:crypto';
import {boundedString,safeInt,fail,keyOf} from '../shared/contracts.mjs';
/** Profile-scoped authenticated Client channel. Navigation carries identities and finite boundaries only. */
export class ClientHub {
  constructor(runtime){this.runtime=runtime;this.clients=new Map();this.pending=new Map();this.closed=false;this.snapshotGeneration=0;}
  async update(data){
    if(!boundedString(data.clientId,80)||data.desktop!==true)fail('ACCESS_DENIED');
    let c=this.clients.get(data.clientId);
    if(!c){if(this.clients.size>=32)fail('QUEUE_CAPACITY_ERROR');c={id:data.clientId,send:null,windowToken:null,sessionId:null,userIntent:0,updatedAt:0};this.clients.set(c.id,c);}
    c.metadata=data;c.sessionId=typeof data.sessionId==='string'?data.sessionId:null;c.focused=data.focused===true;c.updatedAt=performance.now();
    if(safeInt(data.userIntent))c.userIntent=data.userIntent;
    for(const [id,p]of this.pending)if(p.client===c&&p.expectedIntent!==c.userIntent){this.pending.delete(id);p.detach();p.reject(Object.assign(new Error('NAVIGATION_CANCELLED'),{code:'NAVIGATION_CANCELLED'}));c.send?.('cancelNavigation',{requestId:id});}
    if(c.focused)c.lastFocusedAt=c.updatedAt;
    const geometry=JSON.stringify([data.x,data.y,data.width,data.height]);
    if(this.runtime.enabled&&this.runtime.bridge?.group&&(!c.windowToken||c.geometry!==geometry)){
      try{const result=await this.runtime.bridge.request('bindWindow',{clientId:c.id,x:data.x,y:data.y,width:data.width,height:data.height});c.windowToken=result.windowToken;c.geometry=geometry;this.runtime.capabilities.navigation=true;}
      catch(e){if(!c.windowToken)this.runtime.navigationError=e.code??'WINDOW_BINDING_AMBIGUOUS';}
    }
    this.runtime.publish();return {registered:true,bound:!!c.windowToken};
  }
  stream(clientId,signal){
    if(!boundedString(clientId,80))fail('ACCESS_DENIED');const c=this.clients.get(clientId);if(!c)fail('ACCESS_DENIED');
    c.stop?.();const encoder=new TextEncoder();let timer,done=false;
    return new ReadableStream({start:controller=>{
      const stop=()=>{if(done)return;done=true;clearInterval(timer);if(c.send===send)c.send=null;try{controller.close();}catch{};};
      const send=(type,data)=>{if(done)return;try{const frame='event: '+type+'\ndata: '+JSON.stringify(data)+'\n\n';if(encoder.encode(frame).length>32768)fail('PROTOCOL_ERROR');controller.enqueue(encoder.encode(frame));}catch{stop();}};
      c.send=send;this.publishTo(c);send('status',this.runtime.status());
      timer=setInterval(()=>{if(this.closed)stop();else send('heartbeat',{});},15000);timer.unref?.();
      signal?.addEventListener('abort',stop,{once:true});
      c.stop=()=>{signal?.removeEventListener('abort',stop);stop();};
    },cancel:()=>{clearInterval(timer);done=true;c.send=null;}});
  }
  publishTo(c){
    if(!c.send||c.targetsRevision===this.runtime.store?.data.revision)return;c.targetsRevision=this.runtime.store?.data.revision;const targets=new Map();
    for(const r of this.runtime.store?.data.records??[])if(r.readState==='unread'){
      const key=JSON.stringify([r.conversation.sessionId,r.streamEpoch]);const prior=targets.get(key);
      if(!prior||prior.throughSeq<r.terminalEventSeq)targets.set(key,{sessionId:r.conversation.sessionId,streamEpoch:r.streamEpoch,throughSeq:r.terminalEventSeq,completionId:r.id});
    }
    const generation=++this.snapshotGeneration,list=[...targets.values()];c.send('targetsStart',{generation});
    for(let i=0;i<list.length;i+=8)c.send('targetsChunk',{generation,items:list.slice(i,i+8)});
    c.send('targetsEnd',{generation});
  }
  publish(){for(const c of this.clients.values())this.publishTo(c);}
  invalidate(){for(const c of this.clients.values()){c.windowToken=null;c.targetsRevision=undefined;}this.runtime.capabilities.navigation=false;}
  async rebindAll(){for(const c of this.clients.values())if(c.metadata)await this.update(c.metadata);}
  choose(){
    const clients=[...this.clients.values()].filter(c=>c.windowToken&&c.send);
    if(clients.length===1)return clients[0];
    clients.sort((a,b)=>(b.lastFocusedAt??0)-(a.lastFocusedAt??0));
    if(clients.length&&clients[0].lastFocusedAt&&(clients[0].lastFocusedAt!==(clients[1]?.lastFocusedAt??0)))return clients[0];
    fail('WINDOW_BINDING_AMBIGUOUS');
  }
  async openAndObserve({conversation,boundary,requestId,signal,clientId}){
    const r=this.runtime.store.data.records.find(r=>keyOf(r.conversation)===keyOf(conversation)&&r.streamEpoch===boundary.streamEpoch&&r.terminalEventSeq===boundary.throughSeq);
    if(!r||r.readState==='retired')fail('TARGET_GONE');
    if(this.runtime.ctx.get('workspaceRegistry')?.archivedSessionIds?.includes(conversation.sessionId)) {await this.runtime.retire(conversation.sessionId);fail('TARGET_ARCHIVED');}
    const live=this.runtime.ctx.get('sessions')?.get?.(conversation.sessionId),persistence=this.runtime.ctx.get('sessionPersistence');
    let header=live?.header;
    if(!live&&persistence?.stat){
      try{const metadata=await persistence.stat(conversation.sessionId,{signal});if(!metadata){await this.runtime.retire(conversation.sessionId);fail('TARGET_GONE');}header=metadata.header;}
      catch(e){if(e.code==='TARGET_GONE')throw e;if(e.code==='EACCES'||e.code==='EPERM')fail('ACCESS_DENIED');fail('TARGET_STATE_UNCONFIRMED');}
    }
    if(header&&String(header.createdAt)!==boundary.streamEpoch){await this.runtime.retire(conversation.sessionId);fail('TARGET_GONE');}
    const c=clientId?this.clients.get(clientId):this.choose();if(!c?.windowToken||!c.send)fail('CLIENT_UNAVAILABLE');
    const expectedIntent=c.userIntent;signal.throwIfAborted();
    const result=new Promise((resolve,reject)=>{
      const cancel=()=>{this.pending.delete(requestId);c.send?.('cancelNavigation',{requestId});reject(Object.assign(new Error('NAVIGATION_TIMEOUT'),{code:'NAVIGATION_TIMEOUT'}));};
      signal.addEventListener('abort',cancel,{once:true});
      this.pending.set(requestId,{client:c,conversation,boundary,expectedIntent,resolve,reject,detach:()=>signal.removeEventListener('abort',cancel)});
    });result.catch(()=>{});
    try{
      let front=await this.runtime.bridge.request('foreground',{windowToken:c.windowToken});
      for(let i=0;!front.foreground&&i<8;i++){
        signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,25));
        front=await this.runtime.bridge.request('verifyForeground',{windowToken:c.windowToken});
      }
      if(!front.foreground)fail('FOREGROUND_DENIED');
      signal.throwIfAborted();if(c.userIntent!==expectedIntent||!this.pending.has(requestId))fail('NAVIGATION_CANCELLED');
      c.send('navigate',{requestId,sessionId:conversation.sessionId,streamEpoch:boundary.streamEpoch,throughSeq:boundary.throughSeq,userIntent:expectedIntent});
    }catch(e){const pending=this.pending.get(requestId);if(pending){this.pending.delete(requestId);pending.detach();pending.reject(e);}}
    return await result;
  }
  async navigationResult(data){
    const p=this.pending.get(data.requestId);if(!p||p.client.id!==data.clientId)return {ignored:true};
    if(data.ok!==true){this.pending.delete(data.requestId);p.detach();p.reject(Object.assign(new Error('NAVIGATION_UNCONFIRMED'),{code:boundedString(data.code,64)?data.code:'NAVIGATION_UNCONFIRMED'}));return {received:true};}
    if(data.sessionId!==p.conversation.sessionId||data.streamEpoch!==p.boundary.streamEpoch||data.throughSeq!==p.boundary.throughSeq||data.mainView!==true||data.visible!==true||data.focused!==true||data.userIntent!==p.expectedIntent)return {ignored:true};
    const native=await this.runtime.bridge.request('verifyForeground',{windowToken:p.client.windowToken});
    if(this.pending.get(data.requestId)!==p)return {ignored:true};
    this.pending.delete(data.requestId);p.detach();
    p.resolve({conversation:p.conversation,foreground:native.foreground,interactive:native.interactive,mainView:true,userIntentValid:p.client.userIntent===p.expectedIntent,
      streamEpoch:p.boundary.streamEpoch,visibleThroughSeq:p.boundary.throughSeq});return {received:true};
  }
  async manualRead(data){
    const c=this.clients.get(data.clientId);if(!c?.windowToken||c.sessionId!==data.sessionId||data.mainView!==true||data.visible!==true||data.focused!==true||!safeInt(data.throughSeq)||data.userIntent!==c.userIntent)fail('ACCESS_DENIED');
    if([...this.pending.values()].some(p=>p.client===c))fail('VIEW_UNCONFIRMED');
    const record=this.runtime.store.data.records.find(r=>r.id===data.completionId&&r.conversation.sessionId===data.sessionId&&r.streamEpoch===data.streamEpoch&&r.terminalEventSeq===data.throughSeq);
    if(!record)fail('TARGET_GONE');
    const native=await this.runtime.bridge.request('verifyForeground',{windowToken:c.windowToken,completionId:record.id,requireUserInput:true});
    if(!native.foreground||native.userInput!==true)fail('VIEW_UNCONFIRMED');
    await this.runtime.store.acknowledge(record.conversation,record.streamEpoch,record.terminalEventSeq);await this.runtime.render();this.publish();this.runtime.publish();return {acknowledged:true};
  }
  remove(clientId){const c=this.clients.get(clientId);c?.stop?.();this.clients.delete(clientId);if(c?.windowToken&&this.runtime.bridge?.group)void this.runtime.bridge.request('unbindWindow',{windowToken:c.windowToken}).catch(()=>{});for(const [id,p]of this.pending)if(p.client===c){this.pending.delete(id);p.detach();p.reject(Object.assign(new Error('NAVIGATION_UNCONFIRMED'),{code:'NAVIGATION_UNCONFIRMED'}));}}
  dispose(){this.closed=true;for(const id of [...this.clients.keys()])this.remove(id);}
}
