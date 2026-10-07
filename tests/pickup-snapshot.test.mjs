import test from 'node:test';
import assert from 'node:assert/strict';
import {getStationaryObservation} from '../pickup-snapshot.js';

function fixture(responses) {
  let now = 0;
  const calls = [], retries = [], waits = [];
  return {calls, retries, waits, options: {
    clock: () => now,
    wait: async ms => { waits.push(ms); now += ms; },
    onRetry: (...args) => retries.push(args),
    fetcher: async (url, options) => {
      calls.push({url, ...options});
      const result = responses.shift(); now += result.elapsed || 0;
      return {ok: !result.error, json: async () => result};
    }
  }};
}

test('temporary stop feedback rejection then same-frame success uses GET only', async () => {
  const record = {stationary:true, source_stamp_ns:'123', boxes:[]};
  const f = fixture([{error:'STATIONARY_SNAPSHOT_REQUIRED'}, record]);
  assert.deepEqual(await getStationaryObservation('http://robot:8092', f.options), record);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(c => c.method === 'GET' && c.cache === 'no-store' && !c.body));
  assert.deepEqual(f.retries, [[2, 'STATIONARY_SNAPSHOT_REQUIRED']]);
});

test('camera startup and matching waits recover, but persistent movement is rejected after three reads', async () => {
  const f = fixture([{error:'CAMERA_INFO_NOT_READY'}, {error:'MATCHED_CAMERA_DETECTION_NOT_READY'}, {stationary:true}]);
  assert.equal((await getStationaryObservation('http://robot', f.options)).stationary, true);
  const moving = fixture(Array.from({length:3}, () => ({error:'STATIONARY_SNAPSHOT_REQUIRED'})));
  await assert.rejects(getStationaryObservation('http://robot', moving.options), /STATIONARY_SNAPSHOT_REQUIRED/);
  assert.equal(moving.calls.length, 3);
});

test('invalid configuration, authorization, and encoding errors are never retried', async () => {
  for (const error of ['NOT_FOUND', 'FORBIDDEN', 'SNAPSHOT_ENCODING_UNAVAILABLE', 'VISION_RECEIVER_UNAVAILABLE: failed']) {
    const f = fixture([{error}]);
    await assert.rejects(getStationaryObservation('http://robot', f.options), e => e.message === error);
    assert.equal(f.calls.length, 1); assert.equal(f.waits.length, 0);
  }
});

test('total deadline stops further reads; disconnected transport errors propagate', async () => {
  const f = fixture([{error:'SERVICE_STARTING', elapsed:7900}]);
  await assert.rejects(getStationaryObservation('http://robot', f.options), /SERVICE_STARTING/);
  assert.equal(f.calls.length, 1);
  const late = fixture([{stationary:true, elapsed:8100}]);
  await assert.rejects(getStationaryObservation('http://robot', late.options), /SNAPSHOT_TIMEOUT/);
  let calls = 0;
  await assert.rejects(getStationaryObservation('http://robot', {fetcher:async () => {calls++; throw Error('Failed to fetch');}}), /Failed to fetch/);
  assert.equal(calls, 1);
});
