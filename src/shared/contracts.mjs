export const VERSION = '0.3.0';
export const PROTOCOL = 1;
export const FRONT_MS = 10000;
export const MAX_TITLE = 160;
export const OUTCOMES = Object.freeze({
  ended: '对话任务已结束', error: '对话任务已结束（失败）', stopped: '对话任务已停止',
  interrupted: '对话任务已中断', limited: '本轮已结束（达到限制）', blocked: '本轮已结束（受阻）', unknown: '本轮已结束（原因未知）',
});
export class ReminderError extends Error {
  constructor(code) { super(code); this.name = 'ReminderError'; this.code = code; }
}
export const fail = code => { throw new ReminderError(code); };
export const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const safeInt = x => Number.isSafeInteger(x) && x >= 0;
export function boundedString(x, max=256) {
  return typeof x === 'string' && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/u.test(x);
}
export function keyOf(key) {
  if (!isObject(key)) fail('INVALID_IDENTITY');
  const values = ['desktopAppGroupId','hostInstanceId','profileId','sessionId'].map(k => key[k]);
  if (!values.every(x=>boundedString(x))) fail('INVALID_IDENTITY');
  return JSON.stringify(values);
}
export function completionId(fact) {
  if (!boundedString(fact.taskEpisodeId) || !safeInt(fact.terminalEventSeq) || !boundedString(fact.streamEpoch)) fail('INVALID_COMPLETION');
  return JSON.stringify([keyOf(fact.conversation), fact.streamEpoch, fact.taskEpisodeId, fact.terminalEventSeq]);
}
export function cleanTitle(title) {
  return Array.from(typeof title === 'string' ? title.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim() : '').slice(0, MAX_TITLE).join('') || '对话';
}
export function validateFact(fact) {
  const id = completionId(fact);
  if (!Object.hasOwn(OUTCOMES, fact.outcome) || !safeInt(fact.endedAt)) fail('INVALID_COMPLETION');
  if(fact.startedAt!=null&&!safeInt(fact.startedAt)||fact.durationMs!=null&&!safeInt(fact.durationMs)||fact.workspaceId!=null&&!boundedString(fact.workspaceId)||fact.workspaceTitle!=null&&typeof fact.workspaceTitle!=='string'||fact.silenced!=null&&typeof fact.silenced!=='boolean')fail('INVALID_COMPLETION');
  return { id, conversation: { ...fact.conversation }, taskEpisodeId: fact.taskEpisodeId, streamEpoch: fact.streamEpoch,
    terminalEventSeq: fact.terminalEventSeq, endedAt: fact.endedAt, outcome: fact.outcome, displayTitle: cleanTitle(fact.displayTitle),
    startedAt:fact.startedAt??null,durationMs:fact.durationMs??null,workspaceId:fact.workspaceId??null,
    workspaceTitle:typeof fact.workspaceTitle==='string'&&fact.workspaceTitle.trim()?Array.from(cleanTitle(fact.workspaceTitle)).slice(0,80).join(''):'',silenced:fact.silenced??false };
}
export function unreadCount(records) {
  return new Set(records.filter(r=>r.readState==='unread').map(r=>keyOf(r.conversation))).size;
}
export function decodeSettings(raw={}) {
  const read = key => typeof raw[key]?.get === 'function' ? raw[key].get() : raw[key];
  const enabled=read('enabled') ?? true, diagnosticsEnabled=read('diagnosticsEnabled') ?? false;
  if (typeof enabled !== 'boolean' || typeof diagnosticsEnabled !== 'boolean') fail('CONFIG_UNAVAILABLE');
  const quietScheduleEnabled=read('quietScheduleEnabled')??false,quietStart=read('quietStart')??'22:00',quietEnd=read('quietEnd')??'08:00',quietDays=read('quietDays')??127,quietUntil=read('quietUntil')??0;
  if(typeof quietScheduleEnabled!=='boolean'||!validTime(quietStart)||!validTime(quietEnd)||!safeInt(quietDays)||quietDays>127||!safeInt(quietUntil)||quietUntil>8640000000000000)fail('CONFIG_UNAVAILABLE');
  return {enabled,diagnosticsEnabled,quietScheduleEnabled,quietStart,quietEnd,quietDays,quietUntil};
}
export const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export function formatDuration(ms){
  if(!safeInt(ms))return '历时未知';
  if(ms<1000)return '不足1秒';
  const seconds=Math.floor(ms/1000);if(seconds<60)return seconds+'秒';
  const minutes=Math.floor(seconds/60);if(minutes<60)return minutes+'分'+(seconds%60?seconds%60+'秒':'');
  const hours=Math.floor(minutes/60);if(hours<24)return hours+'小时'+(minutes%60?minutes%60+'分':'');
  return Math.floor(hours/24)+'天'+(hours%24?hours%24+'小时':'');
}
export function capabilityStatus(c) {
  if (c.error || !c.events) return 'faulted';
  if (c.initializing) return 'initializing';
  if (!c.popup) return 'faulted';
  if (!c.navigation && !c.badge) return 'popup-only';
  if (!c.navigation) return 'navigation-unavailable';
  if (!c.badge) return 'badge-unavailable';
  return 'supported';
}
export function envelope(m, expected, maxBytes) {
  if (!isObject(m) || m.protocolVersion!==PROTOCOL || m.nonce!==expected.nonce || m.ownerInstance!==expected.ownerInstance ||
      m.generation!==expected.generation || !safeInt(m.revision) || !boundedString(m.requestId,80) || !boundedString(m.type,64) || !isObject(m.payload)) fail('PROTOCOL_ERROR');
  // Transport bounds bytes before decoding; this check protects in-process callers too.
  if (new TextEncoder().encode(JSON.stringify(m)).length > maxBytes) fail('PROTOCOL_ERROR');
  return m;
}
export function layout(safe, dpi=96, previews=2, textScale=1) {
  if (!safe || ![safe.left,safe.top,safe.right,safe.bottom,dpi,textScale].every(Number.isFinite) || dpi<96 || dpi>384 || textScale<1 || textScale>2.25) fail('DISPLAY_UNAVAILABLE');
  // Receipt 352x144 DIP; text enlargement grows the paper before previews are removed.
  const scale=dpi/96, width=Math.min(352,(safe.right-safe.left)/scale-48);
  const cardHeight=Math.ceil(144*textScale);
  let k=Math.min(2,Math.max(0,previews));
  while(k>0 && (cardHeight+16+k*42+32)*scale>safe.bottom-safe.top) k--;
  if (width<300 || (cardHeight+16+32)*scale>safe.bottom-safe.top) fail('DISPLAY_UNAVAILABLE');
  const w=width+16,h=cardHeight+16+k*42;
  return {left:Math.round(safe.right-(16+w)*scale),top:Math.round(safe.bottom-(16+h)*scale),width:w,height:h,cardWidth:width,cardHeight,previews:k,scale,textScale};
}
