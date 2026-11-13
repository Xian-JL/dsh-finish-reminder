import {fail,OUTCOMES,safeInt,validateFact} from '../shared/contracts.mjs';
export const HISTORY_LIMIT=500;
/** Pure, paginated projection. Viewing a list never changes read state or loads conversation bodies. */
export function centerPage(records,query={},revision=0,{now=Date.now(),running=()=>false}={}){
  const state=query.state??'unread',outcome=query.outcome??'all',period=query.period??'all',workspace=query.workspace??'all';
  const offset=Number(query.offset??0),limit=Number(query.limit??25);
  if(!['unread','acknowledged','retired','all'].includes(state)||outcome!=='all'&&!Object.hasOwn(OUTCOMES,outcome)||!['all','today','7d','30d'].includes(period)||!safeInt(offset)||!safeInt(limit)||limit<1||limit>50||typeof workspace!=='string'||workspace.length>256)fail('INVALID_REQUEST');
  if(query.revision!=null&&Number(query.revision)!==revision)fail('CENTER_SNAPSHOT_CHANGED');
  const midnight=new Date(now);midnight.setHours(0,0,0,0);
  const since=period==='today'?midnight.getTime():period==='7d'?now-7*86400000:period==='30d'?now-30*86400000:-Infinity;
  const workspaceChoices=new Map();
  const sorted=[...records].sort((a,b)=>b.endedAt-a.endedAt||b.id.localeCompare(a.id));
  for(const r of sorted)if(!workspaceChoices.has(r.workspaceId??''))workspaceChoices.set(r.workspaceId??'',r.workspaceTitle||'未分组 / 旧记录');
  const filtered=sorted.filter(r=>(state==='all'||r.readState===state)&&(outcome==='all'||r.outcome===outcome)&&r.endedAt>=since&&(workspace==='all'||(r.workspaceId??'')===workspace));
  const items=filtered.slice(offset,offset+limit).map(r=>{const clean=validateFact(r);return {id:clean.id,sessionId:clean.conversation.sessionId,displayTitle:clean.displayTitle,
    endedAt:clean.endedAt,startedAt:clean.startedAt,durationMs:clean.durationMs,workspaceId:clean.workspaceId,workspaceTitle:clean.workspaceTitle,
    outcome:clean.outcome,readState:r.readState,silenced:clean.silenced,currentlyRunning:running(r.conversation)===true};});
  return {revision,offset,limit,total:filtered.length,hasMore:offset+limit<filtered.length,items,historyLimit:HISTORY_LIMIT,
    workspaces:[...workspaceChoices].map(([id,title])=>({id,title}))};
}
