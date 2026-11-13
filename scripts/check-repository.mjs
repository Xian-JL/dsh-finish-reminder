import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=(await promisify(execFile)('git',['ls-files','-z'],{cwd:root,windowsHide:true,maxBuffer:1048576})).stdout.split('\0').filter(Boolean);
const rules=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token',/\b(?:gh[opusr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['api-key',/\bsk-[A-Za-z0-9_-]{24,}\b/],
  ['authentication-url',/[?&](?:token|access_token|api_key)=[A-Za-z0-9_-]{20,}/i]
];
const problems=[];
for(const file of files){
  if(/(?:^|\/)(?:\.verification|node_modules|artifacts)(?:\/|$)|(?:^|\/)(?:\.credentials[^/]*|\.env(?:\..*)?)$/i.test(file)&&!file.endsWith('.env.example'))problems.push({file,rule:'private-file'});
  if(/\.(?:tgz|png)$/.test(file))continue;
  const bytes=await readFile(join(root,file)),texts=file.endsWith('.exe')?[bytes.toString('utf8'),bytes.toString('utf16le')]:[bytes.toString('utf8')];
  for(const [rule,pattern]of rules)if(texts.some(text=>pattern.test(text)))problems.push({file,rule});
}
if(problems.length){console.error(JSON.stringify({status:'FAIL',problems}));process.exitCode=1;}else console.log(JSON.stringify({status:'PASS',trackedFiles:files.length,secretPatterns:rules.length,privateFilesExcluded:true}));
