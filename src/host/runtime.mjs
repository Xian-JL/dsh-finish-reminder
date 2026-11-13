import { randomUUID, createHash } from 'node:crypto';
import { join, isAbsolute, win32 } from 'node:path';
import { CompletionStore, FileStorage } from '../core/store.mjs';
import { ReminderQueue } from '../core/queue.mjs';
import { EventAdapter } from './events.mjs';
import { NativeBridge } from './bridge.mjs';
import { GroupBridge } from './group.mjs';
import { ClientHub } from './clients.mjs';
import { NavigationController } from '../core/navigation.mjs';
import { capabilityStatus, keyOf, VERSION, safeInt, fail, cleanTitle, decodeSettings } from '../shared/contracts.mjs';
import {quietState,quietDelay} from '../core/quiet.mjs';
import {centerPage,HISTORY_LIMIT} from '../core/center.mjs';

/** Profile-scoped state owner; presentation and navigation share the group coordinator. */
export class Runtime {
  constructor(ctx,{store,bridge,now,platform=process.platform}={}) {
    this.ctx=ctx;this.platform=platform;this.injectedStore=store;
    this.queue=new ReminderQueue({now});this.nativeFactory=bridge;
    this.store=null;this.bridge=null;this.events=null;this.timer=null;this.closed=false;this.enabled=false;
    this.epoch=0;this.error=null;this.listeners=new Set();this.tasks=Promise.resolve();this.renderTasks=Promise.resolve();
    this.outbox=new Map();this.eventError=null;this.lastNative=null;this.dark=false;
    this.capabilities={initializing:true,events:false,popup:false,navigation:false,badge:false};
    this.blocks=[];this.groupQueued=0;this.aggregateCount=null;this.readBaselines=new Set();this.deliveryAttempts=new Map();this.recoveryTimer=null;this.recoveryAttempt=0;
    this.archived=new Set(ctx.get('workspaceRegistry')?.archivedSessionIds??[]);this.sweepTimer=null;this.sweepCursor=0;this.sweepTask=null;this.sweepAbort=new AbortController();
    this.settings=decodeSettings();this.quietActive=false;this.quietTimer=null;this.pendingCards=new Set();this.runningRevision=0;
    this.historyDirty=false;this.historyWork=null;
  }
  async start() {
    const profile=this.ctx.get('profileContext');
    if(!this.injectedStore && (!profile || !isAbsolute(profile.dir??'') || typeof profile.name!=='string'))fail('PROFILE_CONTEXT_UNAVAILABLE');
    this.profile=profile??{name:'fixture',dir:''};
    this.store=this.injectedStore??new CompletionStore(new FileStorage(join(profile.dir,'data','dsh-finish-reminder','state.json')));
    await this.store.load();
    if(this.store.data.records.filter(r=>r.readState!=='unread').length>HISTORY_LIMIT)await this.store.pruneHistory(new Set(),HISTORY_LIMIT);
    this.clients=new ClientHub(this);
    this.navigation=new NavigationController({adapter:this.clients,store:this.store,onError:code=>{this.eventError=code;this.publish();}});
    this.capabilities.initializing=false;
    this.capabilities.events=!!this.ctx.get('agents')?.get;
    this.publish();
  }
  async setEnabled(value) {
    if(this.closed||value===this.enabled)return;
    this.enabled=value;const epoch=++this.epoch;
    clearTimeout(this.timer);this.timer=null;this.events?.dispose();this.events=null;this.queue.disable();
    if(!value) {
      clearTimeout(this.recoveryTimer);clearTimeout(this.sweepTimer);clearTimeout(this.quietTimer);this.quietTimer=null;this.pendingCards.clear();this.sweepTimer=null;this.sweepAbort.abort();this.navigation?.dispose();this.clients?.invalidate();
      try{await this.bridge?.dispose();}catch{}this.bridge=null;this.capabilities.popup=false;this.capabilities.navigation=false;this.capabilities.badge=false;this.publish();return;
    }
    this.queue.enable();this.error=null;
    this.quietActive=quietState(this.settings).active;this.scheduleQuiet();
    this.sweepAbort=new AbortController();
    if(!this.capabilities.events) {this.setError('END_UNCONFIRMED');return;}
    if(this.platform!=='win32'&&!this.nativeFactory){this.setError('UNSUPPORTED_PLATFORM');return;}
    this.events=new EventAdapter({agents:this.ctx.get('agents'),identity:s=>this.identity(s),onFact:f=>this.commit(f),onError:code=>{if(epoch===this.epoch){this.eventError=code;this.publish();}}});
    if(this.navigation?.closed)this.navigation=new NavigationController({adapter:this.clients,store:this.store,onError:code=>{this.eventError=code;this.publish();}});
    this.bridge=this.nativeFactory?.({onEvent:e=>this.nativeEvent(e,epoch),onError:c=>{if(epoch===this.epoch&&this.enabled)this.setError(c);}})??
      new GroupBridge({onEvent:e=>this.nativeEvent(e,epoch),onError:c=>{if(epoch===this.epoch&&this.enabled){this.setError(c);this.recover();}}});
    try {
      const snapshot=this.store.snapshot();
      const caps=await this.bridge.request(this.bridge.group?'register':'hello',this.bridge.group?{sourceId:snapshot.sourceId,count:snapshot.count,revision:snapshot.revision,hostPid:process.pid,dark:this.dark,quiet:this.quietActive}:{});
      if(epoch!==this.epoch||!this.enabled)return;
      this.lastNative=caps;this.capabilities.popup=caps.version===VERSION&&caps.popup===true;
      if(this.bridge.group){this.capabilities.badge=caps.desktop===true&&caps.badge===true;if(!caps.desktop)this.setError('DESKTOP_BRIDGE_UNAVAILABLE');this.recoveryAttempt=0;await this.clients.rebindAll();await this.syncBaselines();}
      this.publish();
      this.scheduleSweep();
    } catch(e){if(epoch===this.epoch)this.setError(e.code??'HELPER_EXITED');}
  }
  identity(session) {
    if(!this.store?.ready||!safeInt(session.header?.createdAt))return null;
    const sourceId=this.store.data.sourceId;
    let title='对话';
    try {title=this.ctx.get('sessionProjections')?.snapshot(session,['title'])?.values?.title??title;}catch{}
    let workspaceId=null,workspaceTitle='未分组';
    try{const workspaces=this.ctx.get('workspaceRegistry')?.list?.()??[];
      const workspace=workspaces.find(w=>w.sessionIds?.includes(session.id))??workspaces.find(w=>typeof w.path==='string'&&typeof session.header?.cwd==='string'&&win32.normalize(w.path).toLowerCase()===win32.normalize(session.header.cwd).toLowerCase());
      if(workspace){workspaceId=String(workspace.id);workspaceTitle=cleanTitle(workspace.title);}
    }catch{}
    return {conversation:{desktopAppGroupId:'dsh-desktop',hostInstanceId:sourceId,profileId:this.profile.name,sessionId:session.id},
      streamEpoch:String(session.header.createdAt),displayTitle:cleanTitle(title),workspaceId,workspaceTitle};
  }
  accept(session,event) {if(this.enabled&&!this.closed&&!this.archived.has(session.id))this.events?.accept(session,event);}
  commit(fact) {
    const epoch=this.epoch;
    const work=this.tasks.catch(()=>{}).then(async()=>{
      if(this.closed||!this.enabled||epoch!==this.epoch)return;
      try {
        await this.reconcileQuiet();if(this.closed||!this.enabled||epoch!==this.epoch)return;
        const result=await this.store.submit({...fact,silenced:this.quietActive});
        if(result.inserted)this.outbox.set(result.record.id,result.record);
        if(!this.enabled||epoch!==this.epoch) {this.outbox.clear();return;}
        await this.drainOutbox();
        this.publish();await this.render();this.scheduleSweep();
      } catch(e) {
        // Failed writes retain the in-memory record and its dedupe identity. Retry flush, never invent a new id.
        const record=this.store.data.records.find(r=>r.terminalEventSeq===fact.terminalEventSeq&&r.streamEpoch===fact.streamEpoch&&keyOf(r.conversation)===keyOf(fact.conversation));
        if(record)this.outbox.set(record.id,record);
        this.setError(e.code??'STATE_WRITE_FAILED');
      }
    });this.tasks=work;return work;
  }
  async drainOutbox() {
    for(const [id,record] of this.outbox) {
      if(this.bridge?.group){
        if(this.bridge.closed)fail('HELPER_EXITED');
        const attempted=this.deliveryAttempts.get(id);
        if(attempted&&attempted!==this.bridge.generation){this.outbox.delete(id);this.deliveryAttempts.delete(id);this.eventError='DISPLAY_DELIVERY_UNCONFIRMED';continue;}
        this.deliveryAttempts.set(id,this.bridge.generation);
        const result=await this.bridge.request('submit',{record,running:this.isRunning(record.conversation),runningRevision:this.runningRevision});
        if(result.queued!==false&&!result.silenced)this.pendingCards.add(id);
        if(result.silenced)await this.store.markSilenced(id);
        this.readBaselines.add(id);this.deliveryAttempts.delete(id);
      }
      else if(!record.silenced&&!this.quietActive)this.queue.enqueue(record);
      this.outbox.delete(id);
    }
  }
  async retryStorage() {
    await this.store.flush();
    if(this.enabled){await this.drainOutbox();this.error=null;await this.render();}else this.outbox.clear();
    this.publish();
  }
  nativeEvent(event,epoch) {
    if(this.closed||!this.enabled||epoch!==this.epoch)return;
    if(this.bridge?.group){
      if(event.kind==='cardRemoved'){this.pendingCards.delete(event.completionId);this.scheduleHistoryPrune();return;}
      if(event.kind==='click'){
        const record=this.store.data.records.find(r=>r.id===event.completionId);
        if(record)void this.navigateCompletion(record);
      }else if(event.kind==='queueStatus'){this.groupQueued=event.queued;this.aggregateCount=event.aggregateCount;}
      else if(event.kind==='badgeStatus'){this.capabilities.badge=event.supported===true;this.badgeError=event.code??null;}
      else if(event.kind==='fault'){this.setError(event.code);this.recover();}
      this.publish();return;
    }
    const token={cardId:event.cardId,displayGeneration:event.displayGeneration};
    if(event.kind==='painted')this.queue.painted(token);
    else if(event.kind==='availability')this.queue.setAvailable(event.available);
    else if(event.kind==='hover'){if(this.queue.hover(token,event.paused===true))void this.render();}
    else if(event.kind==='dismiss')this.queue.dismiss(token);
    else if(event.kind==='click') {
      const entry=this.queue.click(token);
      if(entry) {
        // Native navigation identity is not proven in the inspected Desktop. Never guess a window or ACK.
        this.eventError='DESKTOP_BRIDGE_UNAVAILABLE';
      }
    }
    void this.render();this.publish();
  }
  async navigateCompletion(record) {
    let ok=true,code=null;
    try { await this.navigation.open(record,randomUUID()); }
    catch(e) { ok=false;code=e?.code??'NAVIGATION_UNCONFIRMED'; }
    try { await this.bridge?.request('clickDone',ok?{completionId:record.id,ok:true}:{completionId:record.id,ok:false,code}); } catch {}
    await this.render();this.clients?.publish();this.publish();
  }
  async openCenterRecord(id,clientId){
    if(!this.enabled)fail('PLUGIN_DISABLED');
    const record=this.store?.data.records.find(r=>r.id===id);if(!record||record.readState==='retired')fail('TARGET_GONE');
    if(!this.clients?.clients.get(clientId)?.windowToken)fail('CLIENT_UNAVAILABLE');
    await this.navigation.open(record,randomUUID(),{clientId});await this.render();this.publish();return {opened:true};
  }
  render() {
    const epoch=this.epoch;
    const work=this.renderTasks.catch(()=>{}).then(async()=>{
      if(this.closed||!this.enabled||epoch!==this.epoch||!this.bridge||!this.capabilities.popup)return;
      const protect=this.bridge.group?this.pendingCards:new Set(this.queue.entries.map(e=>e.record.id));
      if(this.store.data.records.filter(r=>r.readState!=='unread').length>HISTORY_LIMIT)await this.store.pruneHistory(protect,HISTORY_LIMIT);
      if(this.bridge.group){
        const snapshot=this.store.snapshot();
        try{const result=await this.bridge.request('snapshot',{count:snapshot.count,revision:snapshot.revision,dark:this.dark,quiet:this.quietActive});this.groupQueued=result.queued??this.groupQueued;this.aggregateCount=result.count;await this.syncBaselines();this.clients?.publish();}
        catch(e){this.setError(e.code??'HELPER_EXITED');}
        return;
      }
      clearTimeout(this.timer);this.timer=null;
      const view=this.queue.view();
      try {
        await this.bridge.request('syncView',{front:view.front,previews:view.previews,queued:view.queued,available:view.available,dark:this.dark});
      }catch(e){
        if(epoch!==this.epoch)return;
        if(e.code==='DISPLAY_UNAVAILABLE')this.queue.setAvailable(false);
        this.setError(e.code??'HELPER_EXITED');return;
      }
      if(this.queue.front?.state==='front'&&epoch===this.epoch) {
        const token=this.queue.token();
        this.timer=setTimeout(()=>{this.queue.due(token);void this.render();this.publish();},Math.ceil(this.queue.remaining()));
      }
    });this.renderTasks=work.catch(e=>this.setError(e.code??'STATE_WRITE_FAILED'));return this.renderTasks;
  }
  async retire(sessionId) {
    if(!this.store?.ready)return;
    const records=[...new Map(this.store.data.records.filter(r=>r.conversation.sessionId===sessionId).map(r=>[keyOf(r.conversation),r])).values()];
    for(const record of records) {await this.store.retire(record.conversation);if(this.bridge?.group)await this.bridge.request('retire',{conversation:record.conversation});else this.queue.retire(keyOf(record.conversation),keyOf);}
    for(const [id,r]of this.outbox)if(r.conversation.sessionId===sessionId)this.outbox.delete(id);
    this.events?.forget(sessionId);await this.render();this.publish();
  }
  updateTheme(dark) {if(typeof dark!=='boolean')fail('INVALID_REQUEST');if(this.dark!==dark){this.dark=dark;void this.render();}}
  async configure(settings){this.settings=decodeSettings(settings);await this.setEnabled(this.settings.enabled);await this.reconcileQuiet();}
  async reconcileQuiet(){
    const next=quietState(this.settings).active,changed=next!==this.quietActive;this.quietActive=next;
    if(changed&&this.enabled){
      if(!this.bridge?.group&&next)this.queue.removeWhere(()=>true);
      await this.render();this.publish();
    }
    this.scheduleQuiet();
  }
  scheduleQuiet(){
    clearTimeout(this.quietTimer);this.quietTimer=null;if(!this.enabled||this.closed)return;
    const delay=quietDelay(this.settings);if(delay===null)return;
    this.quietTimer=setTimeout(()=>{this.quietTimer=null;void this.reconcileQuiet().catch(e=>this.setError(e.code??'CONFIG_UNAVAILABLE'));},delay);this.quietTimer.unref?.();
  }
  isRunning(conversation){const agent=this.ctx.get('agents')?.get?.(conversation.sessionId);return agent?.status==='running'&&agent.session?.header?.origin!=='subagent';}
  taskStatus(agent){
    if(this.closed||!this.enabled||!agent?.session||agent.session.header?.origin==='subagent')return;
    const identity=this.identity(agent.session);if(!identity)return;const revision=++this.runningRevision;
    if(this.bridge?.group)void this.bridge.request('running',{conversation:identity.conversation,running:agent.status==='running',revision}).catch(e=>{this.eventError=e.code??'CONTEXT_UNAVAILABLE';});
  }
  center(query={}){
    if(!this.store?.ready)fail('STATE_UNAVAILABLE');
    return {...centerPage(this.store.data.records,query,this.store.data.revision,{running:c=>this.isRunning(c)}),
      enabled:this.enabled,count:this.store.snapshot().count,quiet:quietState(this.settings),durable:!this.store.dirty};
  }
  scheduleHistoryPrune(){
    if(this.closed||!this.enabled)return;this.historyDirty=true;if(this.historyWork)return;const epoch=this.epoch;
    this.historyWork=Promise.resolve().then(async()=>{while(this.historyDirty&&!this.closed&&this.enabled&&epoch===this.epoch){this.historyDirty=false;await this.render();}})
      .finally(()=>{this.historyWork=null;if(this.historyDirty&&!this.closed&&this.enabled)this.scheduleHistoryPrune();});
  }
  scheduleSweep(){
    if(this.sweepTimer||this.closed||!this.enabled||!this.ctx.get('sessionPersistence')?.stat||!this.store.data.records.some(r=>r.readState==='unread'))return;
    this.sweepTimer=setTimeout(()=>{this.sweepTimer=null;this.sweepTask=this.sweepTargets().catch(e=>this.setError(e.code??'STATE_WRITE_FAILED')).finally(()=>{this.sweepTask=null;this.scheduleSweep();});},30000);this.sweepTimer.unref?.();
  }
  async sweepTargets(){
    const persistence=this.ctx.get('sessionPersistence');if(!persistence?.stat||this.sweepAbort.signal.aborted)return;
    const ids=[...new Set(this.store.data.records.filter(r=>r.readState==='unread').map(r=>r.conversation.sessionId))];if(!ids.length)return;
    for(let i=0;i<Math.min(16,ids.length);i++){
      if(this.sweepAbort.signal.aborted)return;const id=ids[this.sweepCursor++%ids.length];
      if(this.archived.has(id)){await this.retire(id);continue;}
      if(this.ctx.get('sessions')?.get?.(id))continue;
      try{const metadata=await persistence.stat(id,{signal:AbortSignal.any([this.sweepAbort.signal,AbortSignal.timeout(1500)])});if(this.sweepAbort.signal.aborted)return;if(metadata===undefined)await this.retire(id);}
      catch(e){if(this.sweepAbort.signal.aborted)return;this.eventError=e.code==='EACCES'||e.code==='EPERM'?'ACCESS_DENIED':'TARGET_STATE_UNCONFIRMED';}
    }
  }
  async syncBaselines(){
    if(!this.bridge?.group)return;
    const unread=new Set(this.store.data.records.filter(r=>r.readState==='unread').map(r=>r.id));
    const add=[...unread].filter(id=>!this.readBaselines.has(id)),remove=[...this.readBaselines].filter(id=>!unread.has(id));
    for(let i=0;i<add.length;i+=16){const ids=add.slice(i,i+16);await this.bridge.request('observeCompletion',{completionIds:ids});for(const id of ids)this.readBaselines.add(id);}
    for(let i=0;i<remove.length;i+=16){const ids=remove.slice(i,i+16);await this.bridge.request('forgetCompletion',{completionIds:ids});for(const id of ids)this.readBaselines.delete(id);}
  }
  recover(){
    if(this.closed||!this.enabled||this.nativeFactory||this.recoveryTimer||this.recoveryAttempt>=6)return;
    const epoch=this.epoch,delay=Math.min(4000,250*2**this.recoveryAttempt++);
    this.recoveryTimer=setTimeout(async()=>{this.recoveryTimer=null;if(this.closed||!this.enabled||epoch!==this.epoch)return;
      try{await this.bridge?.dispose();this.readBaselines.clear();this.pendingCards.clear();this.clients?.invalidate();
        this.bridge=new GroupBridge({onEvent:e=>this.nativeEvent(e,epoch),onError:c=>{if(epoch===this.epoch&&this.enabled){this.setError(c);this.recover();}}});
        const s=this.store.snapshot(),caps=await this.bridge.request('register',{sourceId:s.sourceId,count:s.count,revision:s.revision,hostPid:process.pid,dark:this.dark,quiet:this.quietActive});
        this.capabilities.popup=caps.popup===true;this.capabilities.badge=caps.desktop===true&&caps.badge===true;this.recoveryAttempt=0;this.error=null;
        await this.clients.rebindAll();await this.syncBaselines();await this.drainOutbox();await this.render();this.publish();
      }catch(e){this.setError(e.code??'HELPER_EXITED');this.recover();}
    },delay);this.recoveryTimer.unref?.();
  }
  status() {
    const snapshot=this.store?.ready?this.store.snapshot():null;
    const capabilities={...this.capabilities,error:this.error??snapshot?.error};
    return {version:VERSION,enabled:this.enabled,status:capabilityStatus(capabilities),capabilities,
      count:snapshot?.count??null,durable:snapshot?.durable??false,queued:this.bridge?.group?this.groupQueued:this.queue.entries.length,aggregateCount:this.aggregateCount,
      revision:snapshot?.revision??0,error:this.error,eventError:this.eventError,blockers:this.blocks,
      sourceTag:snapshot?createHash('sha256').update(snapshot.sourceId).digest('hex').slice(0,12):null,
      badgeError:this.badgeError??null,navigationError:this.navigationError??null,quiet:quietState(this.settings),acceptance:'USER_PENDING'};
  }
  publish() {for(const fn of this.listeners)fn();this.clients?.publish();}
  setError(code) {this.error=/^[A-Z_]{1,64}$/.test(code)?code:'INTERNAL_ERROR';this.publish();}
  async dispose() {
    if(this.closed)return;
    this.enabled=false;this.closed=true;this.epoch++;this.events?.dispose();clearTimeout(this.timer);clearTimeout(this.recoveryTimer);clearTimeout(this.quietTimer);clearTimeout(this.sweepTimer);this.sweepAbort.abort();this.timer=null;this.queue.disable();this.navigation?.dispose();this.clients?.dispose();
    await this.tasks.catch(()=>{});await this.renderTasks.catch(()=>{});try{await this.bridge?.dispose();}catch{}
    await this.store?.chain.catch(()=>{});this.listeners.clear();
    await this.sweepTask?.catch(()=>{});
    await this.historyWork?.catch(()=>{});
  }
}
