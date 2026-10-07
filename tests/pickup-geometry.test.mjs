import test from 'node:test';
import assert from 'node:assert/strict';
import {fitCalibration,locatePixel,undistortPixel} from '../pickup-geometry.js';
const camera={camera_id:'test-camera',width:640,height:480,k:[500,0,320,0,500,240,0,0,1],
  d:[.1,-.08,.002,-.003,.01],frame_id:'color',topic:'/camera/color/image_raw',distortion_model:'plumb_bob',coordinate_space:'raw_image_pixels'};
function pixel(x,y){const [a,b,p,q,c]=camera.d,r=x*x+y*y,f=1+a*r+b*r*r+c*r*r*r;
  return [320+500*(x*f+2*p*x*y+q*(r+2*x*x)),240+500*(y*f+p*(r+2*y*y)+2*q*x*y)];}
function point(x,y){const [u,v]=pixel(x,y);return {u,v,x_m:(.6-2*y)/(1+1.3*y),y_m:-x/(1+1.3*y)};}
export function fixture(){return {schema_version:1,camera:structuredClone(camera),
  fit:[[-.3,-.15],[0,-.15],[.3,-.15],[-.3,.15],[0,.15],[.3,.15]].map(p=>point(...p)),
  checks:[point(-.13,-.05),point(.16,.07)],magnet:{x_m:.2,y_m:0,width_m:.15},mount_note:'fixture only'};}
test('projective mapping with radial/tangential distortion recovers independent metric targets',()=>{
 const d=fixture(),m=fitCalibration(d);
 assert.ok(m.validation_max_m<1e-8);
 for(const [x,y] of [[-.19,-.09],[.12,.09],[0,0]]){
  const p=point(x,y),g=locatePixel(m,d.camera,p.u,p.v);
  assert.ok(Math.abs(g.x_m-p.x_m)<1e-8);assert.ok(Math.abs(g.y_m-p.y_m)<1e-8);
  assert.equal(g.collection_confirmed,false);
 }
 const [u,v]=pixel(.2,-.1),ray=undistortPixel(d.camera,u,v);
 assert.ok(Math.hypot(ray[0]-.2,ray[1]+.1)<1e-9);
});
test('no default distances: missing calibration, collinear, repeated and inaccurate holdouts are rejected',()=>{
 assert.throws(()=>fitCalibration({schema_version:1}),/相机/);
 for(const mutate of [d=>d.fit=d.fit.slice(0,5),d=>d.checks=[],d=>d.checks[0]={...d.fit[0]},
  d=>d.checks[0].x_m+=.08,d=>d.fit=d.fit.map((p,i)=>({...p,v:240,u:100+i*60})),
  d=>d.checks[0]=point(.4,0),d=>d.magnet.width_m=0,d=>d.mount_note='',d=>d.fit[0].x_m=NaN]){
  const d=fixture();mutate(d);assert.throws(()=>fitCalibration(d));
 }
});
test('calibrated hull is enforced and camera changes invalidate estimates',()=>{
 const d=fixture(),m=fitCalibration(d),[u,v]=pixel(.4,0);
 assert.throws(()=>locatePixel(m,d.camera,u,v),/区域之外/);
 for(const mutate of [c=>c.camera_id='changed',c=>c.width=800,c=>c.k[0]=510,c=>c.d[0]=0]){
  const c=structuredClone(d.camera);mutate(c);assert.throws(()=>locatePixel(m,c,320,240),/变更/);
 }
 assert.throws(()=>locatePixel(m,d.camera,-1,240),/超出/);
});
test('magnet coverage uses measured offset and width, independently of image center',()=>{
 const d=fixture();d.magnet.y_m=.03;const m=fitCalibration(d);
 const p=point(0,0),g=locatePixel(m,d.camera,p.u,p.v);
 assert.equal(g.in_straight_sweep,true);assert.ok(Math.abs(g.lateral_error_m+.03)<1e-8);
 const q=point(.2,0),outside=locatePixel(m,d.camera,q.u,q.v);
 assert.equal(outside.in_straight_sweep,false);assert.ok(Math.abs(g.forward_to_magnet_m-.4)<1e-8);
});
