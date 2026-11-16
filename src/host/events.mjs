import { cleanTitle, safeInt } from '../shared/contracts.mjs';

const reasonMap={completed:'ended',error:'error',aborted:'stopped',interrupted:'interrupted','max-tokens':'limited',blocked:'blocked'};
/** Adapter for the reviewed rc.1/rc.3 ReactLoopAgent contracts. No transcript reads. */
export class EventAdapter {
  constructor({agents,identity,onFact,onError=()=>{},now=()=>Date.now(),monoNow=()=>performance.now(),timeoutMs=5000}) {
    Object.assign(this,{agents,identity,onFact,onError,now,monoNow,timeoutMs});
    this.tasks=new Map();this.candidates=new Map();this.inboxes=new Map();this.closed=false;this.epoch=0;
  }
  accept(session,event) {
    if(this.closed || !session || !event || !safeInt(event.seq) || event.seq<session.firstLiveSeq ||
      typeof session.isOwnSeq!=='function' || !session.isOwnSeq(event.seq) || session.header?.origin==='subagent') return;
    let task=this.tasks.get(session.id);
    if(event.type==='agent/inbox/spliced')this.trackInbox(session,event.data);
    if(event.type==='turn/start') {
      if(!safeInt(event.data?.turn)) return;
      // Root status stays running across automatically continued turns. Keep one episode until idle.
      const turnStartedAt=safeInt(event.time)?event.time:this.now(),turnStartedMono=this.monoNow();
      task={episodeId:task?.episodeId??'turn:'+event.data.turn,turn:event.data.turn,stepped:false,claimed:false,session,
        startedAt:task?task.startedAt??null:turnStartedAt,startedMono:task?task.startedMono??null:turnStartedMono,turnStartedAt,turnStartedMono,
        previousCandidate:this.candidates.get(session.id),startSeq:event.seq};this.tasks.set(session.id,task);
    } else if(event.type==='step/start' && task && event.data?.turn===task.turn) task.stepped=true;
    else if(event.type==='agent/inbox/spliced' && task && event.data?.removedCount>0 && event.data?.outcome!=='canceled') task.claimed=true;
    else if(event.type==='turn/end') {
      const reason=event.data?.reason?.kind;
      if(reason==='forked') return;
      const runningAgent=this.agents.get(session.id);
      if(!task&&runningAgent?.phase?.kind==='running'&&runningAgent.phase.turn===event.data?.turn&&runningAgent.phase.step>0){
        task={episodeId:'turn:'+event.data.turn,turn:event.data.turn,stepped:true,claimed:false,session};this.tasks.set(session.id,task);
      }
      if(!task || event.data?.turn!==task.turn || (!task.stepped && !(task.claimed && reason!=='completed'))) return;
      const agent=this.agents.get(session.id);
      if(!agent || agent.session!==session || typeof agent.whenIdle!=='function') {this.onError('END_UNCONFIRMED');return;}
      this.cancelCandidate(session.id);
      const epoch=this.epoch,seq=event.seq;
      const candidate={task:{...task,previousCandidate:undefined},event,timer:null,endedAt:safeInt(event.time)?event.time:this.now(),
        durationMs:typeof task.startedMono==='number'?Math.max(0,Math.round(this.monoNow()-task.startedMono)):null};this.candidates.set(session.id,candidate);
      candidate.timer=setTimeout(()=>{
        if(this.candidates.get(session.id)!==candidate)return;
        this.candidates.delete(session.id);this.onError('END_UNCONFIRMED');
      },this.timeoutMs);
      Promise.resolve(agent.whenIdle()).then(async()=>{
        if(this.closed || epoch!==this.epoch || this.candidates.get(session.id)!==candidate) return;
        if(this.agents.get(session.id)!==agent || agent.status!=='idle' || agent.session!==session) return;
        // An idle driver with pending input may restart. The inspected driver's whenIdle drains that chain.
        if(agent.inbox?.hasPending===true || (agent.phase && agent.phase.kind!=='idle')) return;
        this.cancelCandidate(session.id);this.tasks.delete(session.id);
        await this.emitFact(session,candidate);
      }).catch(()=>this.onError('END_UNCONFIRMED'));
    }
  }
  trackInbox(session,data){
    if(!data||!['next-step','next-turn'].includes(data.target)||!safeInt(data.start)||!Array.isArray(data.inserted))return;
    let inbox=this.inboxes.get(session.id);if(!inbox){inbox={'next-step':[],'next-turn':[],claimed:new Map()};this.inboxes.set(session.id,inbox);}
    const list=inbox[data.target],remove=data.removedCount??0;if(!safeInt(remove)||data.start>list.length||data.start+remove>list.length)return;
    const removed=list.splice(data.start,remove,...data.inserted.map(m=>({id:m.id,human:m.source?.kind==='user'})));
    if(data.outcome!=='canceled')for(const m of removed)inbox.claimed.set(m.id,{...m,target:data.target});
  }
  claim({agent,message,turn}){
    if(this.closed||!agent||this.agents.get(agent.id)!==agent||agent.session?.header?.origin==='subagent'||!safeInt(turn))return;
    const session=agent.session;let task=this.tasks.get(session.id);
    if(!task){task={episodeId:'turn:'+turn,turn,stepped:false,claimed:true,session};this.tasks.set(session.id,task);}
    if(task.turn!==turn)return;task.claimed=true;
    const inbox=this.inboxes.get(session.id),hint=inbox?.claimed.get(message?.id);inbox?.claimed.delete(message?.id);
    if(hint?.human&&hint.target==='next-turn'&&task.previousCandidate&&task.previousCandidate.event.data.turn<turn){
      const previous=task.previousCandidate;task.previousCandidate=null;task.episodeId='turn:'+turn;
      task.startedAt=task.turnStartedAt??null;task.startedMono=task.turnStartedMono??null;
      if(this.candidates.get(session.id)===previous)this.cancelCandidate(session.id);
      void this.emitFact(session,previous).catch(()=>this.onError('END_UNCONFIRMED'));
    }
  }
  async emitFact(session,candidate){
    if(this.closed)return;const identity=this.identity(session);if(!identity){this.onError('END_UNCONFIRMED');return;}
    await this.onFact({...identity,taskEpisodeId:candidate.task.episodeId,terminalEventSeq:candidate.event.seq,endedAt:candidate.endedAt,
      startedAt:candidate.task.startedAt??null,durationMs:candidate.durationMs,
      outcome:reasonMap[candidate.event.data?.reason?.kind]??'unknown',displayTitle:cleanTitle(identity.displayTitle)});
  }
  cancelCandidate(id) {const c=this.candidates.get(id);if(c)clearTimeout(c.timer);this.candidates.delete(id);}
  forget(sessionId) {this.cancelCandidate(sessionId);this.tasks.delete(sessionId);this.inboxes.delete(sessionId);}
  dispose() {this.closed=true;this.epoch++;for(const id of this.candidates.keys())this.cancelCandidate(id);this.tasks.clear();this.inboxes.clear();}
}
