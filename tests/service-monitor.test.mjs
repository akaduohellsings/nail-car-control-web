import test from 'node:test';
import assert from 'node:assert/strict';
import {createJpegParser,createEventMonitor} from '../service-monitor.js';

test('MJPEG parser reconstructs multiple JPEGs split across boundaries',()=>{
  const frames=[],parse=createJpegParser(frame=>frames.push([...frame]));
  for(const chunk of [[13,10,255],[216,1],[2,255],[217,13,10,255,216,3,255,217]])parse(new Uint8Array(chunk));
  assert.deepEqual(frames,[[255,216,1,2,255,217],[255,216,3,255,217]]);
});
test('old event reply is ignored after changing the service address',async()=>{
  const events=[],states=[],resolvers=[];
  const monitor=createEventMonitor({onStatus:d=>states.push(d),onEvent:d=>events.push(d),fetcher:()=>new Promise(done=>resolvers.push(done))});
  monitor.start('http://old');monitor.start('http://new');
  resolvers[0]({ok:true,json:async()=>({detected:true,count:1,message:'old nail'})});
  resolvers[1]({ok:true,json:async()=>({detected:false,count:0,message:'new scene'})});
  await new Promise(done=>setTimeout(done,20));monitor.stop();
  assert.deepEqual(events,[]);assert.equal(states.length,1);assert.equal(states[0].sourceFresh,null);
});
test('expired source timestamp cannot produce a current nail event',async()=>{
  const events=[],states=[];
  const monitor=createEventMonitor({onStatus:d=>states.push(d),onEvent:d=>events.push(d),fetcher:async()=>({ok:true,json:async()=>({detected:true,count:1,message:'stale nail',observed_at_ros_ns:'1'})})});
  monitor.start('http://events');await new Promise(done=>setTimeout(done,20));monitor.stop();
  assert.equal(states[0].state,'STALE');assert.deepEqual(events,[]);
});
