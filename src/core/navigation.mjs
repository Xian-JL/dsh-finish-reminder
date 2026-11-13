import { keyOf, fail } from '../shared/contracts.mjs';

/** Adapter operations must return observed evidence; API return values alone never acknowledge. */
export class NavigationController {
  constructor({adapter,store,timeoutMs=3000,onError=()=>{}}) {
    Object.assign(this,{adapter,store,timeoutMs,onError});this.pending=new Map();this.completed=new Map();this.epoch=0;this.closed=false;
  }
  open(record,requestId,{clientId}={}) {
    if(this.closed) return Promise.reject(new Error('NAVIGATION_UNAVAILABLE'));
    if(this.completed.has(requestId)) return this.completed.get(requestId);
    if(this.completed.size>=10000) return Promise.reject(new Error('QUEUE_CAPACITY_ERROR'));
    if(this.pending.has(requestId)) return this.pending.get(requestId).promise;
    // A new user click supersedes older transactions, including for another conversation.
    for(const p of this.pending.values())p.abort.abort();
    const abort=new AbortController(),generation=++this.epoch;
    const timer=setTimeout(()=>abort.abort(),this.timeoutMs);
    const task={abort,promise:null};
    const promise=(async()=>{
      try {
        const boundary={streamEpoch:record.streamEpoch,throughSeq:record.terminalEventSeq};
        let detach;
        const cancelled=new Promise((_,reject)=>{const cancel=()=>reject(Object.assign(new Error('NAVIGATION_TIMEOUT'),{code:'NAVIGATION_TIMEOUT'}));abort.signal.addEventListener('abort',cancel,{once:true});detach=()=>abort.signal.removeEventListener('abort',cancel);});
        let e;
        try {e=await Promise.race([this.adapter.openAndObserve({conversation:record.conversation,boundary,requestId,signal:abort.signal,clientId}),cancelled]);}
        finally {detach();}
        if(abort.signal.aborted||generation!==this.epoch||this.closed) fail('NAVIGATION_TIMEOUT');
        if(!e || keyOf(e.conversation)!==keyOf(record.conversation) || e.foreground!==true || e.interactive!==true ||
          e.mainView!==true || e.userIntentValid!==true || e.streamEpoch!==boundary.streamEpoch || e.visibleThroughSeq<boundary.throughSeq) fail('NAVIGATION_UNCONFIRMED');
        await this.store.acknowledge(record.conversation,boundary.streamEpoch,boundary.throughSeq);
        return {acknowledged:true};
      } catch(e) {const code=abort.signal.aborted?'NAVIGATION_TIMEOUT':e.code??'NAVIGATION_UNCONFIRMED';this.onError(code);fail(code);}
      finally {clearTimeout(timer);if(this.pending.get(requestId)===task)this.pending.delete(requestId);}
    })();
    task.promise=promise;this.pending.set(requestId,task);this.completed.set(requestId,promise);return promise;
  }
  dispose() {this.closed=true;this.epoch++;for(const p of this.pending.values())p.abort.abort();this.pending.clear();}
}
