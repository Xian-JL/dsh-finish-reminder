export const key=(sessionId='A',profileId='test')=>({desktopAppGroupId:'fixture-group',hostInstanceId:'fixture-host',profileId,sessionId});
export const fact=(sessionId='A',seq=10,extra={})=>({conversation:key(sessionId),taskEpisodeId:'task-'+seq,streamEpoch:'1234',terminalEventSeq:seq,endedAt:1700000000000,outcome:'ended',displayTitle:'测试对话 '+sessionId,...extra});
export const record=(id='A',seq=10)=>({...fact(id,seq),id:JSON.stringify([id,seq]),readState:'unread'});
export const tick=()=>new Promise(r=>setImmediate(r));
