import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {desktopInstall} from './desktop-paths.mjs';
const install=desktopInstall();const result=await promisify(execFile)(join(install,'DeepSeek Harness.exe'),
  [fileURLToPath(new URL('./host-compatibility.cjs',import.meta.url)),install],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,maxBuffer:16384});
console.log(result.stdout.trim());if(result.stderr.trim())console.error(result.stderr.trim());
