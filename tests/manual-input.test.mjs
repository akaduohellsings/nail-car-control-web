import test from 'node:test';
import assert from 'node:assert/strict';
import {bindManualInput} from '../manual-input.js';
class Button extends EventTarget {constructor(cmd){super();this.dataset={cmd};}setPointerCapture(){}}
const press = () => Object.assign(new Event('pointerdown',{cancelable:true}),{button:0,pointerId:1});
test('blur and pointer cancellation stop a hold; page return never restarts it', async()=>{
  const button=new Button('forward'),doc=new EventTarget(),win=new EventTarget(),calls=[];
  const control=bindManualInput({buttons:[button],canMove:()=>true,move:async()=>calls.push('move'),stop:()=>calls.push('stop'),documentRef:doc,windowRef:win});
  button.dispatchEvent(press());await Promise.resolve();win.dispatchEvent(new Event('blur'));
  assert.deepEqual(calls,['move','stop']);assert.equal(control.holding,false);
  button.dispatchEvent(new Event('pointerup'));assert.equal(calls.length,2);
  button.dispatchEvent(press());button.dispatchEvent(new Event('pointercancel'));
  assert.deepEqual(calls,['move','stop','move','stop']);
});
test('Stop requests a full pause even when no direction is held',()=>{
  const button=new Button('stop'),calls=[];
  bindManualInput({buttons:[button],canMove:()=>false,move:()=>calls.push('move'),stop:()=>calls.push('release'),stopAll:()=>calls.push('pause'),documentRef:new EventTarget(),windowRef:new EventTarget()});
  button.dispatchEvent(press());assert.deepEqual(calls,['pause']);
});
test('release during a pending HTTP move prevents another repeat',async()=>{
  const button=new Button('forward'),calls=[];let resolve;
  const control=bindManualInput({buttons:[button],canMove:()=>true,move:()=>{calls.push('move');return new Promise(done=>resolve=done);},stop:()=>calls.push('stop'),repeat:()=>true,documentRef:new EventTarget(),windowRef:new EventTarget()});
  button.dispatchEvent(press());control.cancel();resolve();await new Promise(done=>setTimeout(done,180));
  assert.deepEqual(calls,['move','stop']);
});
