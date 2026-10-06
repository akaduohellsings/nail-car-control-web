import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMap,pixelToWorld,worldToPixel,zoomViewport,viewportToPixel} from '../navigation-map.js';
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

test('zoom preserves the map position under the pointer and enforces bounds',()=>{
  const view={scale:2,x:-10,y:30},anchor={x:120,y:80},before=viewportToPixel(view,anchor);
  for(const factor of [1.25,.8,100,.001]){
    const next=zoomViewport(view,factor,anchor,1,8);
    assert.deepEqual(viewportToPixel(next,anchor),before);
    assert.ok(next.scale>=1&&next.scale<=8);
  }
});
test('dragged and zoomed map selection retains ROS coordinates',()=>{
  const view={scale:4,x:100,y:-20},pixel={x:1.5,y:4.5};
  const screen={x:view.x+pixel.x*view.scale,y:view.y+pixel.y*view.scale};
  assert.deepEqual(pixelToWorld(map,...Object.values(viewportToPixel(view,screen))),pixelToWorld(map,pixel.x,pixel.y));
});
