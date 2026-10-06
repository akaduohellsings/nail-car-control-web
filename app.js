import {createVideoMonitor, createEventMonitor} from './service-monitor.js?v=20261006-video-topic';
import {loadConfig} from './connection-config.js?v=20261006-video-network';
import {installSettings} from './connection-settings.js?v=20261006-manual';
import {createNavigationApi, controlPolicy} from './navigation-api.js?v=20261006-action-demo';
import {parseSpeedInputs} from './navigation-speed.js';
import {stateLabels, connectionLabels} from './task-labels.js';
import {bindManualInput} from './manual-input.js';

const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('[data-cmd]')];
const now = () => new Date().toLocaleTimeString('zh-CN', {hour12:false});
const CMD_LABELS={forward:'前进',backward:'后退',left:'左转',right:'右转',left_forward:'左前',
  right_forward:'右前',left_backward:'左后',right_backward:'右后',stop:'停止'};
let config=loadConfig(), api=createNavigationApi({baseUrl:config.navigationUrl});
let task=null, standaloneEnabled=false, pending=null, lastTask='', input,robotCoordinator=false;
function coordinated(){return robotCoordinator||config.manualMode==='coordinated';}

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
    (['nav2_with_mock_cleaning','nav2_with_image_pickup','nav2_with_motion_demo'].includes(task.mission.mode) || task.mission.state!=='IDLE' ||
      task.control?.owner==='automatic' || task.control?.owner==='manual' || task.control?.owner==='blocked');
}
function canMove(direction){
  if(coordinated())return !pending&&policy().manualIntent&&(task?.capabilities?.manual_control?.directions||['forward','backward','left','right','stop']).includes(direction);
  return standaloneEnabled&&!navigationBlocksStandalone();
}
function updateControls(){
  const useCoordinator=coordinated(), p=policy();
  $('enableManualButton').hidden=useCoordinator;
  $('enableManualButton').disabled=navigationBlocksStandalone();
  $('enableManualButton').textContent=standaloneEnabled?'关闭独立手动':'启用独立手动（导航须关闭）';
  $('requestManualButton').hidden=!useCoordinator;$('releaseManualButton').hidden=!useCoordinator;
  $('requestManualButton').disabled=!p.requestManual||!!pending;
  $('releaseManualButton').disabled=!p.releaseManual||!!pending;
  for(const button of buttons)button.disabled=button.dataset.cmd==='stop'?false:!canMove(button.dataset.cmd);
  if(input?.holding&&!canMove('forward'))input.cancel();
  const real=task?.capabilities?.environment==='robot_navigation';
  for(const id of ['manualLinearSpeed','manualAngularSpeed'])$(id).disabled=p.manual||!!pending;
  const limits=task?.capabilities?.manual_control?.speed_limits||task?.capabilities?.speed_limits;
  $('manualLinearSpeed').max=limits?.linear_max_m_s??.06;
  $('manualAngularSpeed').max=(limits?.angular_max_rad_s??.24)*180/Math.PI;
  if(useCoordinator)status(p.manualIntent?((real?'真实手动 · 接管已确认':'本地模拟 · 手动接管已确认')+
    ' · 方向：'+(CMD_LABELS[task.control.manual_direction]||'未知')):
    (real&&task?.capabilities?.manual_control?.supported!==true?'当前服务未开放手动，请加载新版':'任务协调 · 等待接管'),p.manualIntent?'green':'yellow');
  else status(standaloneEnabled?'独立手动已启用 · 不代表停车确认':'独立手动未启用');
}
function showReceipt(receipt){
  const labels={pending:'已接收，等待后台确认',succeeded:task?.mission?.mode==='mock'?'已完成（模拟）':'已完成',failed:'失败',rejected:'被拒绝'};
  $('controlFeedback').textContent=labels[receipt.status]+(receipt.reason?' · '+receipt.reason:'');
  if(receipt.status!=='pending'){
    pending=null;addMessage('system',$('controlFeedback').textContent);
  }
}
function renderTask(data){
  task=data;
  if(data.capabilities?.environment==='robot_navigation')robotCoordinator=true;
  if(pending&&data.bridge_instance_id&&pending.bridge!==data.bridge_instance_id){
    pending=null;$('controlFeedback').textContent='服务已重启，上一操作结果未确认。';
  }
  const s=data.mission, online=data.connection==='ONLINE';
  const mode=s?(s.mode==='mock'?'模拟任务':s.cleaning_mode==='image_pickup'?'真实导航与拾取':'真实导航'):'';
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
    const response=await fetch(`${baseUrl}/cmd?move=${encodeURIComponent(direction)}`,{cache:'no-store',signal:abort.signal,keepalive:direction==='stop'});
    if(!response.ok)throw new Error('控制服务返回 '+response.status);
    addMessage('cmd',`请求已接收：${CMD_LABELS[direction]}（实际动作未确认）`);
  }finally{clearTimeout(timer);}
}
async function stop(){
  if(coordinated()){
    if(api.implemented){
      const selected=api,id=crypto.randomUUID();pending={id,bridge:task?.bridge_instance_id};updateControls();
      const result=await selected.stop({request_id:id});
      if(selected===api&&pending?.id===id){showReceipt(result);updateControls();}
    }
    else throw new Error('协调服务未连接或仅支持只读，无法请求停车');
  }else await legacyCommand('stop');
}
input=bindManualInput({buttons,canMove,stopAll:stop,repeat:coordinated,
  move:async direction=>{
    if(coordinated()){
      const receipt=await api.manualIntent({direction});
      if(receipt.status!=='succeeded')throw new Error(receipt.reason||'方向指令未被接受');
    }else await legacyCommand(direction);
  },stop:()=>coordinated()&&api.controlAvailable?
    api.manualIntent({direction:'stop'}).then(receipt=>{if(receipt.status!=='succeeded')return stop();}).catch(()=>stop()):stop(),
  onError:error=>{standaloneEnabled=false;addMessage('system','控制结果未确认：'+error.message);updateControls();}
});
async function operation(method){
  let speedLimits;
  if(method==='requestManual'){
    try{speedLimits=parseSpeedInputs(Number($('manualLinearSpeed').value),Number($('manualAngularSpeed').value),
      task?.capabilities?.manual_control?.speed_limits||task?.capabilities?.speed_limits);}
    catch(error){$('controlFeedback').textContent='请求未发送：'+error.message;return;}
  }
  input.cancel(false);const selected=api,id=crypto.randomUUID();pending={id,bridge:task?.bridge_instance_id};updateControls();
  try{
    const payload={request_id:id};
    if(speedLimits)payload.speed_limits=speedLimits;
    const result=await selected[method](payload);
    if(selected===api&&pending?.id===id){showReceipt(result);updateControls();}
  }catch(error){if(selected===api){pending=null;$('controlFeedback').textContent='结果未确认：'+error.message;updateControls();}}
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
  input.cancel();standaloneEnabled=false;pending=null;unsubscribe();api.disconnect();config=value;robotCoordinator=false;
  api=createNavigationApi({baseUrl:config.navigationUrl});unsubscribe=api.subscribeStatus(renderTask);
  renderTask({connection:'DISCONNECTED',mission:null});restartMonitors();
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
window.addEventListener('pagehide',()=>{abandon();unsubscribe();api.disconnect();video.stop();events.stop();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

// Reception timestamps are separate from ROS source freshness and motion status.
let lastEventState='';
const video=createVideoMonitor({image:$('cameraImage'),onStatus:data=>{
  const labels={PAUSED:'画面已暂停',CONNECTING:'正在连接视频',WAITING_FRAMES:'视频已连接 · 等待图像',
    NO_FRAMES:'视频已连接 · 未收到图像',STALLED:'画面中断',UNVERIFIED:'兼容模式 · 帧时间未提供',ONLINE:'正在接收画面',UNREACHABLE:'视频不可用 · 服务未连接'};
  $('videoStatus').textContent=labels[data.state]+(data.retrySeconds?' · '+data.retrySeconds+' 秒后重试':'');
  $('videoStatus').dataset.state=data.state;
  $('cameraTime').textContent=data.receivedAt?'接收 '+new Date(data.receivedAt).toLocaleTimeString('zh-CN',{hour12:false}):'实时性未确认';
  $('videoStatus').title=data.state==='UNVERIFIED'?'旧视频服务未提供可读取的帧时间，无法确认画面是否冻结。':data.error||'';
  const hints={CONNECTING:'连接小车的视频服务，不会发送移动命令。',WAITING_FRAMES:'服务已响应，正在等待所选画面的图像。',
    NO_FRAMES:'检查相机或YOLO输出，可切换到原始画面排查。',STALLED:'已停止更新，正在自动重连。',
    UNREACHABLE:'核对下方地址，并确认已完整启动小车服务；仅打开网页不会启动摄像头。',
    UNVERIFIED:'兼容显示模式可看画面，但无法确认逐帧更新时间。',ONLINE:'图像正在更新。',PAUSED:'页面进入后台时暂停接收，回到本页会重新连接。'};
  $('videoHint').textContent=data.error||hints[data.state]||'';
}});
const events=createEventMonitor({onStatus:data=>{
  const labels={ONLINE:data.sourceFresh===true?'检测源数据新鲜':'检测接口可达 · 源时间未提供',STALE:'检测数据已过期',UNREACHABLE:'检测事件服务不可达'};
  $('detectionStatus').textContent=labels[data.state];
  $('detectionStatus').title=data.receivedAt?'最近接收：'+new Date(data.receivedAt).toLocaleTimeString('zh-CN'):data.error||'';
  if(data.state!==lastEventState){addMessage('system',labels[data.state]);lastEventState=data.state;}
},onEvent:data=>addEvent('🔩',data.message)});
function restartVideo(){
  $('videoEndpoint').textContent=`视频服务：${config.videoUrl} · ${$('videoTopic').selectedOptions[0].textContent}`;
  $('cameraImage').alt=$('videoTopic').value==='/detected_image'?'YOLO检测画面':'相机原始画面';
  if(document.hidden)return;
  video.start(config.videoUrl,$('videoTopic').value);
}
function restartMonitors(){restartVideo();if(!document.hidden)events.start(config.eventsUrl);}
$('videoTopic').addEventListener('change',restartVideo);
$('retryVideoButton').addEventListener('click',()=>video.start(config.videoUrl,$('videoTopic').value));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){video.stop();events.stop();$('detectionStatus').textContent='检测接收已暂停';}
  else restartMonitors();
});
restartMonitors();
renderTask({connection:'DISCONNECTED',mission:null});
addMessage('system','手动与导航共用任务状态；切换页面不会自动恢复运动。');
