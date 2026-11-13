const base='/api/dsh-finish-reminder';
const safeId=x=>typeof x==='string'&&x.length>0&&x.length<=256;
let activeClientId=null;
export const getClientId=()=>activeClientId;
let prepareActiveClient=async()=>null;
export const prepareClient=()=>prepareActiveClient();
/** Native Client stores only identity/sequence metadata. Message bodies are never read or sent. */
export function mountNavigation(ctx){
  if(typeof window==='undefined'||typeof window.dshDesktop?.deviceInfo!=='function')return ()=>{};
  const sessions=ctx.get('sessions'),workspace=ctx.get('uiWorkspace'),layout=ctx.get('layout');
  if(!sessions?.binding||!workspace?.selection?.subscribe||!layout?.panelInfo?.subscribe)return ()=>{};
  const lifetime=new AbortController(),clientId=crypto.randomUUID();let closed=false,intent=0,targets=new Map(),staged=null,stagedGeneration=0,gesture=null;
  activeClientId=clientId;
  let navigation=null,reconnect=null,retry=0,metadataChain=Promise.resolve(),geometryTimer=null,reading=false;
  const post=async(path,data,signal=lifetime.signal)=>{
    const r=await fetch(base+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({clientId,...data}),signal});
    const body=await r.json();if(!r.ok)throw Object.assign(new Error(body.error??'REQUEST_FAILED'),{code:body.error});return body;
  };
  const current=()=>workspace.selection.getSnapshot().sessionId;
  const visible=id=>{
    const state=sessions.binding(id)?.session.getSnapshot();
    const access=ctx.get('remoteAccess');
    return document.visibilityState==='visible'&&document.hasFocus()&&current()===id&&layout.panelInfo.getSnapshot().activePanelId===null&&
      (sessions.list.getSnapshot().byId[id]?.retainedBy?.mainView??0)>0&&state?.openState==='open'&&state.removed!==true&&state.openError===null&&
      (!access?.source||access.source('session',id,'session/follow').getSnapshot()===true);
  };
  const metadata=()=>{
    const data={desktop:true,sessionId:current()??null,focused:document.hasFocus()&&document.visibilityState==='visible',userIntent:intent,
      x:window.screenX,y:window.screenY,width:window.outerWidth,height:window.outerHeight};
    const task=metadataChain.catch(()=>{}).then(()=>post('/client',data));metadataChain=task;return task;
  };
  prepareActiveClient=async()=>{await metadata();return closed?null:clientId;};
  const hasBoundary=(id,seq)=>{
    const binding=sessions.binding(id);if(!binding)return false;
    // Inspect durable envelope fields only, never data/content/text. The source is already owned by the main view.
    return binding.eventSource.getSnapshot().entries.some(entry=>entry.type!=='transient'&&entry.event?.seq===seq&&entry.event?.type==='turn/end');
  };
  const twoFrames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const attemptRead=async()=>{
    if(closed||reading||navigation||!gesture||performance.now()-gesture.at>5000)return;
    const id=current(),ticket=gesture.map.get(id);if(!ticket||!visible(id)||!hasBoundary(id,ticket.throughSeq))return;
    const activeIntent=intent;reading=true;
    try{
      await metadata();await twoFrames();if(closed||navigation||activeIntent!==intent||!visible(id))return;
      await post('/read',{...ticket,sessionId:id,userIntent:activeIntent,mainView:true,visible:true,focused:true});
    }catch{}finally{reading=false;}
  };
  const human=e=>{
    if(!e.isTrusted)return;intent++;gesture={at:performance.now(),map:targets};
    if(navigation){navigation.abort.abort();navigation=null;}
    void metadata().catch(()=>{});queueMicrotask(()=>void attemptRead());
  };
  const focus=e=>{if(!e.isTrusted)return;gesture={at:performance.now(),map:targets};void metadata().then(()=>attemptRead()).catch(()=>{});};
  const selection=()=>{void metadata().then(()=>attemptRead()).catch(()=>{});};
  const resize=()=>{clearTimeout(geometryTimer);geometryTimer=setTimeout(()=>{void metadata().catch(()=>{});},100);};
  async function navigate(message){
    if(!safeId(message.sessionId)||!safeId(message.requestId)||!Number.isSafeInteger(message.throughSeq))return;
    if(message.userIntent!==intent){await post('/navigation-result',{requestId:message.requestId,ok:false,code:'NAVIGATION_CANCELLED'}).catch(()=>{});return;}
    navigation?.abort.abort();const abort=new AbortController(),transaction={id:message.requestId,abort};navigation=transaction;
    const stop=[];let timeout;
    const result={requestId:message.requestId,sessionId:message.sessionId,streamEpoch:message.streamEpoch,throughSeq:message.throughSeq,userIntent:message.userIntent};
    try{
      const row=sessions.list.getSnapshot().byId[message.sessionId];
      if(row?.archived===true)throw Object.assign(new Error('TARGET_ARCHIVED'),{code:'TARGET_ARCHIVED'});
      const observed=new Promise((resolve,reject)=>{
        let opened=false;
        const check=()=>{
          if(closed||abort.signal.aborted||intent!==message.userIntent){reject(Object.assign(new Error('NAVIGATION_CANCELLED'),{code:'NAVIGATION_CANCELLED'}));return;}
          if(opened&&current()!==message.sessionId){reject(Object.assign(new Error('NAVIGATION_CANCELLED'),{code:'NAVIGATION_CANCELLED'}));return;}
          if(!visible(message.sessionId))return;
          if(hasBoundary(message.sessionId,message.throughSeq))resolve();
        };
        stop.push(workspace.selection.subscribe(check),sessions.list.subscribe(check),layout.panelInfo.subscribe(check));
        window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);stop.push(()=>window.removeEventListener('focus',check),()=>document.removeEventListener('visibilitychange',check));
        const access=ctx.get('remoteAccess')?.source?.('session',message.sessionId,'session/follow');if(access?.subscribe)stop.push(access.subscribe(check));
        const onAbort=()=>reject(Object.assign(new Error('NAVIGATION_CANCELLED'),{code:'NAVIGATION_CANCELLED'}));abort.signal.addEventListener('abort',onAbort,{once:true});stop.push(()=>abort.signal.removeEventListener('abort',onAbort));
        timeout=setTimeout(()=>reject(Object.assign(new Error('NAVIGATION_TIMEOUT'),{code:'NAVIGATION_TIMEOUT'})),2800);
        workspace.openSession(message.sessionId);opened=true;
        const binding=sessions.binding(message.sessionId);
        if(binding){stop.push(binding.eventSource.subscribe(check));if(binding.session?.subscribe)stop.push(binding.session.subscribe(check));
          if(!hasBoundary(message.sessionId,message.throughSeq)&&binding.session?.loadThrough)void binding.session.loadThrough(message.throughSeq).then(check).catch(reject);
        }
        requestAnimationFrame(check);check();
      });
      await observed;await twoFrames();
      if(abort.signal.aborted||intent!==message.userIntent||current()!==message.sessionId||!visible(message.sessionId))throw new Error('NAVIGATION_CANCELLED');
      await post('/navigation-result',{...result,ok:true,mainView:true,visible:true,focused:true},abort.signal);
    }catch(e){if(!closed)await post('/navigation-result',{...result,ok:false,code:/^[A-Z_]+$/.test(e.code??'')?e.code:'NAVIGATION_UNCONFIRMED'}).catch(()=>{});}
    finally{clearTimeout(timeout);for(const f of stop)try{f();}catch{}if(navigation===transaction)navigation=null;}
  }
  function receive(type,data){
    if(type==='navigate'){void navigate(data);return;}
    if(type==='cancelNavigation'){if(navigation?.id===data.requestId)navigation.abort.abort();return;}
    if(type==='targetsStart'){staged=new Map();stagedGeneration=data.generation;}
    else if(type==='targetsChunk'&&data.generation===stagedGeneration&&staged){
      for(const item of data.items??[])if(safeId(item.sessionId)&&Number.isSafeInteger(item.throughSeq)&&safeId(item.streamEpoch)&&typeof item.completionId==='string'){
        const previous=staged.get(item.sessionId);if(!previous||previous.throughSeq<item.throughSeq)staged.set(item.sessionId,item);
      }
      if(staged.size>10000)throw new Error('QUEUE_CAPACITY_ERROR');
    }else if(type==='targetsEnd'&&data.generation===stagedGeneration&&staged){targets=staged;staged=null;}
  }
  async function connect(){
    try{
      await metadata();if(closed)return;
      const response=await fetch(base+'/events?clientId='+encodeURIComponent(clientId),{credentials:'same-origin',cache:'no-store',signal:lifetime.signal});
      if(!response.ok||!response.body)throw new Error('CLIENT_CHANNEL_UNAVAILABLE');retry=0;
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      try{for(;;){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});
        let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(frame.length>32768)throw new Error('PROTOCOL_ERROR');
          const type=frame.match(/^event: ([a-zA-Z]+)$/m)?.[1],json=frame.match(/^data: (.*)$/m)?.[1];if(type&&json)receive(type,JSON.parse(json));}
        if(buffer.length>32768)throw new Error('PROTOCOL_ERROR');
      }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    }catch{}finally{if(!closed)reconnect=setTimeout(()=>void connect(),Math.min(5000,500*2**retry++));}
  }
  document.addEventListener('pointerdown',human,true);document.addEventListener('keydown',human,true);window.addEventListener('focus',focus);window.addEventListener('resize',resize);
  const unsubscribe=workspace.selection.subscribe(selection);void connect();
  return ()=>{closed=true;if(activeClientId===clientId){activeClientId=null;prepareActiveClient=async()=>null;}lifetime.abort();navigation?.abort.abort();clearTimeout(reconnect);clearTimeout(geometryTimer);unsubscribe();
    document.removeEventListener('pointerdown',human,true);document.removeEventListener('keydown',human,true);window.removeEventListener('focus',focus);window.removeEventListener('resize',resize);
    void fetch(base+'/client-close',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({clientId}),keepalive:true}).catch(()=>{});
  };
}
