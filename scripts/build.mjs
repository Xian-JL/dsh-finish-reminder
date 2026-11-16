import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const theme=JSON.parse(await readFile(join(root,'assets/receipt-theme.json'),'utf8')),names=Object.keys(theme.light);
for(const mode of ['light','dark'])for(const name of names)if(!/^#[0-9A-F]{6}$/i.test(theme[mode]?.[name]))throw new Error('Invalid receipt palette');
await writeFile(join(root,'helper/ReceiptTheme.g.cs'),'// Generated from assets/receipt-theme.json.\nnamespace DshFinishReminder { static class ReceiptTheme {\n'+
  'public static readonly string[] Names=new string[]{'+names.map(JSON.stringify).join(',')+'};\n'+
  'public static readonly string[] Light=new string[]{'+names.map(n=>JSON.stringify(theme.light[n])).join(',')+'};\n'+
  'public static readonly string[] Dark=new string[]{'+names.map(n=>JSON.stringify(theme.dark[n])).join(',')+'};\n}}\n');
const hostContract=await readFile(join(root,'src/shared/contracts.mjs'),'utf8'),nativeSource=await readFile(join(root,'helper/Reminder.cs'),'utf8');
if(!hostContract.includes("VERSION = '"+pkg.version+"'")||!nativeSource.includes('{"version","'+pkg.version+'"}')||!nativeSource.includes('AssemblyVersion("'+pkg.version+'.0")'))throw new Error('Host/Client/Helper version mismatch');
await mkdir(join(root,'lib'),{recursive:true});await mkdir(join(root,'native'),{recursive:true});
await build({absWorkingDir:root,entryPoints:{index:'src/host/index.mjs'},outdir:'lib',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',define:{__REMINDER_PACKAGED__:'true'}});
const client=await build({absWorkingDir:root,entryPoints:['src/client/index.mjs'],write:false,bundle:true,platform:'browser',format:'cjs',target:'chrome140',external:['react']});
await writeFile(join(root,'lib/client.js'),'window.__ModuleLoader__.load({id:"dsh-finish-reminder",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n'+client.outputFiles[0].text+'\nreturn module.exports;}});\n');
const framework=join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319');
const refs=['System.dll','System.Core.dll','System.Drawing.dll','System.Xaml.dll','System.Web.Extensions.dll',...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll','UIAutomationTypes.dll','UIAutomationProvider.dll'].map(x=>'WPF/'+x)];
const native=await promisify(execFile)(join(framework,'csc.exe'),['/nologo','/target:exe','/platform:x64','/optimize+',
  '/out:'+join(root,'native/Reminder.exe'),'/win32manifest:'+join(root,'helper/Reminder.manifest'),
  ...refs.map(x=>'/reference:'+join(framework,x)),...['Reminder.cs','Desktop.cs','ReceiptPopup.cs','ReceiptTheme.g.cs'].map(x=>join(root,'helper',x))],{windowsHide:true,encoding:'utf8'}).catch(e=>{throw new Error(e.stdout||e.message);});
if(native.stdout.trim())console.log(native.stdout.trim());
await copyFile(join(root,'helper/Reminder.manifest'),join(root,'native/Reminder.exe.manifest'));
const files=['spec.md','task-receipt-ui-v0.3.0-development.md','assets/receipt-theme.json','lib/index.js','lib/client.js','native/Reminder.exe'];
const binding={packageVersion:JSON.parse(await readFile(join(root,'package.json'))).version,releaseStatus:'DEVELOPMENT_CHECKED',baseUiAcceptance:'0.3.0 USER_ACCEPTED',files:{},sourceFiles:{}};
for(const f of files)binding.files[f]=createHash('sha256').update(await readFile(join(root,f))).digest('hex');
async function sources(dir){const result=[];for(const item of await readdir(join(root,dir),{withFileTypes:true})){const path=dir+'/'+item.name;if(item.isDirectory())result.push(...await sources(path));else if(/\.(?:mjs|cjs|cs|manifest)$/.test(path))result.push(path);}return result;}
for(const file of [...await sources('src'),...await sources('helper'),...await sources('scripts'),'package.json','package-lock.json','cordis.patch.yml'].sort())binding.sourceFiles[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
binding.sourceDigest=createHash('sha256').update(JSON.stringify(binding.sourceFiles)).digest('hex');
await writeFile(join(root,'lib/build-binding.json'),JSON.stringify(binding,null,2)+'\n');
console.log('Built 0.3.1. Development checks and user feedback are recorded separately.');
