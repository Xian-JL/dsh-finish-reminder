import * as React from 'react';
import {mountNavigation} from './navigation.mjs';
import {NotificationCenter} from './center.mjs';
import {QuietSettings} from './quiet.mjs';
import {decodeSettings,VERSION} from '../shared/contracts.mjs';
export const inject=['slots','configForms','uiWorkspace','sessions','layout'];
const h=React.createElement,endpoint='/api/dsh-finish-reminder/status';
function readable(s){if(s?.status!=='ready'||!s.value)return false;try{decodeSettings(s.value);return true;}catch{return false;}}
export function Settings({form}){
  const snapshot=React.useSyncExternalStore(React.useCallback(f=>form.subscribe(f),[form]),React.useCallback(()=>form.getSnapshot(),[form]));
  const [tab,setTab]=React.useState('center'),[status,setStatus]=React.useState(null),[message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false);
  const epoch=React.useRef(0),id=React.useId(),ready=readable(snapshot),settings=ready?decodeSettings(snapshot.value):null;
  const refresh=React.useCallback(async(signal)=>{const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',signal});if(!r.ok)throw new Error('状态读取失败');return await r.json();},[]);
  React.useEffect(()=>{const abort=new AbortController(),current=++epoch.current;
    refresh(abort.signal).then(s=>{if(current===epoch.current)setStatus(s);}).catch(()=>{if(!abort.signal.aborted)setMessage('状态读取失败，请稍后刷新。');});
    return()=>{++epoch.current;abort.abort();};
  },[form,refresh]);
  const save=async patch=>{const current=epoch.current;setBusy(true);setMessage('正在保存…');
    try{if(!ready||snapshot.writable!==true)throw new Error('配置不可写');decodeSettings({...snapshot.value,...patch});
      if(await form.mutate(Object.entries(patch).map(([key,value])=>({op:'set',path:[key],value})))!==true)throw new Error('宿主未确认保存');
      if(current===epoch.current){setMessage('设置已保存。');const latest=await refresh();if(current===epoch.current)setStatus(latest);}
    }catch{if(current===epoch.current)setMessage('保存未确认，请检查设置和状态后重试。');}
    finally{if(current===epoch.current)setBusy(false);}
  };
  const labels={initializing:'正在初始化',supported:'运行正常',faulted:'存在故障','popup-only':'仅弹窗可用','badge-unavailable':'角标不可用','navigation-unavailable':'返回对话不可用'};
  const writable=ready&&snapshot.writable===true&&!busy;
  return h('section',{'aria-label':'对话结束提醒',style:{maxWidth:980,padding:16,fontSize:14}},
    h('h3',null,'对话结束提醒 ',h('small',{style:{fontWeight:400,fontSize:12}},VERSION)),
    h('p',null,'每次结束独立记录。关闭或到期只收起弹窗，不清除未查看记录。'),
    h('div',{role:'tablist','aria-label':'结束提醒页面',style:{display:'flex',gap:8,flexWrap:'wrap'}},
      ...[['center','通知中心'],['quiet','静默设置'],['settings','运行设置']].map(([key,label])=>h('button',{key,id:id+key,role:'tab',type:'button','aria-selected':tab===key,'aria-controls':id+'panel',
        onClick:()=>setTab(key),style:{font:'inherit',padding:'7px 14px',borderRadius:7,fontWeight:tab===key?600:400}},label))),
    h('div',{id:id+'panel',role:'tabpanel','aria-labelledby':id+tab},
      tab==='center'?h(NotificationCenter):tab==='quiet'?(settings?h(QuietSettings,{settings,writable,save}):h('p',null,'正在读取配置…')):
      h('section',{'aria-label':'运行设置'},h('h4',null,'运行设置'),
        ...Object.entries({enabled:'启用结束提醒',diagnosticsEnabled:'开启脱敏诊断'}).map(([key,label])=>h('p',{key},h('label',{htmlFor:id+key},
          h('input',{id:id+key,type:'checkbox',checked:settings?.[key]??false,disabled:!writable,onChange:e=>void save({[key]:e.currentTarget.checked})}),' '+label))),
        h('p',{role:'status'},status?(status.enabled?'已启用；':'已停用；')+(labels[status.status]??status.status)+'；本Profile待查看：'+(status.count??'未知')+'；任务栏汇总：'+(status.aggregateCount??'未知')+'；排队：'+status.queued:'正在读取状态…'),
        ...['error','eventError','badgeError','navigationError'].filter(key=>status?.[key]).map(key=>h('p',{key,role:'alert'},status[key])),
        h('button',{type:'button',disabled:busy,onClick:()=>void refresh().then(s=>setStatus(s)).catch(()=>setMessage('状态刷新失败。'))},'刷新状态'))),
    h('p',{'aria-live':'polite'},message));
}
export function apply(ctx){
  const form=ctx.get('configForms').get('dsh-finish-reminder');
  ctx.effect(()=>{let stop=null;const reconcile=()=>{const s=form.getSnapshot(),enabled=readable(s)&&decodeSettings(s.value).enabled;
    if(enabled&&!stop)stop=mountNavigation(ctx);else if(!enabled&&stop){stop();stop=null;}};
    const unsubscribe=form.subscribe(reconcile);reconcile();return()=>{unsubscribe();stop?.();};
  });
  if(typeof window!=='undefined'&&typeof window.matchMedia==='function')ctx.effect(()=>{
    const media=window.matchMedia('(prefers-color-scheme: dark)'),abort=new AbortController();
    const send=()=>fetch('/api/dsh-finish-reminder/theme',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({dark:media.matches}),signal:abort.signal}).catch(()=>{});
    void send();media.addEventListener('change',send);return()=>{media.removeEventListener('change',send);abort.abort();};
  });
  ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'dsh-finish-reminder-settings',order:66,label:()=> '对话结束提醒',inject:()=>({form})},Settings));
}
