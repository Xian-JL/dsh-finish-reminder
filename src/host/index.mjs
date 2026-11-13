import z from '@deepseek-ai/schemastery';
import { Runtime } from './runtime.mjs';
import { decodeSettings } from '../shared/contracts.mjs';
export const name='dsh-finish-reminder';
export const inject=['agents','sessions','profileContext','connection'];
export const Config=z.object({enabled:z.boolean().default(true).volatile(),diagnosticsEnabled:z.boolean().default(false).volatile(),
  quietUntil:z.number().min(0).max(8640000000000000).default(0).volatile(),quietScheduleEnabled:z.boolean().default(false).volatile(),
  quietStart:z.string().default('22:00').volatile(),quietEnd:z.string().default('08:00').volatile(),quietDays:z.number().min(0).max(127).step(1).default(127).volatile()});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
async function body(request){
  if(request.headers.get('content-type')!=='application/json'||!request.body)throw Object.assign(new Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});
  const reader=request.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32768){await reader.cancel();throw new Error('REQUEST_TOO_LARGE');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}
  finally{reader.releaseLock();}
}
export async function apply(ctx,raw={}) {
  const runtime=new Runtime(ctx);let disposed=false;let configuration=Promise.resolve();
  ctx.effect(()=>async()=>{disposed=true;await configuration.catch(()=>{});await runtime.dispose();});
  // Subscribe before asynchronous storage initialization; runtime has no enabled live baseline yet.
  ctx.on('session/event',(session,event)=>runtime.accept(session,event),{global:true});
  ctx.on('agent/inbox/claimed',payload=>{if(!runtime.archived.has(payload?.agent?.id))runtime.events?.claim(payload);},{global:true});
  ctx.on('session/disposed',session=>runtime.events?.forget(session.id),{global:true});
  ctx.on('agent/status',({agent})=>runtime.taskStatus(agent),{global:true});
  try {await runtime.start();}catch(e){runtime.setError(e.code??'STATE_UNAVAILABLE');}
  const reconcile=()=>{
    configuration=configuration.catch(()=>{}).then(async()=>{
      if(disposed)return;
      try {const settings=decodeSettings(raw);if(runtime.store?.ready)await runtime.configure(settings);}
      catch(e){runtime.setError(e.code??'CONFIG_UNAVAILABLE');await runtime.setEnabled(false);}
    });return configuration;
  };
  await reconcile();
  ctx.on('loader/volatile-update',reconcile);
  const connection=ctx.get('connection');
  const post=(path,callback)=>ctx.effect(()=>connection.fetch.register({path:'/api/dsh-finish-reminder/'+path,methods:['POST'],requestBody:'streaming',fetch:async request=>{
    try{return response(await callback(await body(request)));}catch(e){return response({error:/^[A-Z_]+$/.test(e.code??'')?e.code:'INVALID_REQUEST'},400);}
  }}));
  post('client',data=>runtime.clients.update(data));
  post('client-close',data=>{runtime.clients.remove(data.clientId);return {closed:true};});
  post('navigation-result',data=>runtime.clients.navigationResult(data));
  post('read',data=>runtime.clients.manualRead(data));
  post('retry-native',()=>{runtime.recoveryAttempt=0;runtime.recover();return {requested:true};});
  post('notifications/open',data=>runtime.openCenterRecord(data.completionId,data.clientId));
  ctx.effect(()=>connection.fetch.register({path:'/api/dsh-finish-reminder/notifications',methods:['GET'],requestBody:'buffered',fetch:request=>{
    try{return response(runtime.center(Object.fromEntries(new URL(request.url).searchParams)));}
    catch(e){return response({error:e.code??'INVALID_REQUEST'},e.code==='CENTER_SNAPSHOT_CHANGED'?409:400);}
  }}));
  ctx.effect(()=>connection.fetch.register({path:'/api/dsh-finish-reminder/events',methods:['GET'],requestBody:'buffered',fetch:request=>{
    try{return new Response(runtime.clients.stream(new URL(request.url).searchParams.get('clientId'),request.signal),{headers:{'content-type':'text/event-stream','cache-control':'private, no-store','x-content-type-options':'nosniff'}});}
    catch{return response({error:'ACCESS_DENIED'},403);}
  }}));
  ctx.on('domain/changed',change=>{
    if(change?.domain==='workspace'&&change.table===''&&change.operation==='put'&&Array.isArray(change.value?.archivedSessionIds)){
      const next=new Set(change.value.archivedSessionIds),previous=runtime.archived;runtime.archived=next;
      for(const id of next)if(!previous.has(id))void runtime.retire(id).catch(e=>runtime.setError(e.code??'STATE_WRITE_FAILED'));
    }
  },{global:true});
  ctx.effect(()=>connection.fetch.register({path:'/api/dsh-finish-reminder/status',methods:['GET'],requestBody:'buffered',fetch:()=>response(runtime.status())}));
  ctx.effect(()=>connection.fetch.register({path:'/api/dsh-finish-reminder/theme',methods:['POST'],requestBody:'streaming',fetch:async request=>{
    if(request.headers.get('content-type')!=='application/json'||!request.body)return response({error:'INVALID_REQUEST'},400);
    const reader=request.body.getReader();let text='',bytes=0;
    try {
      for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>128){await reader.cancel();return response({error:'INVALID_REQUEST'},413);}text+=new TextDecoder().decode(part.value);}
      const data=JSON.parse(text);runtime.updateTheme(data.dark);return response({ok:true});
    }catch{return response({error:'INVALID_REQUEST'},400);}finally{reader.releaseLock();}
  }}));
  ctx.effect(()=>connection.fetch.register({path:'/api/dsh-finish-reminder/retry-storage',methods:['POST'],requestBody:'buffered',fetch:async request=>{
    // Host connection owns authentication; Origin and explicit JSON request prevent cross-origin form posts.
    if(request.headers.get('content-type')!=='application/json')return response({error:'INVALID_REQUEST'},400);
    try {await runtime.retryStorage();return response(runtime.status());}catch(e){return response({error:e.code??'STATE_WRITE_FAILED'},503);}
  }}));
}
