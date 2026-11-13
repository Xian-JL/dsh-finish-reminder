import { FRONT_MS, safeInt, fail } from '../shared/contracts.mjs';

/** One serial owner, one monotonic clock domain. Painting is explicit, never inferred from send(). */
export class ReminderQueue {
  constructor({ now=()=>performance.now(), limit=10000 }={}) {
    this.now=now; this.limit=limit; this.entries=[]; this.ids=new Set(); this.order=0; this.generation=0;
    this.revision=0; this.available=true; this.startedAt=null; this.enabled=true;
  }
  enqueue(record) {
    if (!this.enabled || this.ids.has(record.id)) return false;
    if (this.entries.length>=this.limit||!Number.isSafeInteger(this.order)||this.order>=Number.MAX_SAFE_INTEGER) fail('QUEUE_CAPACITY_ERROR');
    this.ids.add(record.id);
    this.entries.push({record,cardId:record.id,receivedOrder:++this.order,remainingFrontMs:FRONT_MS,state:'queued',displayGeneration:0,hovered:false});
    if(this.entries.length===1) this.promote();
    this.revision++; return true;
  }
  promote() {
    this.startedAt=null;
    if (this.front) {this.front.state='painting'; this.front.displayGeneration=++this.generation;}
  }
  get front() { return this.entries[0]; }
  elapsed(at=this.now()) { return this.startedAt===null?0:Math.max(0,at-this.startedAt); }
  remaining() { return this.front?Math.max(0,this.front.remainingFrontMs-this.elapsed()):0; }
  token() { return this.front?{cardId:this.front.cardId,displayGeneration:this.front.displayGeneration}:null; }
  matches(token) { return !!this.front && token?.cardId===this.front.cardId && token.displayGeneration===this.front.displayGeneration; }
  painted(token) {
    if (!this.enabled || !this.available || !this.matches(token) || this.front.state!=='painting') return false;
    this.front.state=this.front.hovered?'paused':'front'; this.startedAt=this.front.hovered?null:this.now(); this.revision++; return true;
  }
  setAvailable(value) {
    if (this.available===value) return;
    if (this.front && this.startedAt!==null) this.front.remainingFrontMs=this.remaining();
    this.startedAt=null; this.available=value;
    if(this.front) {this.front.state=value?'painting':'paused'; this.front.displayGeneration=++this.generation;}
    this.revision++;
  }
  rendererLost() {
    if(this.front) this.front.remainingFrontMs=this.remaining();
    this.promote(); this.revision++;
  }
  remove(token, reason) {
    if(!this.matches(token)) return null;
    const old=this.entries.shift(); old.remainingFrontMs=this.startedAt===null?old.remainingFrontMs:Math.max(0,old.remainingFrontMs-this.elapsed());
    old.state=reason; this.promote(); this.revision++; return old;
  }
  due(token) {
    if(!this.matches(token) || this.front.state!=='front' || this.remaining()>0) return null;
    return this.remove(token,'expired');
  }
  click(token, pressedToken=token) {
    if(!this.available || !this.matches(token) || !this.matches(pressedToken) || !['front','paused'].includes(this.front.state)) return null;
    // Deadline wins even if the event loop delivers a click before its due callback.
    if(this.remaining()<=0) {this.remove(token,'expired'); return null;}
    return this.remove(token,'opening');
  }
  dismiss(token) {return this.available&&this.matches(token)&&['front','paused'].includes(this.front.state)?this.remove(token,'dismissed'):null;}
  /** Freeze the 10s budget while the pointer rests on the card (A2). */
  hover(token, paused) {
    if (!this.enabled || !this.available || !this.matches(token)) return false;
    if(this.front.state==='front'&&this.remaining()<=0){this.remove(token,'expired');return false;}
    const changed=this.front.hovered!==paused;this.front.hovered=paused;
    if(this.front.state==='painting'||this.front.state==='opening'){if(changed)this.revision++;return changed;}
    if (paused) {
      if (this.front.state !== 'front') return false;
      this.front.remainingFrontMs = this.remaining();
      this.front.state = 'paused';
      this.startedAt = null;
    } else {
      if (this.front.state !== 'paused') return false;
      this.front.state = 'front';
      this.startedAt = this.now();
    }
    this.revision++;
    return true;
  }
  /** Keep the card while navigation is in flight so a failure can be shown in place. */
  beginOpen(token) {
    if (!this.available || !this.matches(token) || !['front','paused'].includes(this.front.state)) return null;
    if (this.remaining() <= 0) { this.remove(token,'expired'); return null; }
    this.front.remainingFrontMs = this.remaining();
    this.front.state = 'opening';
    this.startedAt = null;
    this.revision++;
    return this.front;
  }
  completeOpen(token) {
    return this.matches(token) && this.front.state === 'opening' ? this.remove(token, 'opening') : null;
  }
  failOpen(token, code) {
    if (!this.matches(token) || this.front.state !== 'opening') return null;
    this.front.state = this.front.hovered?'paused':'front';
    this.front.error = code;
    this.startedAt = this.front.hovered?null:this.now();
    this.revision++;
    return this.front;
  }
  clearError(token) {
    if (!this.matches(token) || this.front.error === undefined) return false;
    delete this.front.error;
    this.revision++;
    return true;
  }
  retire(conversationKey, keyOf) {
    const previous=this.front;
    this.entries=this.entries.filter(e=>keyOf(e.record.conversation)!==conversationKey);
    if(previous!==this.front) this.promote();
    this.revision++;
  }
  removeWhere(predicate){const before=this.front;this.entries=this.entries.filter(e=>!predicate(e));if(before!==this.front)this.promote();this.revision++;}
  disable() {this.enabled=false;this.entries=[];this.startedAt=null;this.generation++;this.revision++;}
  enable() {this.enabled=true;this.generation++;this.revision++;}
  view() {
    return {revision:this.revision,available:this.available,front:this.front?this.display(this.front):null,
      previews:this.entries.slice(1,3).map(e=>({cardId:e.cardId,displayTitle:e.record.displayTitle,outcome:e.record.outcome})),
      queued:this.entries.length};
  }
  display(e) {return {cardId:e.cardId,displayGeneration:e.displayGeneration,remainingFrontMs:this.remaining(),
    outcome:e.record.outcome,displayTitle:e.record.displayTitle,endedAt:e.record.endedAt,state:e.state,receiptNumber:e.receivedOrder,
    workspaceTitle:e.record.workspaceTitle??'',durationMs:e.record.durationMs??null,currentlyRunning:e.record.currentlyRunning===true,
    ...(e.error===undefined?{}:{error:e.error})};}
}
