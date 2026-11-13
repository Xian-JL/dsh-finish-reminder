// Explicitly isolated Desktop discovery; never uses the user's real DSH_HOME/Profile.
import {spawn,execFile} from 'node:child_process';import {mkdir,open,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import {join} from 'node:path';
import {desktopInstall} from './desktop-paths.mjs';
const directory=fileURLToPath(new URL('../.verification/desktop-sandbox/',import.meta.url));
await mkdir(directory,{recursive:true});
const log=await open(join(directory,'desktop.log'),'a');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(?:KEY|TOKEN|PASSWORD|SECRET|ELECTRON_RUN_AS_NODE)/i.test(k)));
env.DSH_HOME=join(directory,'dsh-home');
const child=spawn(join(desktopInstall(),'DeepSeek Harness.exe'),
  ['--user-data-dir='+join(directory,'electron-data')],{env,windowsHide:!process.argv.includes('--interactive'),stdio:['ignore','pipe','pipe'],shell:false});
// Raw host output can contain its bootstrap authentication URL. Never echo or store that parameter.
const redact=chunk=>String(chunk).replace(/([?&](?:token|key|secret)=)[^\s&]+/gi,'[authentication omitted]');
let logging=Promise.resolve();
for(const stream of [child.stdout,child.stderr]) {
  let line='';stream.setEncoding('utf8');
  stream.on('data',chunk=>{line+=chunk;let at;while((at=line.indexOf('\n'))>=0){const safe=redact(line.slice(0,at+1));line=line.slice(at+1);logging=logging.then(()=>log.write(safe));}if(line.length>65536)line='[oversized host log line omitted]';});
  stream.on('end',()=>{if(line){const safe=redact(line);logging=logging.then(()=>log.write(safe));line='';}});
}
await writeFile(join(directory,'launch.json'),JSON.stringify({pid:child.pid,isolated:true,startedAt:new Date().toISOString()}));
console.log(JSON.stringify({pid:child.pid,isolated:true,timeoutMs:90000}));
const cleanup=setTimeout(()=>{
  // child.pid is the still-live exact process object, not a rediscovered or computed global target.
  if(child.exitCode===null&&!child.killed)execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
},90000);
child.on('error',e=>{console.error(e.code);process.exitCode=1;});
await new Promise(r=>child.once('exit',r));clearTimeout(cleanup);await logging;await log.close();
console.log('Isolated Desktop process exited.');
