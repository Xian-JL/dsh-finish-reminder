import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const hwnd=process.argv[2];if(!/^\d+$/.test(hwnd??''))throw new Error('Supply a verified, observed isolated DSH HWND.');
const framework=join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319'),output=join(root,'.verification/TaskbarProbe.exe');
await mkdir(join(root,'.verification'),{recursive:true});
await run(join(framework,'csc.exe'),['/nologo','/target:exe','/platform:x64','/out:'+output,
  ...['System.dll','System.Core.dll','System.Web.Extensions.dll','WPF/WindowsBase.dll','WPF/UIAutomationClient.dll','WPF/UIAutomationTypes.dll'].map(x=>'/reference:'+join(framework,x)),join(root,'helper/TaskbarProbe.cs')],{windowsHide:true});
const result=await run(output,[hwnd],{windowsHide:true,timeout:5000,maxBuffer:8192});
const receipt=JSON.parse(result.stdout.trim());await writeFile(join(root,'.verification/taskbar-probe.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
