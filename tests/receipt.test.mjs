import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {ReminderQueue} from '../src/core/queue.mjs';import {layout} from '../src/shared/contracts.mjs';import {record} from './fixtures.mjs';
function queue(){let time=0;return {q:new ReminderQueue({now:()=>time}),at:t=>{time=t;}};}
test('receipt budget begins at full paint, hover captured at entry does not consume it',()=>{
  const {q,at}=queue();q.enqueue(record('A'));const token=q.token();at(160);assert.equal(q.remaining(),10000);
  q.hover(token,true);q.painted(token);assert.equal(q.front.state,'paused');at(6000);assert.equal(q.remaining(),10000);
  q.hover(token,false);at(7000);assert.equal(q.remaining(),9000);
});
test('hover-paused receipt accepts return and failure resumes the same paused budget',()=>{
  const {q,at}=queue();q.enqueue(record('A'));q.enqueue(record('B'));q.painted(q.token());at(3000);q.hover(q.token(),true);
  const token=q.token();assert.equal(q.beginOpen(token).state,'opening');at(7000);assert.equal(q.remaining(),7000);
  q.failOpen(token,'FOREGROUND_DENIED');assert.equal(q.front.state,'paused');assert.equal(q.remaining(),7000);
  assert.equal(q.beginOpen(token).record.conversation.sessionId,'A');q.completeOpen(token);assert.equal(q.front.record.conversation.sessionId,'B');assert.equal(q.remaining(),10000);
});
test('close accepts hover pause but neither close nor return acts during unavailable desktop',()=>{
  const {q}=queue();q.enqueue(record('A'));q.painted(q.token());q.hover(q.token(),true);assert.equal(q.dismiss(q.token()).state,'dismissed');
  q.enqueue(record('B'));q.painted(q.token());q.setAvailable(false);assert.equal(q.dismiss(q.token()),null);assert.equal(q.beginOpen(q.token()),null);assert.equal(q.click(q.token()),null);
});
test('hover on the exact deadline cannot retain an expired receipt',()=>{
  const {q,at}=queue();q.enqueue(record('A'));q.enqueue(record('B'));q.painted(q.token());const token=q.token();at(10000);q.hover(token,true);
  assert.equal(q.front.record.conversation.sessionId,'B');assert.equal(q.click(token),null);assert.equal(q.remaining(),10000);
});
test('receipt sequence is transient, survives redraw/state updates, and is independent from conversation count',()=>{
  const {q}=queue();q.enqueue(record('A',10));q.enqueue(record('A',20));assert.equal(q.view().front.receiptNumber,1);
  q.painted(q.token());q.hover(q.token(),true);q.rendererLost();assert.equal(q.view().front.receiptNumber,1);
  q.remove(q.token(),'dismissed');assert.equal(q.view().front.receiptNumber,2);q.order=Number.MAX_SAFE_INTEGER;assert.throws(()=>q.enqueue(record('C')),/QUEUE_CAPACITY_ERROR/);
});
test('receipt geometry reserves its entire shadow/preview footprint and grows text instead of shrinking it',()=>{
  const g=layout({left:0,top:0,right:348,bottom:340},96,2,2);assert.equal(g.cardWidth,300);assert.equal(g.cardHeight,288);assert.equal(g.previews,0);assert.equal(g.height,304);assert.equal(g.top,20);
  assert.throws(()=>layout({left:0,top:0,right:347,bottom:1000},96),/DISPLAY_UNAVAILABLE/);
  assert.throws(()=>layout({left:0,top:0,right:1920,bottom:1000},96,2,3),/DISPLAY_UNAVAILABLE/);
});
test('both receipt palettes meet 4.5:1 for every text/focus token on the paper',async()=>{
  const theme=JSON.parse(await readFile(new URL('../assets/receipt-theme.json',import.meta.url)));
  const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
  for(const [mode,t]of Object.entries(theme))for(const token of ['ink','secondaryInk','endedInk','errorInk','attentionInk','focusInk']){
    const a=luminance(t.paper),b=luminance(t[token]),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(ratio>=4.5,`${mode}/${token}: ${ratio}`);
  }
});
