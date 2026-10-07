import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePickupSpeeds,PICKUP_SPEED_POLICY} from '../pickup-speed.js';
import {calibrationAgrees,pickupTestPayload} from '../pickup-test.js';
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
