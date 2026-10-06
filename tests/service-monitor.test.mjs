import test from 'node:test';
import assert from 'node:assert/strict';
import {createJpegParser,createEventMonitor,createVideoMonitor,videoStreamUrl} from '../service-monitor.js';

test('legacy stream query preserves literal ROS slashes and rejects injected parameters',()=>{
  assert.equal(videoStreamUrl('http://robot:8080/','/camera/color/image_raw'),'http://robot:8080/stream?topic=/camera/color/image_raw');
  assert.equal(videoStreamUrl('http://robot:8080','/detected_image'),'http://robot:8080/stream?topic=/detected_image');
  for(const topic of ['/raw&topic=/other','/raw?type=png','%2Fraw','/raw\r\n','raw'])assert.throws(()=>videoStreamUrl('http://robot',topic));
});

function videoHarness(fetcher){
  let time=0,id=0;const jobs=new Map(),states=[];
  const clock={setTimeout:fn=>{jobs.set(++id,fn);return id;},clearTimeout:key=>jobs.delete(key),
    setInterval:fn=>{jobs.set(++id,fn);return id;},clearInterval:key=>jobs.delete(key)};
  const image={src:'',naturalWidth:0,removeAttribute(){this.src='';}};
  const monitor=createVideoMonitor({image,clock,now:()=>time,onStatus:value=>states.push(value),fetcher});
  return {monitor,image,states,tick(){time+=6000;for(const fn of [...jobs.values()])fn();}};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function abortable(signal){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}

test('video distinguishes missing service from connected service without images',async()=>{
  for(const connected of [false,true]){
    const h=videoHarness(async(_url,{signal})=>connected?{ok:true,body:{getReader:()=>({read:()=>abortable(signal),releaseLock(){}})}}:await abortable(signal));
    h.monitor.start('http://video');await flush();h.tick();await flush();
    assert.equal(h.states.at(-1).state,connected?'NO_FRAMES':'UNREACHABLE');
    assert.equal(h.states.at(-1).url,'http://video/stream?topic=/detected_image');h.monitor.stop();
  }
});
test('video displays frames, detects stalls, and ignores old replies after switching',async()=>{
  let first=true;
  const h=videoHarness(async(_url,{signal})=>({ok:true,body:{getReader:()=>({
    read:async()=>{if(first){first=false;return {done:false,value:new Uint8Array([255,216,1,255,217])};}return abortable(signal);},releaseLock(){}})}}));
  h.monitor.start('http://video','/camera/color/image_raw');await flush();
  assert.equal(h.states.at(-1).state,'ONLINE');assert.match(h.image.src,/^blob:/);
  h.tick();await flush();assert.equal(h.states.at(-1).state,'STALLED');h.monitor.stop();
  const resolvers=[],late=videoHarness(()=>new Promise(resolve=>resolvers.push(resolve)));
  late.monitor.start('http://old');late.monitor.start('http://new');
  let canceled=false;resolvers[0]({ok:true,body:{cancel:async()=>{canceled=true;}}});await flush();
  assert.equal(canceled,true);assert.equal(late.states.at(-1).url,'http://new/stream?topic=/detected_image');late.monitor.stop();
});
test('legacy server without CORS retains image compatibility and reports failed loading',async()=>{
  const h=videoHarness(async()=>{throw new TypeError('Failed to fetch');});
  h.monitor.start('http://legacy');await flush();
  assert.equal(h.states.at(-1).state,'UNVERIFIED');assert.match(h.image.src,/http:\/\/legacy/);
  h.image.onerror();assert.equal(h.states.at(-1).state,'UNREACHABLE');h.monitor.stop();
});

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
