import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRouteDraft,routeStartPayload,routeProgress,routeActive,navigationArrived} from '../navigation-route.js';
import {controlPolicy,validateEnvelope,createNavigationApi} from '../navigation-api.js';

const goals=[{x:.4,y:0,yaw_deg:0},{x:.4,y:.4,yaw_deg:90}];
const route=()=>({map_id:'map',goals:structuredClone(goals),state:'RUNNING',total:2,current_index:0,completed:0,reason:null});
const status=()=>({schema_version:1,read_only:false,bridge_instance_id:'bridge',connection:'ONLINE',age_seconds:0,stale_after_seconds:2.5,
 capabilities:{schema_version:1,environment:'robot_navigation',control_enabled:true,commands:['start','pause','resume','reset','stop'],waypoints:{supported:true,max_points:20}},
 mission:{schema_version:1,mode:'nav2_with_mock_cleaning',source_instance_id:'node',sequence:1,observed_at_ros_ns:'1',state:'IDLE',saved_goal:goals[0],target_event_id:null,
 attempt:0,max_attempts:3,alarm:null,pending:null,cleaning_mode:'mock',stationary_confirmed:true,halt_state:'NONE',owned_goal_id:null,goal_response_pending:false,action_server_ready:true},
 control:{schema_version:1,control_epoch:0,owner:'none',phase:'READY',controller_id:'page',map_id:'map',localization_valid:true,lease_remaining_seconds:3,manual_direction:'stop',command_result:null,route:null}});

test('already-at-goal completion is displayed after a confirmed prior stop, never from an old receipt',()=>{
 const d=status();assert.equal(navigationArrived(d),true);
 d.mission.halt_state='CONFIRMED';assert.equal(navigationArrived(d),false);
 d.navigation={goal_completion:{source:'stationary_pose',goal:{...d.mission.saved_goal}}};
 assert.equal(navigationArrived(d),true);
 for(const change of [v=>v.mission.stationary_confirmed=false,v=>v.mission.state='NAV_STARTING',
  v=>v.mission.saved_goal=null,v=>v.mission.owned_goal_id='active',v=>v.mission.goal_response_pending=true,
  v=>v.navigation.goal_completion.goal.x+=.1,v=>v.mission.halt_state='VERIFYING_STOP']){
  const copy=structuredClone(d);change(copy);assert.equal(navigationArrived(copy),false);
 }
});

test('route drafts keep order, numbers and map identity without aliasing',()=>{
 const value={map_id:'map',goals};const draft=parseRouteDraft(value);
 assert.deepEqual(draft,value);assert.notEqual(draft.goals[0],goals[0]);
 assert.deepEqual(routeStartPayload(draft,'map',{supported:true,max_points:20}),value);
 for(const bad of [{map_id:'',goals},{map_id:'map',goals:[{x:true,y:0,yaw_deg:0}]},{map_id:'map',goals:[{x:NaN,y:0,yaw_deg:0}]},{map_id:'map',goals:Array(21).fill(goals[0])}])assert.throws(()=>parseRouteDraft(bad));
 assert.throws(()=>routeStartPayload(draft,'changed',{supported:true,max_points:20}),/地图已切换/);
 assert.throws(()=>routeStartPayload(draft,'map',undefined),/未支持/);
 assert.throws(()=>routeStartPayload({map_id:'map',goals:[]},'map',{supported:true,max_points:20}));
});

test('waiting between points cannot start another task and can pause; paused can resume',()=>{
 const d=status();d.control.route={...route(),state:'WAITING_STOP',completed:1};
 validateEnvelope(d);assert.equal(controlPolicy(d,'page').start,false);assert.equal(controlPolicy(d,'page').pause,true);
 d.control.route.state='PAUSED';d.control.phase='PAUSED';
 assert.equal(controlPolicy(d,'page').resume,true);assert.equal(controlPolicy(d,'page').pause,false);
 d.control.route.state='COMPLETED';d.control.route.completed=2;
 assert.equal(controlPolicy(d,'page').start,true);assert.match(routeProgress(d.control.route),/全部完成.*2 \/ 2/);
 assert.equal(routeActive(d.control.route),false);
});

test('malformed queue statuses cannot enable navigation',()=>{
 for(const change of [r=>r.completed=3,r=>r.current_index=2,r=>r.total=0,r=>r.goals[0].x='1',r=>r.state='SKIPPED']){
  const d=status();d.control.route=route();change(d.control.route);assert.throws(()=>validateEnvelope(d));
 }
});

test('multiple goals sent in one request retain map, speed and identity; acceptance is not completion',async()=>{
 const before=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});const body=options.method==='GET'?null:JSON.parse(options.body);
  return {ok:true,json:async()=>body?{schema_version:1,bridge_instance_id:'bridge',request_id:body.request_id,command:'start',status:'pending',reason:null}:status()};
 };
 const api=createNavigationApi({baseUrl:'http://192.168.137.2:8092',sessionId:'page'});
 try{
  await api.getStatus();const response=await api.start({...routeStartPayload({map_id:'map',goals},'map',{supported:true,max_points:20}),request_id:'queue',speed_limits:{linear_m_s:.05,angular_rad_s:.24}});
  assert.equal(response.status,'pending');const body=JSON.parse(calls[1].options.body);
  assert.deepEqual(body.goals,goals);assert.equal(body.goal,undefined);assert.equal(body.map_id,'map');assert.equal(body.session_id,'page');assert.equal(body.control_epoch,0);
 }finally{api.disconnect();globalThis.fetch=before;}
});
