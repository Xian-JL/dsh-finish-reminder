import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,mkdir} from 'node:fs/promises';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import {VERSION} from '../src/shared/contracts.mjs';import {DSH_ENGINE_RANGE} from '../src/shared/compatibility.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const npm=process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const {stdout}=await promisify(execFile)(process.execPath,[npm,'pack','--dry-run','--json','--ignore-scripts'],{cwd:root,windowsHide:true,maxBuffer:262144});
const pack=JSON.parse(stdout)[0];const paths=pack.files.map(x=>x.path);
for(const required of ['lib/index.js','lib/client.js','lib/build-binding.json','native/Reminder.exe','native/Reminder.exe.manifest','README.md','LICENSE','cordis.patch.yml','package.json'])assert.ok(paths.includes(required),'Missing runtime file: '+required);
for(const p of paths)assert.ok(!/(?:^|\/)(?:\.verification|tests|scripts|src|helper|node_modules|artifacts)(?:\/|$)|credentials|\.env(?:$|\.)/i.test(p),'Unexpected private/development file: '+p);
const pkg=JSON.parse(await readFile(join(root,'package.json')));
assert.equal(pkg.version,VERSION);assert.equal(pkg.dsh.manifestVersion,1);assert.equal(pkg.dsh.bundle.patch,'./cordis.patch.yml');
assert.equal(pkg.engines.dsh,DSH_ENGINE_RANGE);
for(const f of ['lib/index.js','lib/client.js','lib/build-binding.json','README.md']){
  const text=await readFile(join(root,f),'utf8');
  assert.ok(!/[A-Z]:[\\/]Codex_workspace|[A-Z]:[\\/]Users[\\/]|[?&]token=[A-Za-z0-9_-]{12}/i.test(text),'Private path/token in package');
}
const pe=await readFile(join(root,'native/Reminder.exe'));assert.equal(pe.subarray(0,2).toString(),'MZ');assert.equal(pe.readUInt16LE(pe.readInt32LE(0x3c)+4),0x8664);
assert.ok((await readFile(join(root,'lib/client.js'),'utf8')).startsWith('window.__ModuleLoader__.load('));
assert.match(await readFile(join(root,'lib/index.js'),'utf8'),/BADGE_PLACEMENT_UNSUPPORTED/);
await mkdir(join(root,'.verification'),{recursive:true});
console.log(JSON.stringify({status:'PASS',scope:'npm dry-run file allowlist, exports/manifest and x64 native image; not full Desktop acceptance',files:paths.length,unpackedBytes:pack.unpackedSize}));
