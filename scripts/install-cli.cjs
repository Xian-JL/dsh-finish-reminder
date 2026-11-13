const path=require('node:path');const {pathToFileURL}=require('node:url');
const [, ,install,profile,archive]=process.argv;
const entry=path.join(install,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
process.argv=[process.execPath,entry,'plugin','--profile',profile,'add',archive];
// Keep the wrapper for compatibility; execute the carrier as the main module.
require('node:module').runMain(entry);
