const path=require('node:path');const {pathToFileURL}=require('node:url');const fs=require('node:fs/promises');const os=require('node:os');const assert=require('node:assert/strict');const {createRequire}=require('node:module');
async function main(){
  const sdk=path.join(process.argv[2],'resources/app.asar/dsh/node_modules/@deepseek-ai');
  const cordis=await import(pathToFileURL(path.join(sdk,'cordis/lib/index.js')));
  const {updateVolatile}=await import(pathToFileURL(path.join(sdk,'cosmokit/lib/index.js')));
  const Context=cordis.Context??cordis.default,ctx=new Context();const routes=new Map();
  const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-reminder-host-'));
  try {
    for(const [key,value]of Object.entries({agents:{get:()=>null},sessions:{},profileContext:{dir:fixture,name:'reminder-fixture'},connection:{fetch:{register:route=>{assert.ok(!routes.has(route.path));routes.set(route.path,route);return()=>routes.delete(route.path);}}}})){
      ctx.provide(key);ctx.set(key,value);
    }
    const entry=process.env.DSH_REMINDER_PLUGIN_ENTRY??path.join(__dirname,'../lib/index.js');
    const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(entry),'../package.json'),'utf8'));
    const requireSdk=createRequire(path.join(sdk,'dsh/package.json')),hostVersion=requireSdk('./package.json').version;
    assert.equal(requireSdk('semver').satisfies(hostVersion,manifest.engines.dsh),true,'Distributed package must accept the installed host');
    const mod=await import(pathToFileURL(entry));
    const handle=ctx.plugin(mod,{enabled:false});await handle;
    const statusRoute=routes.get('/api/dsh-finish-reminder/status');assert.ok(statusRoute);
    const status=await(await statusRoute.fetch(new Request('http://fixture/api/dsh-finish-reminder/status'))).json();
    assert.equal(status.enabled,false);assert.equal(status.count,0);assert.notEqual(status.status,'supported');assert.equal(status.acceptance,'USER_PENDING');
    assert.ok(typeof handle.effectiveConfig.enabled.get==='function');
    assert.equal(handle.effectiveConfig.quietUntil.get(),0);assert.equal(handle.effectiveConfig.quietScheduleEnabled.get(),false);assert.equal(handle.effectiveConfig.quietStart.get(),'22:00');
    const centerRoute=routes.get('/api/dsh-finish-reminder/notifications');assert.ok(centerRoute);
    const center=await(await centerRoute.fetch(new Request('http://fixture/api/dsh-finish-reminder/notifications?state=all'))).json();
    assert.equal(center.total,0);assert.equal(center.historyLimit,500);assert.equal(center.quiet.active,false);assert.ok(routes.has('/api/dsh-finish-reminder/notifications/open'));
    // Changing diagnostics must not create tools, start a model, or duplicate routes.
    for(let i=0;i<20;i++){
      const resolved=cordis.resolveConfig(mod,{enabled:false,diagnosticsEnabled:i%2===0});
      updateVolatile(handle.effectiveConfig.diagnosticsEnabled,resolved.diagnosticsEnabled);handle.ctx.emit('loader/volatile-update',[['diagnosticsEnabled']]);
      await new Promise(r=>setTimeout(r,1));assert.equal(routes.size,11);
    }
    await handle.dispose();assert.equal(routes.size,0);await ctx.fiber.dispose();
    const out=path.join(__dirname,'../.verification');await fs.mkdir(out,{recursive:true});
    const result={status:'PASS',hostVersion,pluginVersion:manifest.version,engineCompatible:true,scope:'actual packaged Cordis/config lifecycle; synthetic agents/profile/connection, not a running Desktop task',volatileUpdates:20,routeCleanup:true,modelToolsRegistered:false,desktopStarted:false};
    await fs.writeFile(path.join(out,'host-contract.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await ctx.fiber.dispose().catch(()=>{});await fs.rm(fixture,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
