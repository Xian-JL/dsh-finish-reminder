import {decodeSettings} from '../shared/contracts.mjs';
const minuteOf=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
/** Cross-midnight periods belong to their start weekday; equal endpoints mean the selected entire day. */
export function quietState(raw,now=new Date()){
  const settings=decodeSettings(raw),time=now.getTime(),minute=now.getHours()*60+now.getMinutes(),day=now.getDay();
  const start=minuteOf(settings.quietStart),end=minuteOf(settings.quietEnd),chosen=d=>(settings.quietDays&(1<<d))!==0;
  const scheduled=settings.quietScheduleEnabled&&(start===end?chosen(day):start<end?chosen(day)&&minute>=start&&minute<end:
    minute>=start?chosen(day):minute<end&&chosen((day+6)%7));
  const temporary=settings.quietUntil>time;
  return {active:temporary||scheduled,reason:temporary?'temporary':scheduled?'schedule':null,
    temporaryUntil:temporary?settings.quietUntil:null,scheduleEnabled:settings.quietScheduleEnabled,
    start:settings.quietStart,end:settings.quietEnd,days:settings.quietDays};
}
/** Re-evaluate precisely at expiry/minute boundaries; catch system clock/timezone changes within one minute. */
export function quietDelay(raw,now=Date.now()){
  const settings=decodeSettings(raw),until=settings.quietUntil-now;
  if(!settings.quietScheduleEnabled&&until<=0)return null;
  const minute=60000-(now%60000);
  return Math.max(1,Math.min(minute,until>0?until:Infinity));
}
