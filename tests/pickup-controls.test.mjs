import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePickupSpeeds,PICKUP_SPEED_POLICY} from '../pickup-speed.js';
import {calibrationAgrees,pickupTestPayload,pickupTestBlockers,createPickupReadyGate,parkingWaitText} from '../pickup-test.js';
const fixture=()=>({camera:{camera_id:'fixture'},fit:[{u:320,v:240,x_m:.6,y_m:0}],checks:[{u:340,v:230,x_m:.7,y_m:.1}],magnet:{x_m:.125,y_m:0,width_m:.035}});
test('pickup has independent default speeds and the navigation ceilings',()=>{
  assert.deepEqual(parsePickupSpeeds(.3,45),{linear_m_s:.3,angular_rad_s:Math.PI/4});
  assert.equal(PICKUP_SPEED_POLICY.defaults.linear_m_s,.04);
  for(const [v,w] of [[.301,45],[.04,45.1],[0,12],[NaN,12],[.04,Infinity]])assert.throws(()=>parsePickupSpeeds(v,w));
});
test('manual test passes pixels and server calibration identity, never browser ground coordinates',()=>{
  const obs={capture_id:'capture',pickup_calibration:{calibration_id:'calibration'}};
  const p=pickupTestPayload(obs,{u:320,v:240},{linear_m_s:.04,angular_rad_s:.24});
  assert.deepEqual(p,{capture_id:'capture',u:320,v:240,mount_confirmed:true,calibration_id:'calibration',pickup_speed_limits:{linear_m_s:.04,angular_rad_s:.24}});
  assert.throws(()=>pickupTestPayload(obs,{u:NaN,v:2},{}));assert.throws(()=>pickupTestPayload({},null,{}));
});
test('browser and server measured fit and magnet must agree before a test',()=>{
  const a=fixture(),b=structuredClone(a);assert.equal(calibrationAgrees(a,b),true);
  b.magnet.x_m+=.01;assert.equal(calibrationAgrees(a,b),false);
  b.magnet.x_m=a.magnet.x_m;b.fit[0].x_m+=.01;assert.equal(calibrationAgrees(a,b),false);
});
const readyTest=()=>({status:{connection:'ONLINE',mission:{state:'IDLE'},control:{owner:'none'}},ready:true,posting:false,
  observation:{capture_id:'capture',pickup_calibration:{draft:fixture()}},fresh:true,used:null,selected:{u:320,v:240},
  model:{},mountConfirmed:true,conditions:true,agrees:true,speedValid:true});
test('flapping readiness cannot enable pickup; losing parking evidence disables immediately',()=>{
  const gate=createPickupReadyGate();
  for(let t=0;t<3000;t+=200){assert.equal(gate.update(true,t),false);assert.equal(gate.update(false,t+100),false);}
  assert.equal(gate.update(true,3000),false);assert.equal(gate.update(true,3999),false);
  assert.equal(gate.update(true,4000),true);assert.equal(gate.update(false,4001),false);
  assert.equal(gate.update(true,4002),false);
  assert.match(pickupTestBlockers({...readyTest(),stableReady:false}).join(''),/连续稳定1秒/);
});
test('parking wait explains odometry replay and actual guard timeout separately',()=>{
  assert.match(parkingWaitText({navigation:{parking_confirmation:{reason:'ODOM_REPLAY'}}}),/重复或乱序/);
  assert.match(parkingWaitText({navigation:{parking_confirmation:{reason:'GUARD_FEEDBACK_STALE'}}}),/底盘保护反馈/);
  assert.equal(parkingWaitText({}),'等待小车停车确认');
});
test('idle service explains every missing local preparation instead of only saying idle',()=>{
  const v=readyTest();assert.deepEqual(pickupTestBlockers(v),[]);
  Object.assign(v,{mountConfirmed:false,conditions:false,selected:null,agrees:false});
  const reasons=pickupTestBlockers(v);assert.equal(reasons.length,4);
  assert.match(reasons.join('；'),/载入导航服务.*相机、磁铁.*钉子中心.*我在车旁/);
});
test('stale or consumed captures require a new picture and no implicit re-use',()=>{
  const v=readyTest();v.fresh=false;assert.match(pickupTestBlockers(v).join(''),/超过60秒/);
  v.fresh=true;v.used='capture';assert.match(pickupTestBlockers(v).join(''),/已用于拾取/);
  v.observation=null;assert.match(pickupTestBlockers(v).join(''),/获取静止快照/);
});
test('service and speed blockers remain visible and cannot be replaced by local checkboxes',()=>{
  const v=readyTest();v.ready=false;v.status.connection='UNREACHABLE';v.speedValid=false;
  assert.match(pickupTestBlockers(v).join('；'),/任务服务未连接.*填写有效拾取速度/);
  v.status.connection='ONLINE';v.status.capabilities={control_enabled:true,auto_pickup:{supported:true},commands:['pickup_test']};
  v.status.mission.cleaning_mode='calibrated_pickup';v.status.mission.stationary_confirmed=false;
  v.status.control.localization_valid=false;
  assert.match(pickupTestBlockers(v).join('；'),/停车确认.*定位尚未就绪/);
});
