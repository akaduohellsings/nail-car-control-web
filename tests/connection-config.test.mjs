import test from 'node:test';
import assert from 'node:assert/strict';
import {addressesFor,loadConfig,validateConfig} from '../connection-config.js';

test('USB preset replaces every robot service, including bracketed IPv6', () => {
  const usb=addressesFor('http://192.168.55.1');
  assert.equal(usb.controlUrl,'http://192.168.55.1:5000');
  assert.equal(usb.navigationUrl,'http://192.168.55.1:8091');
  assert.equal(addressesFor('http://[::1]').videoUrl,'http://[::1]:8080');
});
test('invalid URLs cannot become control destinations', () => {
  for(const url of ['javascript:alert(1)','http://user:secret@host','http://host/?move=forward','http://host/#fragment'])
    assert.throws(()=>validateConfig({...addressesFor('http://host'),controlUrl:url}));
});
test('old navigation settings migrate and broken storage recovers', () => {
  assert.equal(loadConfig({getItem:key=>key==='nail.navigation.serviceUrl.v1'?'http://127.0.0.1:8093':null}).navigationUrl,'http://127.0.0.1:8093');
  assert.equal(loadConfig({getItem:()=>'{broken'}).controlUrl,'http://192.168.0.100:5000');
});
