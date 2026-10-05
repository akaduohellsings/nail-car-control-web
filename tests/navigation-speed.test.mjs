import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpeedInputs,speedText,DEFAULT_SPEEDS} from '../navigation-speed.js';

test('speed inputs convert degrees to radians without changing distance units',()=>{
  const value=parseSpeedInputs(.025,10);
  assert.equal(value.linear_m_s,.025);assert.ok(Math.abs(value.angular_rad_s-Math.PI/18)<1e-12);
  assert.equal(speedText(value),'0.025 米/秒 · 10.00 度/秒');
});
test('map profile allows 0.3 while keeping the default low and legacy profiles restricted',()=>{
  const policy={linear_max_m_s:.3,angular_max_rad_s:.24};
  assert.equal(DEFAULT_SPEEDS.linear_m_s,.05);
  assert.equal(parseSpeedInputs(.3,13,policy).linear_m_s,.3);
  assert.equal(parseSpeedInputs(.05,13,policy).linear_m_s,.05);
  assert.throws(()=>parseSpeedInputs(.301,13,policy));
  assert.throws(()=>parseSpeedInputs(.3,13,{linear_max_m_s:.06,angular_max_rad_s:.24}));
});
test('blank, nonpositive, nonfinite and over-profile speeds are rejected',()=>{
  for(const [linear,angular] of [[NaN,10],[.02,0],[0,10],[Infinity,10],[.02,Infinity],[.061,10],[.02,14]])
    assert.throws(()=>parseSpeedInputs(linear,angular));
  assert.throws(()=>parseSpeedInputs(.025,10,{linear_max_m_s:.06,angular_max_rad_s:.08}));
  assert.ok(parseSpeedInputs(.025,4.58,{linear_max_m_s:.06,angular_max_rad_s:.08}));
});
