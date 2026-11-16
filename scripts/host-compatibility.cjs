// Runs in Desktop's Node mode. Reads shipped code and creates detached synthetic sessions only.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
async function main(){
  const install=process.argv[2],base=path.join(install,'resources/app.asar/dsh/node_modules');
  const requireSdk=createRequire(path.join(base,'@deepseek-ai/dsh/package.json')),semver=requireSdk('semver');
  const hostVersion=requireSdk('@deepseek-ai/dsh/package.json').version;
  const pluginRoot=process.env.DSH_REMINDER_PLUGIN_ENTRY?path.dirname(path.dirname(process.env.DSH_REMINDER_PLUGIN_ENTRY)):path.join(__dirname,'..');
  const manifest=JSON.parse(await fs.readFile(path.join(pluginRoot,'package.json'),'utf8'));
  assert.equal(semver.satisfies(hostVersion,manifest.engines.dsh),true,'Installed host must satisfy the distributed manifest');
  for(const version of ['0.2.2-rc.1','0.2.2-rc.3'])assert.equal(semver.satisfies(version,manifest.engines.dsh),true);
  for(const version of ['0.2.2-rc.2','0.2.2-rc.4','0.2.2','0.3.0'])assert.equal(semver.satisfies(version,manifest.engines.dsh),false,'Unreviewed host must stay excluded');
  const files={loop:'@deepseek-ai/dsh-agent-loop/lib/index.js',session:'@deepseek-ai/dsh-session/lib/index.js',workspace:'@deepseek-ai/dsh-client-ui-workspace/lib/client.js',clientSession:'@deepseek-ai/dsh-api-session-controller/lib/client.js'},sources={},fingerprints={};
  for(const [key,file]of Object.entries(files)){sources[key]=await fs.readFile(path.join(base,file),'utf8');fingerprints[key]=createHash('sha256').update(sources[key]).digest('hex');}
  const checks={rootIdle:/async\s+whenIdle\(\)/.test(sources.loop),claim:/agent\/inbox\/claimed/.test(sources.loop),
    terminal:/append\(["'`]turn\/end["'`]/.test(sources.loop),liveBoundary:/firstLiveSeq/.test(sources.session)&&/isOwnSeq\(seq\)/.test(sources.session),
    nativeNavigation:/openSession\(target\)/.test(sources.workspace)&&/replaceMain\(target\s*,\s*signal/.test(sources.workspace),
    mainView:/retainedBy/.test(sources.clientSession)&&/binding\(id\)/.test(sources.clientSession)&&/mainView/.test(sources.workspace),
    visibleEnvelope:/eventSource/.test(sources.clientSession)&&/loadThrough\(/.test(sources.clientSession)};
  assert.ok(Object.values(checks).every(Boolean),'Missing source seams: '+Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name).join(', '));
  const {Session}=await import(pathToFileURL(path.join(base,'@deepseek-ai/dsh-session/lib/index.js')));
  const {EventAdapter}=await import(pathToFileURL(path.join(__dirname,'../src/host/events.mjs')));
  const session=Session.create('compatibility-fixture'),events=[],facts=[];
  const agent={id:session.id,session,status:'running',inbox:{hasPending:false},whenIdle:async()=>{}};
  const adapter=new EventAdapter({agents:{get:id=>id===agent.id?agent:null},identity:s=>({conversation:{desktopAppGroupId:'fixture',hostInstanceId:'fixture',profileId:'fixture',sessionId:s.id},streamEpoch:String(s.header.createdAt)}),onFact:r=>facts.push(r)});
  for(const [type,data]of [['turn/start',{turn:1}],['step/start',{turn:1,step:1}],['step/end',{turn:1,step:1}],['turn/end',{turn:1,reason:{kind:'completed'}}]]){
    const e=session.append(type,data);events.push(e);adapter.accept(session,e);
  }
  agent.status='idle';await new Promise(r=>setImmediate(r));assert.equal(facts.length,1);assert.equal(facts[0].outcome,'ended');
  const restored=Session.create('compatibility-restored',events);for(const e of events)adapter.accept(restored,e);assert.equal(facts.length,1);adapter.dispose();
  const result={status:'PASS',hostVersion,pluginVersion:manifest.version,engineRange:manifest.engines.dsh,checks,sdkSessionEnd:true,restoredHistoryIgnored:true,fingerprints,
    scope:'actual shipped Session and semver with synthetic root agent; source seam checks; no real model/UI task'};
  await fs.mkdir(path.join(__dirname,'../.verification'),{recursive:true});await fs.writeFile(path.join(__dirname,'../.verification/host-compatibility.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
