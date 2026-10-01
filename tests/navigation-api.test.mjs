import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationApi, validateEnvelope, NavigationNotConnectedError} from '../navigation-api.js';
const envelope = () => ({schema_version:1,read_only:true,bridge_instance_id:'bridge-A',connection:'ONLINE',
  age_seconds:0.1,stale_after_seconds:2.5,mission:{schema_version:1,mode:'mock',source_instance_id:'node-A',sequence:1,
  observed_at_ros_ns:'1790856417364115436',state:'IDLE',saved_goal:null,target_event_id:null,attempt:0,max_attempts:3,
  alarm:null,pending:null,cleaning_mode:'mock',stationary_confirmed:null,halt_state:null,owned_goal_id:null,
  goal_response_pending:null,action_server_ready:null}});

test('same schema accepts mock/real and rejects invalid freshness/types', () => {
  const mock=envelope(); assert.equal(validateEnvelope(mock).mission.observed_at_ros_ns,'1790856417364115436');
  const real=envelope(); real.mission.mode='nav2_with_mock_cleaning'; real.mission.stationary_confirmed=false;
  real.mission.action_server_ready=true; validateEnvelope(real);
  for (const change of [d=>d.read_only=false,d=>d.age_seconds=9,d=>d.mission.stationary_confirmed='true',
    d=>d.mission.observed_at_ros_ns=1790856417364115436,d=>delete d.mission.sequence,d=>d.mission.saved_goal={x:true,y:0,yaw_deg:0}]) {
    const bad=envelope();change(bad);assert.throws(()=>validateEnvelope(bad));
  }
});

test('status uses GET and all commands reject without network calls', async () => {
  const old=globalThis.fetch, calls=[];
  globalThis.fetch=async (url,options)=>{calls.push({url,options});return {ok:true,json:async()=>envelope()};};
  const api=createNavigationApi({baseUrl:'http://192.168.55.1:8091'});
  try {
    await api.getStatus();assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');
    assert.equal(calls[0].url,'http://192.168.55.1:8091/api/v1/status');
    for(const method of ['start','pause','resume','reset','requestManual','releaseManual','stop','getMap'])
      await assert.rejects(()=>api[method](),NavigationNotConnectedError);
    assert.equal(calls.length,1);
  } finally {api.disconnect();globalThis.fetch=old;}
});

test('disconnect discards a delayed reply and never emits online afterward', async () => {
  const old=globalThis.fetch;let resolve;const received=[];
  globalThis.fetch=()=>new Promise(done=>resolve=done);
  const api=createNavigationApi({baseUrl:'http://127.0.0.1:8091'});api.subscribeStatus(data=>received.push(data));
  try {
    const pending=api.connect();api.disconnect();resolve({ok:true,json:async()=>envelope()});await pending;
    assert.deepEqual(received.map(s=>s.connection),['DISCONNECTED']);
  } finally {api.disconnect();globalThis.fetch=old;}
});

test('network failure produces unavailable status instead of fake online', async () => {
  const old=globalThis.fetch;const received=[];
  globalThis.fetch=async()=>{throw new Error('offline');};
  const api=createNavigationApi({baseUrl:'http://127.0.0.1:8091'});api.subscribeStatus(data=>received.push(data));
  try {await api.connect();assert.equal(received[0].connection,'UNREACHABLE');assert.equal(received[0].mission,null);}
  finally {api.disconnect();globalThis.fetch=old;}
});
