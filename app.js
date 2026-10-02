import {loadConfig} from './connection-config.js';
import {installSettings} from './connection-settings.js';
import {createNavigationApi, controlPolicy} from './navigation-api.js';
import {stateLabels, connectionLabels} from './task-labels.js';
import {bindManualInput} from './manual-input.js';

const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('[data-cmd]')];
const now = () => new Date().toLocaleTimeString('zh-CN', {hour12:false});
const CMD_LABELS={forward:'前进',backward:'后退',left:'左转',right:'右转',left_forward:'左前',
  right_forward:'右前',left_backward:'左后',right_backward:'右后',stop:'停止'};
let config=loadConfig(), api=createNavigationApi({baseUrl:config.navigationUrl});
let task=null, standaloneEnabled=false, pending=null, lastTask='', input;

function span(cls,text){const element=document.createElement('span');element.className=cls;element.textContent=text;return element;}
function addMessage(type,text){
  const tags={system:'系统',cmd:'命令',event:'事件'}, item=document.createElement('div');
  item.className='message '+({cmd:'msg-sent',event:'msg-received'}[type]||'msg-system');
  item.append(span('msg-time',now()),span('msg-tag tag-'+type,tags[type]||tags.system),span('msg-text',text));
  $('messagesList').append(item);
  while($('messagesList').children.length>100)$('messagesList').firstChild.remove();
  $('messagesList').scrollTop=$('messagesList').scrollHeight;
}
function addEvent(icon,text,type='nail'){
  const item=document.createElement('li');item.className='event-item event-'+type;
  item.append(span('event-icon',icon),span('event-text',text),span('event-time',now()));
  $('eventsList').append(item);
  while($('eventsList').children.length>50)$('eventsList').firstChild.remove();
  $('eventsList').scrollTop=$('eventsList').scrollHeight;
  addMessage('event','小车上报：'+text);
}
window.addMessage=addMessage;window.addEvent=addEvent;
function status(text,level='yellow'){
  $('statusDot').className='status-dot status-dot--'+level;$('statusText').textContent=text;
}
function policy(){return controlPolicy(task,api.sessionId,api.controlAvailable);}
function navigationBlocksStandalone(){
  return task?.connection==='ONLINE' && task.mission &&
    (task.mission.mode==='nav2_with_mock_cleaning' || task.mission.state!=='IDLE' ||
      task.control?.owner==='automatic' || task.control?.owner==='manual' || task.control?.owner==='blocked');
}
function canMove(direction){
  if(config.manualMode==='coordinated')return !pending&&policy().manualIntent&&['forward','backward','left','right'].includes(direction);
  return standaloneEnabled&&!navigationBlocksStandalone();
}
function updateControls(){
  const coordinated=config.manualMode==='coordinated', p=policy();
  $('enableManualButton').hidden=coordinated;
  $('enableManualButton').disabled=navigationBlocksStandalone();
  $('enableManualButton').textContent=standaloneEnabled?'关闭独立手动':'启用独立手动（导航须关闭）';
  $('requestManualButton').hidden=!coordinated;$('releaseManualButton').hidden=!coordinated;
  $('requestManualButton').disabled=!p.requestManual||!!pending;
  $('releaseManualButton').disabled=!p.releaseManual||!!pending;
  for(const button of buttons)button.disabled=button.dataset.cmd==='stop'?false:!canMove(button.dataset.cmd);
  if(input?.holding&&!canMove('forward'))input.cancel();
  if(coordinated)status(p.manualIntent?'本地模拟 · 手动接管已确认':'任务协调 · 等待接管',p.manualIntent?'green':'yellow');
  else status(standaloneEnabled?'独立手动已启用 · 不代表停车确认':'独立手动未启用');
}
function showReceipt(receipt){
  const labels={pending:'已接收，等待后台确认',succeeded:'已完成（模拟）',failed:'失败',rejected:'被拒绝'};
  $('controlFeedback').textContent=labels[receipt.status]+(receipt.reason?' · '+receipt.reason:'');
  if(receipt.status!=='pending'){
    pending=null;addMessage('system',$('controlFeedback').textContent);
  }
}
function renderTask(data){
  task=data;
  if(pending&&data.bridge_instance_id&&pending.bridge!==data.bridge_instance_id){
    pending=null;$('controlFeedback').textContent='服务已重启，上一操作结果未确认。';
  }
  const s=data.mission, online=data.connection==='ONLINE';
  const mode=s?(s.mode==='mock'?'模拟任务':'真实导航 · 清理模拟'):'';
  $('taskSummary').textContent=(connectionLabels[data.connection]||'状态未知')+
    (s?` · ${mode} · ${stateLabels[s.state]}${online?'':'（最后状态）'}`:'');
  $('taskSummary').title=online?`停车确认：${s.stationary_confirmed===true?'已确认':'未确认'}`:'数据不可用，停车未确认';
  if(navigationBlocksStandalone()&&standaloneEnabled){input.cancel();standaloneEnabled=false;}
  const receipt=data.control?.command_result;
  if(pending&&receipt?.request_id===pending.id&&receipt.bridge_instance_id===pending.bridge)showReceipt(receipt);
  const key=[data.connection,s?.state,s?.source_instance_id].join('|');
  if(key!==lastTask){addMessage('system',$('taskSummary').textContent);lastTask=key;}
  updateControls();
}
let unsubscribe=api.subscribeStatus(renderTask);
async function legacyCommand(direction,baseUrl=config.controlUrl){
  const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),1800);
  try{
    const response=await fetch(`${baseUrl}/cmd?move=${encodeURIComponent(direction)}`,{cache:'no-store',signal:abort.signal});
    if(!response.ok)throw new Error('控制服务返回 '+response.status);
    addMessage('cmd',`请求已接收：${CMD_LABELS[direction]}（实际动作未确认）`);
  }finally{clearTimeout(timer);}
}
async function stop(){
  if(config.manualMode==='coordinated'){
    if(api.implemented){const result=await api.stop();showReceipt(result);}
    else throw new Error('协调服务未连接或仅支持只读，无法请求停车');
  }else await legacyCommand('stop');
}
input=bindManualInput({buttons,canMove,stopAll:stop,repeat:()=>config.manualMode==='coordinated',
  move:async direction=>{
    if(config.manualMode==='coordinated'){
      const receipt=await api.manualIntent({direction});
      if(receipt.status!=='succeeded')throw new Error(receipt.reason||'模拟方向未被接受');
    }else await legacyCommand(direction);
  },stop:()=>config.manualMode==='coordinated'&&api.controlAvailable?
    api.manualIntent({direction:'stop'}).then(receipt=>{if(receipt.status!=='succeeded')return stop();}).catch(()=>stop()):stop(),
  onError:error=>{standaloneEnabled=false;addMessage('system','控制结果未确认：'+error.message);updateControls();}
});
async function operation(method){
  input.cancel();const selected=api,id=crypto.randomUUID();pending={id,bridge:task?.bridge_instance_id};updateControls();
  try{
    const result=await selected[method]({request_id:id});
    if(selected===api&&pending?.id===id){showReceipt(result);updateControls();}
  }catch(error){if(selected===api){$('controlFeedback').textContent='结果未确认：'+error.message;updateControls();}}
}
$('requestManualButton').addEventListener('click',()=>void operation('requestManual'));
$('releaseManualButton').addEventListener('click',()=>void operation('releaseManual'));
$('connectTaskButton').addEventListener('click',()=>{
  void api.connect().catch(error=>addMessage('system',error.message));
});
$('enableManualButton').addEventListener('click',()=>{
  input.cancel();standaloneEnabled=!standaloneEnabled;
  $('controlFeedback').textContent=standaloneEnabled?'独立手动已启用；仅在导航关闭时使用。':'独立手动已关闭。';updateControls();
});
function applyConfig(value){
  input.cancel();standaloneEnabled=false;pending=null;unsubscribe();api.disconnect();config=value;
  api=createNavigationApi({baseUrl:config.navigationUrl});unsubscribe=api.subscribeStatus(renderTask);
  renderTask({connection:'DISCONNECTED',mission:null});setVideoAddress();
  addMessage('system','共用连接设置已更新，请重新连接任务状态。');
}
installSettings($('settingsButton'),applyConfig);
function abandon(){
  input.cancel();standaloneEnabled=false;
  if(task?.control?.controller_id===api.sessionId)void api.stop().catch(()=>{});
  updateControls();
}
window.addEventListener('blur',abandon);
document.addEventListener('visibilitychange',()=>{if(document.hidden)abandon();});
window.addEventListener('pagehide',()=>{abandon();unsubscribe();api.disconnect();});

// Video and detection monitoring are independent from control ownership.
function setVideoAddress(){$('cameraImage').src=config.videoUrl+'/stream?topic=/detected_image';}
setVideoAddress();
$('cameraTime').textContent=now();setInterval(()=>$('cameraTime').textContent=now(),1000);
let lastCount=0,lastDetected=false;
setInterval(async()=>{
  try{
    const response=await fetch(config.eventsUrl+'/events');
    if(!response.ok)throw new Error('事件服务异常');
    const data=await response.json();
    if(data.detected&&(!lastDetected||data.count!==lastCount))addEvent('🔩',data.message);
    lastDetected=data.detected;lastCount=data.count;
  }catch{/* The next optimization supplies explicit per-service freshness. */}
},1000);
renderTask({connection:'DISCONNECTED',mission:null});
addMessage('system','手动与导航共用任务状态；切换页面不会自动恢复运动。');
