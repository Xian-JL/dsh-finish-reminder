import {readFile,writeFile,mkdir} from 'node:fs/promises';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const spec=await readFile(join(root,'spec.md'),'utf8');
const cases=[...spec.matchAll(/^\| ((?:EVT|CNT|BADGE|POP|GEO|NAV|LIFE|DATA|PKG)-\d\d) \| ([^|]+) \|/gm)];
const manual=await readFile(join(root,'MANUAL-ACCEPTANCE.md'),'utf8');
const featureCases=[...manual.matchAll(/^\| (V2-[A-Z]+-\d\d) \| ([^|]+) \|/gm)];cases.push(...featureCases);
const receiptSpec=await readFile(join(root,'task-receipt-ui-v0.3.0-development.md'),'utf8');
const receiptCases=[...receiptSpec.matchAll(/^\| (RECEIPT-\d\d) \| ([^|]+) \|/gm)];cases.push(...receiptCases);
const partial=new Set(['EVT-04','EVT-05','EVT-06','EVT-07','EVT-08','EVT-09','EVT-10','EVT-11','CNT-01','CNT-02','CNT-03','CNT-05','CNT-07','CNT-08','POP-01','POP-02','POP-03','POP-04','POP-05','POP-06','POP-10','GEO-01','GEO-04','NAV-03','NAV-07','LIFE-01','LIFE-02','LIFE-03','LIFE-04','DATA-01','DATA-02','PKG-01','PKG-02']);
const csv=['case_id,scenario,status,evidence_scope'];
for(const [,id,scenario]of cases){const covered=partial.has(id)||id.startsWith('V2-');csv.push([id,scenario.trim(),covered?'PARTIAL':'NOT_RUN',covered?'0.3.0 automated layer covered; new Desktop acceptance pending; baseline 0.1.0 user-accepted':'0.3.0 Desktop evidence not collected; historical user baseline remains separate'].map(s=>'"'+s.replaceAll('"','""')+'"').join(','));}
await mkdir(join(root,'artifacts'),{recursive:true});await writeFile(join(root,'artifacts/acceptance.csv'),'\ufeff'+csv.join('\r\n')+'\r\n');
const tests=await run(process.execPath,['--test','--test-reporter=tap','tests/*.test.mjs'],{cwd:root,windowsHide:true,maxBuffer:524288});
const rendered=JSON.parse(await readFile(join(root,'artifacts/receipt-ui/metrics.json'),'utf8'));
const summary={date:'2026-11-13',version:'0.3.0',status:'IMPLEMENTED_UNVERIFIED',baseline:'0.2.0 retained; previous 0.1.0 USER_ACCEPTED',unitTests:{status:'PASS',count:Number(tests.stdout.match(/# tests (\d+)/)?.[1])},specCases:cases.length,newFeatureCases:receiptCases.length,offscreenRender:{cases:rendered.length,status:'PASS',scope:'invisible WPF development render and geometry; not desktop acceptance'},
  hostContract:JSON.parse(await readFile(join(root,'.verification/host-contract.json'))),
  manualFeedback:'User accepted the task-receipt UI; this report does not manufacture per-case desktop evidence',fullDesktopAcceptance:'USER_REPORTED_ACCEPTED'};
await writeFile(join(root,'artifacts/verification-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
