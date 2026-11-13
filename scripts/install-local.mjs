// Explicit user-run installation; build/verify never change the real Profile.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {desktopInstall} from './desktop-paths.mjs';
const args=process.argv.slice(2),root=fileURLToPath(new URL('../',import.meta.url));
if(args.includes('--help')){console.log('node scripts/install-local.mjs [--install-dir <Desktop directory>] [--profile desktop]');process.exit(0);}
const option=(name,fallback)=>{const index=args.indexOf(name);if(index<0)return fallback;if(!args[index+1]||args[index+1].startsWith('--'))throw new Error('Missing option value');return args[index+1];};
const install=desktopInstall(option('--install-dir',undefined)),profile=option('--profile','desktop');
if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profile))throw new Error('Invalid Profile name');
const publicArchive=join(root,'dist/dsh-finish-reminder-0.3.0.tgz');
const archive=await access(publicArchive).then(()=>publicArchive).catch(()=>join(root,'artifacts/dsh-finish-reminder-0.3.0.tgz')),exe=join(install,'DeepSeek Harness.exe');await access(exe);
const actual=createHash('sha256').update(await readFile(archive)).digest('hex');
if((await readFile(archive+'.sha256','utf8')).split(/\s+/)[0]!==actual)throw new Error('Package SHA256 does not match the receipt');
console.log('Installing dsh-finish-reminder 0.3.0 into Profile '+profile+'. This updates its plugin configuration.');
const carrier=join(install,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
const result=await promisify(execFile)(exe,['--expose-internals',carrier,'plugin','--profile',profile,'add',archive],
  {windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:180000,maxBuffer:1048576});
if(result.stdout.trim())console.log(result.stdout.trim());if(result.stderr.trim())console.error(result.stderr.trim());
const profileDir=join(resolve(process.env.DSH_HOME??join(homedir(),'.dsh')),'profiles',profile);
const installed=JSON.parse(await readFile(join(profileDir,'node_modules/dsh-finish-reminder/package.json'),'utf8'));
const configuration=JSON.parse(await readFile(join(profileDir,'package.json'),'utf8'));
if(installed.version!=='0.3.0')throw new Error('Installation exited but the expected plugin version was not found');
console.log(JSON.stringify({installed:true,version:installed.version,profile,bundleEnabled:configuration.dsh?.profile?.bundles?.includes('dsh-finish-reminder')===true}));
