import {readFile,writeFile,mkdir} from 'node:fs/promises';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {join} from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import {layout} from '../src/shared/contracts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile),output=join(root,'artifacts/receipt-ui');await mkdir(output,{recursive:true});await mkdir(join(root,'.verification'),{recursive:true});
const base={cardId:'test-receipt',displayGeneration:1,receiptNumber:42,remainingFrontMs:6000,state:'front',outcome:'ended',displayTitle:'项目汇总与下一步安排',workspaceTitle:'工作区 · 项目A',durationMs:125000,endedAt:1794562200000,currentlyRunning:false};
const previews=[{cardId:'p1',displayTitle:'数据整理与核对',outcome:'stopped'},{cardId:'p2',displayTitle:'旧记录：缺少上下文',outcome:'unknown'}];
const definitions=[
  {name:'light',dark:false,dpi:144,previewCount:2},{name:'dark',dark:true,dpi:144,previewCount:2},
  {name:'long-error',dark:false,dpi:144,previewCount:2,front:{displayTitle:'中文标题与 Emoji 🧾🚀 以及 very long task title 需要安全省略而不是越过纸边',outcome:'error',error:'FOREGROUND_DENIED',currentlyRunning:true}},
  {name:'opening',dark:true,dpi:144,previewCount:0,front:{state:'opening'}},
  {name:'paused',dark:false,dpi:120,previewCount:1,front:{state:'paused',outcome:'limited',remainingFrontMs:3500}},
  {name:'large-type',dark:true,dpi:96,previewCount:2,textScale:2},
  {name:'high-contrast',dark:false,dpi:144,previewCount:2,highContrast:true},
  {name:'unknown-long-number',dark:false,dpi:192,previewCount:0,front:{workspaceTitle:'',durationMs:null,outcome:'unknown',receiptNumber:9007199254740991}},
  {name:'dpi100',dark:false,dpi:96,previewCount:0},{name:'dpi125',dark:false,dpi:120,previewCount:1},
  {name:'dpi150',dark:true,dpi:144,previewCount:2},{name:'dpi200',dark:true,dpi:192,previewCount:2},
  {name:'narrow',dark:false,dpi:96,previewCount:2,safe:{left:-348,top:0,right:0,bottom:600}}
  ,{name:'painting',dark:false,dpi:144,previewCount:0,front:{state:'painting',remainingFrontMs:10000}}
];
const cases=definitions.map(x=>({...x,textScale:x.textScale??1,highContrast:x.highContrast??false,safe:x.safe??{left:-1920,top:0,right:0,bottom:1040},queued:x.previewCount?4:1,
  front:{...base,...x.front},previews:previews.slice(0,x.previewCount)}));
const input=join(root,'.verification/receipt-preview-cases.json');await writeFile(input,JSON.stringify(cases));
const framework=join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319'),exe=join(root,'.verification/ReceiptPreview.exe');
const refs=['System.dll','System.Core.dll','System.Xaml.dll','System.Drawing.dll','System.Web.Extensions.dll',...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll','UIAutomationTypes.dll','UIAutomationProvider.dll'].map(x=>'WPF/'+x)];
await run(join(framework,'csc.exe'),['/nologo','/target:exe','/platform:x64','/main:DshFinishReminder.ReceiptPreview','/out:'+exe,
  ...refs.map(x=>'/reference:'+join(framework,x)),...['Reminder.cs','Desktop.cs','ReceiptPopup.cs','ReceiptTheme.g.cs','ReceiptPreview.cs'].map(x=>join(root,'helper',x))],{windowsHide:true}).catch(e=>{throw new Error(e.stdout||e.message);});
const rendered=await run(exe,[input,output],{windowsHide:true,timeout:30000});console.log(rendered.stdout.trim());
const metrics=JSON.parse(await readFile(join(output,'metrics.json'),'utf8'));
for(let i=0;i<cases.length;i++){
  const c=cases[i],g=layout(c.safe,c.dpi,c.previewCount,c.textScale),m=metrics[i];
  for(const key of ['left','top','width','height','cardWidth','cardHeight','previews','scale','textScale'])assert.equal(m.geometry[key],g[key],c.name+'/'+key);
  assert.equal(m.paperCenterIncluded,true);assert.equal(m.topCornerExcluded,true);assert.equal(m.toothGapExcluded,true);
  assert.ok(m.audit.context.length>0&&m.audit.time.length>0&&m.audit.fullReceiptLabel.includes(String(c.front.receiptNumber)));
  assert.ok(m.audit.titleHeight<=m.audit.titleLimit+0.1);assert.equal(m.audit.actualCornerHit,c.highContrast);
  assert.ok(Math.abs(m.audit.printWidth-(m.audit.trackWidth*(1-c.front.remainingFrontMs/10000)))<0.1);
  assert.equal(m.audit.returnEnabled,!['opening','painting'].includes(c.front.state));assert.equal(m.audit.closeEnabled,m.audit.returnEnabled);
}
console.log(JSON.stringify({status:'PASS',offscreenCases:cases.length,nativeGeometryMatchesJS:true,desktopAcceptance:'USER_PENDING'}));
