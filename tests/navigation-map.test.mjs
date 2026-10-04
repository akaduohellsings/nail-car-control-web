import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMap,pixelToWorld,worldToPixel} from '../navigation-map.js';
const map={map_id:'map-one',frame:'map',width:4,height:6,resolution:.05,origin:{x:-1,y:2,yaw:Math.PI/2},data:Array(24).fill(0)};
test('ROS grid transforms keep rotated origins and screen Y inversion',()=>{
  validateMap(map);const point=pixelToWorld(map,1,5);
  assert.ok(Math.abs(point.x+1.05)<1e-10);assert.ok(Math.abs(point.y-2.05)<1e-10);
  const p=worldToPixel(map,point);assert.ok(Math.abs(p.x-1)<1e-10);assert.ok(Math.abs(p.y-5)<1e-10);
});
test('map rejects truncated, out of range and nonfinite inputs',()=>{
  for(const bad of [{...map,data:[]},{...map,resolution:0},{...map,data:Array(24).fill(101)},
    {...map,origin:{...map.origin,yaw:NaN}}])assert.throws(()=>validateMap(bad));
});
