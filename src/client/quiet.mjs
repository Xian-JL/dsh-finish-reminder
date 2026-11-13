import * as React from 'react';import {validTime} from '../shared/contracts.mjs';
const h=React.createElement;
export function QuietSettings({settings,writable,save}){
  const [minutes,setMinutes]=React.useState(60),[start,setStart]=React.useState(settings.quietStart),[end,setEnd]=React.useState(settings.quietEnd),[days,setDays]=React.useState(settings.quietDays),[error,setError]=React.useState('');
  const [now,setNow]=React.useState(Date.now());
  React.useEffect(()=>{setStart(settings.quietStart);setEnd(settings.quietEnd);setDays(settings.quietDays);},[settings.quietStart,settings.quietEnd,settings.quietDays]);
  React.useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  const prefix=React.useId();
  const commit=()=>{if(!validTime(start)||!validTime(end)){setError('请选择有效的开始和结束时间。');return;}setError('');void save({quietStart:start,quietEnd:end,quietDays:days});};
  return h('section',{'aria-label':'免打扰与定时静默',style:{marginTop:20}},h('h4',null,'免打扰与定时静默'),
    h('p',null,'对当前Profile生效。静默仅撤下弹窗；结束记录和角标继续保留。解除后不补弹旧记录，可在通知中心查看。'),
    h('div',{style:{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}},
      h('label',{htmlFor:prefix+'duration'},'临时静默'),h('select',{id:prefix+'duration',value:minutes,disabled:!writable,onChange:e=>setMinutes(Number(e.currentTarget.value))},[15,30,60,120].map(n=>h('option',{key:n,value:n},n+'分钟'))),
      h('button',{type:'button',disabled:!writable,onClick:()=>void save({quietUntil:Date.now()+minutes*60000})},'开始静默'),
      h('button',{type:'button',disabled:!writable||settings.quietUntil<=now,onClick:()=>void save({quietUntil:0})},'取消临时静默')),
    settings.quietUntil>now?h('p',{role:'status'},'临时静默至 '+new Date(settings.quietUntil).toLocaleString('zh-CN',{hour12:false})+'；取消后若仍在排程时段，定时静默继续生效。'):null,
    h('p',null,h('label',{htmlFor:prefix+'enabled'},h('input',{id:prefix+'enabled',type:'checkbox',checked:settings.quietScheduleEnabled,disabled:!writable,onChange:e=>void save({quietScheduleEnabled:e.currentTarget.checked})}),' 启用定时静默')),
    h('div',{style:{display:'flex',gap:12,flexWrap:'wrap'}},
      h('label',{htmlFor:prefix+'start'},'开始 ',h('input',{id:prefix+'start',type:'time',value:start,disabled:!writable,onChange:e=>setStart(e.currentTarget.value)})),
      h('label',{htmlFor:prefix+'end'},'结束 ',h('input',{id:prefix+'end',type:'time',value:end,disabled:!writable,onChange:e=>setEnd(e.currentTarget.value)}))),
    h('fieldset',{disabled:!writable,style:{margin:'12px 0',padding:10}},h('legend',null,'重复日期'),
      ...[[1,'周一'],[2,'周二'],[3,'周三'],[4,'周四'],[5,'周五'],[6,'周六'],[0,'周日']].map(([day,label])=>h('label',{key:day,style:{marginRight:12,display:'inline-block'}},h('input',{type:'checkbox',checked:(days&(1<<day))!==0,onChange:e=>{const checked=e.currentTarget.checked;setDays(value=>checked?value|(1<<day):value&~(1<<day));}}),' '+label))),
    h('button',{type:'button',disabled:!writable,onClick:commit},'保存排程'),h('p',{role:'alert'},error),
    h('p',{style:{fontSize:12}},'使用系统本地时间。跨午夜的时段按开始日期计算；起止相同时为所选日期全天，未选日期则不执行定时静默。系统时区或时钟变化最多一分钟内重新计算。'));
}
