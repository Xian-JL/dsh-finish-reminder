import {test} from 'node:test';import assert from 'node:assert/strict';import * as React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {NotificationRow} from '../src/client/center.mjs';import {QuietSettings} from '../src/client/quiet.mjs';import {decodeSettings,formatDuration} from '../src/shared/contracts.mjs';
test('notification rows escape titles and expose context and safe navigation labels',()=>{
  const item={id:'one',displayTitle:'<script>alert(1)</script>',workspaceTitle:'工作区A',endedAt:1700000000000,durationMs:65000,outcome:'error',readState:'unread',silenced:true,currentlyRunning:true};
  const html=renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement(NotificationRow,{item,enabled:true,busy:false,onOpen(){}}))));
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.match(html,/静默收录/);assert.match(html,/工作区A/);assert.match(html,/1分5秒/);assert.match(html,/新任务运行/);assert.match(html,/返回原对话/);
  const retired=renderToStaticMarkup(React.createElement(NotificationRow,{item:{...item,readState:'retired'},enabled:true,onOpen(){}}));assert.match(retired,/disabled=""/);
});
test('quiet settings expose bounded global choices without excluded feature controls',()=>{
  const html=renderToStaticMarkup(React.createElement(QuietSettings,{settings:decodeSettings(),writable:true,save(){}}));
  for(const text of ['15分钟','30分钟','60分钟','120分钟','22:00','08:00','周一','周日','保存排程','解除后不补弹'])assert.ok(html.includes(text),text);
  for(const absent of ['快捷键','按会话静默','按工作区静默','合并提醒'])assert.ok(!html.includes(absent));
  assert.equal(formatDuration(null),'历时未知');assert.equal(formatDuration(999),'不足1秒');assert.equal(formatDuration(65000),'1分5秒');
});
