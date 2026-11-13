// Read-only source inventory, run in packaged Electron's Node mode.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = path.join(process.argv[2], 'resources', 'app.asar');
const out = path.resolve(__dirname, '../.verification/host');
fs.mkdirSync(out, { recursive: true });
const names=fs.readdirSync(path.join(base,'dsh/node_modules/@deepseek-ai')).filter(x=>/connection|workspace|host|fetch/.test(x));
fs.writeFileSync(path.join(out,'service-package-names.json'),JSON.stringify(names));
for(const name of names) {
  try {fs.writeFileSync(path.join(out,'dsh__node_modules__@deepseek-ai__'+name+'__lib__index.js'),fs.readFileSync(path.join(base,'dsh/node_modules/@deepseek-ai',name,'lib/index.js')));}catch{}
}
const packages = ['dsh-launch-environment','dsh-paths','dsh-plugin','dsh-settings','dsh-connection','dsh-web','dsh-api-host','dsh-session','dsh-agent','dsh-agent-loop','dsh-env','dsh-config','dsh-client-ui-session','dsh-client-ui-workspace','dsh-client-ui-settings','dsh-api-session-controller','dsh-host','dsh-client','dsh-client-config-forms','dsh-api','dsh'];
const files = ['lib/main.js', 'lib/preload-app.cjs', 'package.json'];
files.push('dsh/node_modules/@deepseek-ai/cordis/lib/index.js');
files.push('dsh/node_modules/@deepseek-ai/dsh-session-title/lib/index.js');
for(const name of ['dsh-workspace-registry','dsh-workspace','dsh-api-workspace-controller','dsh-session-query','dsh-session-persistence-jsonl'])files.push('dsh/node_modules/@deepseek-ai/'+name+'/lib/index.js');
for (const name of packages) for (const file of ['lib/index.js','lib/client.js','lib/index.d.ts','lib/client.d.ts','package.json']) files.push('dsh/node_modules/@deepseek-ai/'+name+'/'+file);
for (const name of ['dsh-session','dsh-agent','dsh-agent-loop','dsh-env','dsh-client-ui-session','dsh-client-ui-workspace']) {
  const dir = path.join(base,'dsh/node_modules/@deepseek-ai',name,'lib');
  try { for(const entry of fs.readdirSync(dir)) if (/\.js$/.test(entry)) files.push('dsh/node_modules/@deepseek-ai/'+name+'/lib/'+entry); } catch {}
}
const receipts = [];
for (const file of files) {
  try {
    const data = fs.readFileSync(path.join(base, file));
    const target = file.replaceAll('/', '__');
    fs.writeFileSync(path.join(out, target), data);
    receipts.push({ file, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
  } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; }
}
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify({ electron: process.versions.electron, node: process.versions.node, files: receipts }, null, 2));
console.log(JSON.stringify(receipts.map(r=>({file:r.file,bytes:r.bytes}))));
