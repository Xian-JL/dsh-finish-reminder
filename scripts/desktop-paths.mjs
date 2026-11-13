import {existsSync} from 'node:fs';import {join,dirname,resolve} from 'node:path';
/** Resolve the user's installation without embedding a developer-specific drive or account path. */
export function desktopInstall(explicit){
  const executable=process.env.DSH_REMINDER_TEST_EXE??process.env.DSH_DESKTOP_NODE_EXECUTABLE;
  const candidates=[explicit,process.env.DSH_REMINDER_TEST_INSTALL,executable?dirname(executable):null,
    process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Programs','DeepSeek Harness'):null,
    process.env.ProgramFiles?join(process.env.ProgramFiles,'DeepSeek Harness'):null];
  for(const candidate of candidates)if(candidate&&existsSync(join(resolve(candidate),'DeepSeek Harness.exe')))return resolve(candidate);
  throw new Error('Desktop installation not found. Set DSH_REMINDER_TEST_INSTALL or pass --install-dir.');
}
