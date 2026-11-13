import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
import {desktopInstall} from './desktop-paths.mjs';
const install=desktopInstall();
const r=await promisify(execFile)(join(install,'DeepSeek Harness.exe'),[fileURLToPath(new URL('./host-contract.cjs',import.meta.url)),install],
  {env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:30000,maxBuffer:262144});
console.log(r.stdout.trim());if(r.stderr.trim())console.error(r.stderr.trim());
