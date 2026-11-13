import {test} from 'node:test';import assert from 'node:assert/strict';
import {keyOf,decodeSettings,layout,capabilityStatus,cleanTitle} from '../src/shared/contracts.mjs';import {key} from './fixtures.mjs';
test('identity serialization cannot collide on separators',()=>{assert.notEqual(keyOf(key('A:B','C')),keyOf(key('B','C:A')));assert.throws(()=>keyOf({...key(),sessionId:''}),/INVALID_IDENTITY/);});
test('false settings preserved and invalid fields fail',()=>{assert.equal(decodeSettings({enabled:{get:()=>false}}).enabled,false);assert.throws(()=>decodeSettings({enabled:'yes'}),/CONFIG_UNAVAILABLE/);});
test('geometry retains negative origin and scales physical coordinates once',()=>{
  const a=layout({left:-1920,top:0,right:0,bottom:1040},96,2);assert.equal(a.left,-384);assert.equal(a.top,780);assert.equal(a.width,368);assert.equal(a.height,244);
  const b=layout({left:0,top:0,right:3840,bottom:2080},192,2);assert.equal(b.left,3072);assert.equal(b.top,1560);
  assert.throws(()=>layout({left:0,top:0,right:200,bottom:100}),/DISPLAY_UNAVAILABLE/);
});
test('missing badge is never full support and titles contain no control characters',()=>{assert.equal(capabilityStatus({events:true,popup:true,navigation:true,badge:false}),'badge-unavailable');assert.equal(cleanTitle('A\u0000B'),'A B');assert.equal(Array.from(cleanTitle('😀'.repeat(200))).length,160);});
