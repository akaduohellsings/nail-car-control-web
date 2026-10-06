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
test('real pickup status retains navigation controls and blocks new goals while cleaning',()=>{
 const d=status();d.capabilities={schema_version:1,environment:'robot_navigation',control_enabled:true,
  commands:['start','pause','resume','reset','stop'],auto_pickup:{supported:true,cleaning_mode:'image_pickup'}};
 d.mission.mode='nav2_with_image_pickup';d.mission.cleaning_mode='image_pickup';
 validateEnvelope(d);assert.equal(controlPolicy(d,'A').start,true);
 d.mission.state='CLEANING';d.mission.stationary_confirmed=false;
 assert.equal(controlPolicy(d,'A').start,false);assert.equal(controlPolicy(d,'A').stop,true);
 assert.equal(controlPolicy(d,'A').manualIntent,false);
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
test('ordinary abort permits a new target only with capability and confirmed stop',()=>{
 const d=status();d.capabilities.environment='robot_navigation';d.capabilities.retry_after_navigation_abort=true;
 d.mission.mode='nav2_with_mock_cleaning';d.mission.state='FAULT';d.mission.alarm='NAVIGATION_ABORTED';
 d.mission.halt_state='CONFIRMED';d.control.phase='FAULT';d.control.owner='blocked';
 assert.equal(controlPolicy(d,'A').start,true);
 assert.equal(controlPolicy(d,'A').stop,true);
 for(const mutate of [x=>x.capabilities.retry_after_navigation_abort=false,x=>x.mission.stationary_confirmed=false,
   x=>x.mission.owned_goal_id='old-goal',x=>x.mission.alarm='STOP_UNCONFIRMED',x=>x.control.controller_id='B',
   x=>x.control.localization_valid=false]){
  const blocked=structuredClone(d);mutate(blocked);assert.equal(controlPolicy(blocked,'A').start,false);
 }
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

test('real Type-C navigation requires explicit capability and keeps manual control disabled',async()=>{
 const previous=globalThis.fetch,calls=[];const real=status();
 real.mission.mode='nav2_with_mock_cleaning';
 real.capabilities={schema_version:1,environment:'robot_navigation',control_enabled:true,commands:['start','pause','resume','reset','stop']};
 validateEnvelope(real);assert.equal(controlPolicy(real,'A').start,true);assert.equal(controlPolicy(real,'A').requestManual,false);
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>options.method==='GET'?real:
  ({schema_version:1,request_id:'real-r',bridge_instance_id:'local-bridge',command:'start',status:'pending',reason:null})};};
 const api=createNavigationApi({baseUrl:'http://192.168.55.1:8091',sessionId:'A'});
 try{await api.getStatus();assert.equal(api.controlAvailable,true);
  const result=await api.start({request_id:'real-r',map_id:'local-demo',goal:{x:.4,y:0,yaw_deg:0}});
  assert.equal(result.status,'pending');assert.equal(calls.length,2);
  await assert.rejects(()=>api.requestManual(),/不允许/);assert.equal(calls.length,2);
  const invalid=structuredClone(real);invalid.capabilities.commands.push('manual_intent');assert.throws(()=>validateEnvelope(invalid));
 }finally{api.disconnect();globalThis.fetch=previous;}
});

function realManualStatus(){
 const d=status();d.mission.mode='nav2_with_mock_cleaning';
 d.capabilities={schema_version:1,environment:'robot_navigation',control_enabled:true,
  commands:['start','pause','resume','reset','stop','request_manual','release_manual','manual_intent'],
  manual_control:{supported:true,directions:['stop','forward','backward','left','right','left_forward','right_forward','left_backward','right_backward'],
   speed_limits:{linear_max_m_s:.3,angular_max_rad_s:Math.PI/4,defaults:{linear_m_s:.05,angular_rad_s:.24}}}};
 return d;
}
test('real manual requires declared commands and confirmed ownership; stale and foreign sessions cannot drive',()=>{
 const d=realManualStatus();validateEnvelope(d);
 assert.equal(controlPolicy(d,'A').requestManual,true);assert.equal(controlPolicy(d,'A').manualIntent,false);
 d.control.owner='manual';d.control.phase='MANUAL_READY';d.control.controller_id='A';d.control.manual_direction='left_backward';
 validateEnvelope(d);assert.equal(controlPolicy(d,'A').manualIntent,true);assert.equal(controlPolicy(d,'A').start,false);
 assert.equal(controlPolicy(d,'B').manualIntent,false);
 d.connection='STALE';assert.equal(controlPolicy(d,'A').manualIntent,false);d.connection='ONLINE';
 d.capabilities.manual_control.supported=false;assert.equal(controlPolicy(d,'A').manualIntent,false);
 d.capabilities.commands.pop();assert.throws(()=>validateEnvelope(d));
});
test('real manual transport uses the task API and preserves selected speed and intent order',async()=>{
 const previous=globalThis.fetch,calls=[];let state=realManualStatus();
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});if(options.method==='GET')return {ok:true,json:async()=>state};
  const body=JSON.parse(options.body);return {ok:true,json:async()=>({schema_version:1,bridge_instance_id:body.bridge_instance_id,
   request_id:body.request_id,command:body.command,status:body.command==='request_manual'?'pending':'succeeded',reason:null})};
 };
 const api=createNavigationApi({baseUrl:'http://192.168.137.2:8092',sessionId:'A'});
 try{
  await api.getStatus();await api.requestManual({speed_limits:{linear_m_s:.1,angular_rad_s:.4}});
  assert.deepEqual(JSON.parse(calls.at(-1).options.body).speed_limits,{linear_m_s:.1,angular_rad_s:.4});
  state={...state,control:{...state.control,owner:'manual',phase:'MANUAL_READY',controller_id:'A',control_epoch:2}};
  await api.getStatus();await api.manualIntent({direction:'left_backward'});await api.manualIntent({direction:'stop'});
  const intents=calls.filter(call=>call.options.method==='POST').map(call=>JSON.parse(call.options.body)).filter(body=>body.command==='manual_intent');
  assert.equal(intents[1].intent_sequence,intents[0].intent_sequence+1);
  assert.ok(calls.every(call=>call.url.startsWith('http://192.168.137.2:8092/api/v1/')));
 }finally{api.disconnect();globalThis.fetch=previous;}
});

test('local freshness deadline disables control before a stalled poll returns',async()=>{
 const previous=globalThis.fetch,received=[];let reads=0;
 globalThis.fetch=async(url,options)=>{
  if(options.method==='GET'){
   reads++;const d=status();d.stale_after_seconds=.05;
   return {ok:true,json:async()=>d};
  }
  return {ok:true,json:async()=>({status:'accepted'})};
 };
 const api=createNavigationApi({baseUrl:'http://127.0.0.1:8093',sessionId:'A'});
 api.subscribeStatus(d=>received.push(d.connection));
 try{
  await api.connect();assert.equal(api.controlAvailable,true);
  await new Promise(done=>setTimeout(done,180));
  assert.equal(reads,1);assert.equal(api.controlAvailable,false);assert.ok(received.includes('STALE'));
 }finally{api.disconnect();globalThis.fetch=previous;}
});
