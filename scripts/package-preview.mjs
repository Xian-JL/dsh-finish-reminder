import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {desktopInstall} from './desktop-paths.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile),artifacts=join(root,process.env.DSH_REMINDER_PACKAGE_DIR??'dist');
const npm=process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
await run(process.execPath,[join(root,'scripts/check-package.mjs')],{cwd:root,windowsHide:true});await mkdir(artifacts,{recursive:true});
const {stdout}=await run(process.execPath,[npm,'pack','--json','--ignore-scripts','--pack-destination',artifacts],{cwd:root,windowsHide:true});
const item=JSON.parse(stdout)[0],archive=join(artifacts,item.filename),sha256=createHash('sha256').update(await readFile(archive)).digest('hex');
const entries=(await run('tar.exe',['-tzf',archive],{windowsHide:true})).stdout.trim().split(/\r?\n/);
for(const p of entries)assert.ok(p.startsWith('package/')&&!p.includes('..')&&!p.includes('\\')&&!/\.verification|credentials|node_modules/.test(p));
const target=resolve(root,'.verification','package-'+sha256.slice(0,16));
assert.ok(target.startsWith(resolve(root,'.verification')+ '\\'));await mkdir(target,{recursive:true});
await run('tar.exe',['-xzf',archive,'-C',target],{windowsHide:true});
const extracted=join(target,'package'),pkg=JSON.parse(await readFile(join(extracted,'package.json')));
assert.equal(pkg.version,JSON.parse(await readFile(join(root,'package.json'))).version);
const install=desktopInstall();
const receipt=await run(join(install,'DeepSeek Harness.exe'),[join(root,'scripts/host-contract.cjs'),install],
  {windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_REMINDER_PLUGIN_ENTRY:join(extracted,'lib/index.js')},timeout:30000,maxBuffer:262144});
const loaded=JSON.parse(receipt.stdout.trim());assert.equal(loaded.status,'PASS');
const result={package:item.filename,version:pkg.version,sha256,releaseStatus:'COMPATIBILITY_CHECKED',hostVersion:loaded.hostVersion,
  structure:'PASS',extractedCordisContract:'PASS',baseUiAcceptance:'0.3.0 USER_ACCEPTED',fullDesktopAcceptance:'USER_PENDING_RC3',sourceSpecBinding:JSON.parse(await readFile(join(extracted,'lib/build-binding.json')))};
await writeFile(join(artifacts,'preview-receipt.json'),JSON.stringify(result,null,2)+'\n');
await writeFile(join(artifacts,'receipt-v'+pkg.version+'.json'),JSON.stringify(result,null,2)+'\n');
await writeFile(archive+'.sha256',sha256+'  '+item.filename+'\n');
console.log(JSON.stringify({package:item.filename,sha256,hostVersion:loaded.hostVersion,structure:'PASS',extractedCordisContract:'PASS',releaseStatus:'COMPATIBILITY_CHECKED'}));
