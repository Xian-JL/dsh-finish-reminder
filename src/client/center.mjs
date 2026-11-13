import * as React from 'react';
import {OUTCOMES,formatDuration} from '../shared/contracts.mjs';
import {prepareClient} from './navigation.mjs';
const h=React.createElement,base='/api/dsh-finish-reminder';
const stateLabels={unread:'未查看',acknowledged:'已查看',retired:'已退休'};
const control={font:'inherit',padding:'6px 9px',borderRadius:6};
export const timeText=ms=>new Date(ms).toLocaleString('zh-CN',{hour12:false});
export function NotificationRow({item,enabled,busy,onOpen}){
  return h('tr',null,
    h('td',{style:{padding:10,minWidth:190}},h('div',{style:{fontWeight:600,overflowWrap:'anywhere'}},item.displayTitle),
      h('div',{style:{fontSize:12,marginTop:4}},item.workspaceTitle||'旧记录：未记录工作区'),
      item.currentlyRunning?h('div',{role:'status',style:{fontSize:12,marginTop:4}},'当前有新任务运行，本条记录对应较早的结束'):null),
    h('td',{style:{padding:10,minWidth:140}},OUTCOMES[item.outcome]??'原因未知',h('div',{style:{fontSize:12,marginTop:4}},stateLabels[item.readState]),
      item.silenced?h('div',{style:{fontSize:12,marginTop:4}},'静默收录'):null),
    h('td',{style:{padding:10,whiteSpace:'nowrap'}},timeText(item.endedAt),h('div',{style:{fontSize:12,marginTop:4}},'历时：'+formatDuration(item.durationMs))),
    h('td',{style:{padding:10}},h('button',{type:'button',style:control,disabled:busy||!enabled||item.readState==='retired',onClick:()=>onOpen(item.id),
      'aria-label':'返回对话：'+item.displayTitle},busy?'正在返回…':item.readState==='retired'?'不可打开':'返回原对话')));
}
export function NotificationCenter(){
  const [filters,setFilters]=React.useState({state:'unread',period:'all',outcome:'all',workspace:'all'}),[offset,setOffset]=React.useState(0),[refresh,setRefresh]=React.useState(0);
  const [data,setData]=React.useState(null),[loading,setLoading]=React.useState(true),[message,setMessage]=React.useState(''),[opening,setOpening]=React.useState(null);
  const mounted=React.useRef(true),revision=React.useRef(null),prefix=React.useId();
  React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  React.useEffect(()=>{
    const abort=new AbortController();let live=true;setLoading(true);
    const query=new URLSearchParams({...filters,offset:String(offset),limit:'25'});if(offset>0&&revision.current!==null)query.set('revision',String(revision.current));
    void fetch(base+'/notifications?'+query,{credentials:'same-origin',cache:'no-store',signal:abort.signal}).then(async r=>{
      const value=await r.json();if(!live)return;if(r.status===409){setOffset(0);setMessage('记录已变化，已返回第一页。');return;}if(!r.ok)throw new Error(value.error??'STATE_UNAVAILABLE');
      revision.current=value.revision;setData(value);
    }).catch(e=>{if(live&&!abort.signal.aborted)setMessage('通知读取失败：'+(e.message??'STATE_UNAVAILABLE'));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;abort.abort();};
  },[filters,offset,refresh]);
  React.useEffect(()=>{
    const update=()=>{if(document.visibilityState==='visible'&&offset===0)setRefresh(n=>n+1);};
    const timer=setInterval(update,15000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);};
  },[offset]);
  const choose=(key,value)=>{setFilters(f=>({...f,[key]:value}));setOffset(0);setMessage('');};
  const open=async completionId=>{
    setOpening(completionId);setMessage('正在返回原对话…');
    try{const clientId=await prepareClient();if(!clientId)throw new Error('窗口连接尚未就绪，请稍后重试');
      const r=await fetch(base+'/notifications/open',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({clientId,completionId})});
      const result=await r.json();if(!r.ok)throw new Error(result.error??'NAVIGATION_UNCONFIRMED');if(mounted.current){setMessage('已返回原对话。');setRefresh(n=>n+1);}
    }catch(e){if(mounted.current)setMessage('返回失败：'+e.message+'；未提前确认新记录。');}
    finally{if(mounted.current)setOpening(null);}
  };
  const select=(key,label,options)=>h('label',{htmlFor:prefix+key,style:{display:'flex',flexDirection:'column',gap:4,fontSize:12}},label,
    h('select',{id:prefix+key,value:filters[key],style:control,onChange:e=>choose(key,e.currentTarget.value)},options.map(([v,t])=>h('option',{key:v,value:v},t))));
  return h('section',{'aria-label':'结束通知中心',style:{marginTop:16}},
    h('h4',null,'通知中心'),h('p',null,'每次结束独立保留；浏览列表不会标记已查看。通过原对话的实际呈现确认后，计数才会减少。'),
    data?h('p',{role:'status'},'待查看对话 '+data.count+' 个；'+(!data.enabled?'提醒已停用。':data.quiet.active?'静默中，结束记录继续收录。':'正常提醒。')+(!data.durable?' 状态尚未确认写入磁盘。':'')):null,
    h('div',{style:{display:'flex',flexWrap:'wrap',gap:10,alignItems:'end'}},
      select('state','查看状态',[['unread','未查看'],['acknowledged','已查看'],['retired','已退休'],['all','全部']]),
      select('period','结束时间',[['all','全部时间'],['today','今天'],['7d','最近7天'],['30d','最近30天']]),
      select('outcome','结束状态',[['all','全部结束状态'],...Object.entries(OUTCOMES)]),
      select('workspace','工作区',[['all','全部工作区'],...(data?.workspaces??[]).map(w=>[w.id,w.title])]),
      h('button',{type:'button',style:control,onClick:()=>{setOffset(0);setRefresh(n=>n+1);},disabled:loading},loading?'正在读取…':'刷新')),
    h('p',{'aria-live':'polite'},message),
    data?.items.length?h('div',{style:{overflowX:'auto'}},h('table',{style:{borderCollapse:'collapse',width:'100%',fontSize:13}},
      h('thead',null,h('tr',null,...['对话与工作区','结束状态','时间与历时','操作'].map(t=>h('th',{key:t,scope:'col',style:{textAlign:'left',padding:10,borderBottom:'1px solid #8b95a555'}},t)))),
      h('tbody',null,...data.items.map(item=>h(NotificationRow,{key:item.id,item,enabled:data.enabled,busy:opening===item.id,onOpen:open}))))):
      !loading?h('p',{role:'status'},'没有符合条件的结束记录。'):null,
    data?h('div',{style:{display:'flex',alignItems:'center',gap:12,marginTop:12}},
      h('button',{type:'button',style:control,disabled:loading||offset===0,onClick:()=>setOffset(n=>Math.max(0,n-25))},'上一页'),
      h('span',null,'第 '+(Math.floor(offset/25)+1)+' 页，共 '+data.total+' 条'),
      h('button',{type:'button',style:control,disabled:loading||!data.hasMore,onClick:()=>setOffset(n=>n+25)},'下一页')):null,
    h('p',{style:{fontSize:12,marginTop:12}},'保留全部未查看记录和最近500条已查看/已退休历史；仍在展示队列中的记录暂不清理。旧记录没有工作区或历时时显示未知。'));
}
