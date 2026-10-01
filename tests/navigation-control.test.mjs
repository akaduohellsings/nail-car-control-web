import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationApi,controlPolicy,validateEnvelope,NavigationNotConnectedError} from '../navigation-api.js';

function status(){return {schema_version:1,read_only:false,bridge_instance_id:'local-bridge',connection:'ONLINE',
 age_seconds:0,stale_after_seconds:2.5,capabilities:{schema_version:1,environment:'local_simulation',control_enabled:true},
 mission:{schema_version:1,mode:'mock',source_instance_id:'node',sequence:1,observed_at_ros_ns:'1234567891234567890',
  state:'IDLE',saved_goal:null,target_event_id:null,attempt:0,max_attempts:3,alarm:null,pending:null,cleaning_mode:'mock',
  stationary_confirmed:true,halt_state:'NONE',owned_goal_id:null,goal_response_pending:false,action_server_ready:true},
 control:{schema_version:1,control_epoch:0,owner:'none',phase:'READY',controller_id:null,map_id:'local-demo',
  localization_valid:true,lease_remaining_seconds:0,manual_direction:'stop',command_result:null}};}

test('control contract requires explicitly local simulation, valid ownership and same mission schema',()=>{
 validateEnvelope(status());
 for(const change of [d=>d.mission.mode='nav2_with_mock_cleaning',d=>d.capabilities.environment='real',
  d=>d.control.owner='unknown',d=>d.control.control_epoch=true,d=>d.control.command_result={status:'success'}]){
  const data=status();change(data);assert.throws(()=>validateEnvelope(data));
 }
});
test('HALTING, stale, unlocalized and other-page status cannot grant control',()=>{
 const d=status();assert.equal(controlPolicy(d,'A').start,true);
 d.control.localization_valid=false;assert.equal(controlPolicy(d,'A').start,false);d.control.localization_valid=true;
 d.control.phase='HALTING';d.control.owner='blocked';d.mission.state='PAUSED';d.mission.saved_goal={x:0,y:0,yaw_deg:0};
 assert.equal(controlPolicy(d,'A').resume,false);assert.equal(controlPolicy(d,'A').manualIntent,false);
 d.control.phase='MANUAL_READY';d.control.owner='manual';d.control.controller_id='B';assert.equal(controlPolicy(d,'A').manualIntent,false);
 assert.equal(controlPolicy(d,'B').manualIntent,true);assert.equal(controlPolicy(d,'B').resume,false);
 d.connection='STALE';assert.equal(controlPolicy(d,'B').manualIntent,false);
});
test('non-loopback address stays read-only even if server advertises local control',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>status()};};
 const api=createNavigationApi({baseUrl:'http://192.168.55.1:8091',sessionId:'A'});
 try{await api.getStatus();await assert.rejects(()=>api.start({goal:{x:0,y:0,yaw_deg:0}}),NavigationNotConnectedError);assert.equal(calls,1);assert.equal(api.controlAvailable,false);}
 finally{api.disconnect();globalThis.fetch=previous;}
});
test('HTTP pending is preserved and command includes identity, epoch, map and unchanged goal units',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});if(options.method==='GET')return {ok:true,json:async()=>status()};
  const body=JSON.parse(options.body);return {ok:true,json:async()=>({schema_version:1,bridge_instance_id:body.bridge_instance_id,
   request_id:body.request_id,command:body.command,status:'pending',reason:null})};
 };
 const api=createNavigationApi({baseUrl:'http://127.0.0.1:8093',sessionId:'A'});
 try{await api.getStatus();const result=await api.start({request_id:'r1',goal:{x:1,y:-2,yaw_deg:90},map_id:'local-demo'});
  assert.equal(result.status,'pending');const body=JSON.parse(calls[1].options.body);
  assert.deepEqual(body,{schema_version:1,request_id:'r1',command:'start',session_id:'A',bridge_instance_id:'local-bridge',control_epoch:0,map_id:'local-demo',goal:{x:1,y:-2,yaw_deg:90}});
 }finally{api.disconnect();globalThis.fetch=previous;}
});
test('wrong receipt correlation is rejected',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,options)=>({ok:true,json:async()=>options.method==='GET'?status():
  ({schema_version:1,request_id:'wrong',bridge_instance_id:'old',command:'start',status:'succeeded',reason:null})});
 const api=createNavigationApi({baseUrl:'http://127.0.0.1:8093',sessionId:'A'});
 try{await api.getStatus();await assert.rejects(()=>api.start({goal:{x:0,y:0,yaw_deg:0}}),/不匹配/);}
 finally{api.disconnect();globalThis.fetch=previous;}
});
test('late control reply after disconnect cannot re-enable commands',async()=>{
 const previous=globalThis.fetch;let resolve;
 globalThis.fetch=()=>new Promise(done=>resolve=done);
 const api=createNavigationApi({baseUrl:'http://127.0.0.1:8093',sessionId:'A'});
 try{const pending=api.getStatus();api.disconnect();resolve({ok:true,json:async()=>status()});await pending;
  assert.equal(api.controlAvailable,false);await assert.rejects(()=>api.start({}),NavigationNotConnectedError);
 }finally{api.disconnect();globalThis.fetch=previous;}
});
