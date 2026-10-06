import {stateLabels, connectionLabels} from './task-labels.js';
import {loadConfig} from './connection-config.js?v=20261006-video-network';
import {installSettings} from './connection-settings.js?v=20261006-manual';
import { createNavigationApi, controlPolicy } from './navigation-api.js?v=20261006-action-demo';
import {createMapView} from './navigation-map.js?v=20261006-waypoints';
import {MAX_WAYPOINTS,parseRouteDraft,routeStartPayload,routeActive,routeProgress} from './navigation-route.js';
import {parseSpeedInputs,parseSpeedDraft,speedText} from './navigation-speed.js';

const $ = (id) => document.getElementById(id);
const KEYS = { goal: 'nail.navigation.goalDraft.v1',speed:'nail.navigation.speedDraft.v1',route:'nail.navigation.routeDraft.v1' };
let routeDraft={map_id:'waiting-for-map',goals:[]},routeListKey='',lastRouteFeedback='';
let speedEdited=false,speedPolicyKey='';
const log = (message, error = false) => {
  const item = document.createElement('li');
  if (error) item.className = 'error';
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const text = document.createElement('span');
  text.textContent = message;
  item.append(time, text);
  $('operationLog').prepend(item);
  while ($('operationLog').children.length > 50) $('operationLog').lastChild.remove();
  $('operationLog').scrollTop = 0;
};
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { log('浏览器无法保存本地配置，本次修改未保存。', true); return false; }
}
function parseGoal(value) {
  if (!value || typeof value !== 'object') throw new Error('目标草稿格式错误');
  const goal = {};
  for (const key of ['x', 'y', 'yaw_deg']) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new Error('坐标和朝向必须是有限数字');
    goal[key] = value[key];
  }
  return goal;
}
let lastFeedback = '', currentStatus=null, pendingUi=null, manualHold=null, manualTimer=null;
let loadedMapId=null,mapLoading=false;
const mapView=createMapView(document.querySelector('.map-stage'),point=>{
  $('goalX').value=point.x.toFixed(3);$('goalY').value=point.y.toFixed(3);
  if(!$('goalYaw').value.trim())$('goalYaw').value=currentStatus?.navigation?.robot_pose?Math.round(currentStatus.navigation.robot_pose.yaw*180/Math.PI):0;
  $('draftStatus').textContent='已选地图目标，尚未发送';updateControls();
});
const operationNames={start:'开始导航',pause:'暂停任务',resume:'恢复导航',reset:'重置任务',
  request_manual:'申请手动接管',release_manual:'结束手动接管',stop:'停止并暂停'};
const phaseNames={READY:'就绪',NAV_STARTING:'等待导航接受',HALTING:'取消导航 / 等待停车',
  MANUAL_READY:'手动接管已确认',PAUSED:'已停车，等待明确操作',FAULT:'停止未确认或任务故障'};
const ownerNames={none:'未分配',automatic:'自动任务',manual:'手动控制',blocked:'暂不允许控制'};
function validInputs(){return ['goalX','goalY','goalYaw'].every(id=>$(id).value.trim()&&Number.isFinite($(id).valueAsNumber));}
function speedInputs(){return parseSpeedInputs($('maxLinearSpeed').valueAsNumber,$('maxAngularSpeed').valueAsNumber,currentStatus?.capabilities?.speed_limits);}
function validSpeeds(){try{speedInputs();return true;}catch{return false;}}
function multiMode(){return $('navigationMode').value==='multi';}
function routeReady(){try{routeStartPayload(routeDraft,currentStatus?.control?.map_id,currentStatus?.capabilities?.waypoints);return true;}catch{return false;}}
function renderRoute(){
  const route=currentStatus?.control?.route,locked=routeActive(route)||!!pendingUi;
  $('navigationMode').disabled=locked;
  $('navigationModeTag').textContent=multiMode()?'多点导航':'单点导航';
  $('routeEditor').hidden=!multiMode();
  $('addWaypoint').disabled=locked||!validInputs()||!loadedMapId||routeDraft.goals.length>=MAX_WAYPOINTS;
  $('clearWaypoints').disabled=locked||!routeDraft.goals.length;
  $('routeProgress').textContent=routeProgress(route)+(currentStatus?.connection==='ONLINE'?'':'（最后状态）');
  $('routeHint').textContent=routeDraft.goals.length&&routeDraft.map_id!==loadedMapId
    ?'地图未连接或已切换。请连接原地图，或清空点位后重新选择。'
    :currentStatus?.capabilities?.waypoints?.supported!==true
    ?'当前服务未开放多点导航。可准备草稿，启动更新后的服务再执行。'
    :'选点并设置朝向后，点击“加入当前点”，最多 20 点；每到一点停车确认后继续。';
  const goals=routeActive(route)?route.goals:routeDraft.goals;
  const key=JSON.stringify([goals,locked,route?.state,route?.completed,route?.current_index]);
  if(key===routeListKey)return;routeListKey=key;
  $('waypointList').replaceChildren();
  goals.forEach((goal,index)=>{
    const li=document.createElement('li');
    li.textContent=`(${goal.x.toFixed(3)}, ${goal.y.toFixed(3)}) 米 · ${goal.yaw_deg}°`;
    if(routeActive(route)&&index<route.completed)li.className='completed';
    else if(routeActive(route)&&index===route.current_index)li.className='current';
    const actions=document.createElement('div');actions.className='waypoint-actions';
    for(const [name,text,disabled] of [['up','上移',index===0],['down','下移',index===goals.length-1],['remove','移除',false]]){
      const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=text;
      button.disabled=locked||disabled;button.dataset.waypointAction=name;button.dataset.index=index;
      button.setAttribute('aria-label',`第 ${index+1} 点${text}`);actions.append(button);
    }
    li.append(actions);$('waypointList').append(li);
  });
}
function renderSpeeds(){
  const policy=currentStatus?.capabilities?.speed_limits,key=JSON.stringify(policy??null);
  if(policy&&key!==speedPolicyKey&&!speedEdited){
    $('maxLinearSpeed').value=policy.defaults.linear_m_s;
    $('maxAngularSpeed').value=Math.floor(policy.defaults.angular_rad_s*180/Math.PI*100)/100;
  }
  speedPolicyKey=key;
  $('maxLinearSpeed').max=policy?.linear_max_m_s??.06;
  $('maxAngularSpeed').max=Math.floor((policy?.angular_max_rad_s??.24)*180/Math.PI*100)/100;
  const running=routeActive(currentStatus?.control?.route)||(currentStatus?.connection==='ONLINE'&&currentStatus?.mission&&!['IDLE','PAUSED','FAULT'].includes(currentStatus.mission.state));
  $('maxLinearSpeed').disabled=running;$('maxAngularSpeed').disabled=running;
  let hint=policy?`移动速度上限 ${policy.linear_max_m_s} 米/秒。速度随下一次开始导航生效；暂停、恢复沿用该次设置。`:'可保存速度草稿，连接支持速度设置的导航服务后生效。';
  try{speedInputs();}catch(error){hint=error.message;}
  $('speedHint').textContent=hint;
  const applied=currentStatus?.connection==='ONLINE'?currentStatus?.control?.speed_limits:null;
  $('appliedSpeed').textContent=applied?`本次生效上限：${speedText(applied)}`:'本次生效速度：尚未下发';
}
function updateControls(){
  renderSpeeds();
  renderRoute();
  $('autoPickup').disabled=currentStatus?.connection!=='ONLINE'||currentStatus?.capabilities?.auto_pickup?.supported!==true
    || !['IDLE','PAUSED','FAULT'].includes(currentStatus?.mission?.state)||!!pendingUi;
  const p=controlPolicy(currentStatus,api.sessionId,api.controlAvailable);
  for(const action of ['start','pause','resume','reset','requestManual','releaseManual','stop']){
    $(action+'Button').disabled=!p[action] || (action!=='stop'&&!!pendingUi) || (action==='start'&&(!(multiMode()?routeReady():validInputs())||!validSpeeds()||!currentStatus?.capabilities?.speed_limits));
  }
  for(const button of document.querySelectorAll('[data-direction]'))button.disabled=!p.manualIntent||!!pendingUi;
  if(!p.manualIntent&&manualHold)stopManual(false);
  const online=currentStatus?.connection==='ONLINE';
  mapView.update(online?currentStatus?.navigation?.robot_pose:null,
    validInputs()?{x:$('goalX').valueAsNumber,y:$('goalY').valueAsNumber,yaw_deg:$('goalYaw').valueAsNumber}:null,
    online&&currentStatus?.control?.localization_valid===true,
    online&&routeActive(currentStatus?.control?.route)?currentStatus.control.route.goals:
      multiMode()&&routeDraft.map_id===loadedMapId?routeDraft.goals:[]);
  const pick=document.querySelector('.map-pick');
  pick.disabled=!online||!loadedMapId||currentStatus?.control?.localization_valid!==true;
  pick.querySelector('span').textContent=loadedMapId?'点击地图空白区':'等待地图';
}
function showResult(result){
  const name=result.command==='stop'&&currentStatus?.capabilities?.stop_ends_task?'停止任务':operationNames[result.command]||'操作';
  const suffix=currentStatus?.capabilities?.environment==='local_simulation'||currentStatus?.capabilities?.preview?'（模拟）':'';
  const texts={pending:'已接收，等待状态确认',succeeded:result.command==='start'||result.command==='resume'?'导航已接受'+suffix:'已完成'+suffix,
    failed:'执行失败',rejected:'已拒绝'};
  $('commandFeedback').textContent=`${name}：${texts[result.status]}${result.reason?' · '+result.reason:''}`;
  if(result.status!=='pending'){
    log($('commandFeedback').textContent,['failed','rejected'].includes(result.status));
    pendingUi=null;
  }
}
function renderStatus(data) {
  if(pendingUi&&data.bridge_instance_id&&data.bridge_instance_id!==pendingUi.bridge){
    $('commandFeedback').textContent='服务已重启，上一操作结果未确认，请重新检查状态。';pendingUi=null;
  }
  currentStatus=data;
  document.body.classList.toggle('navigation-preview',data.capabilities?.preview===true);
  const online = data.connection === 'ONLINE', s = data.mission;
  $('connectionText').textContent = connectionLabels[data.connection] || '状态未知';
  document.querySelector('.connection i').style.background = online ? '#6cbd9c' : '#d5ad62';
  $('taskBadge').textContent = online ? '实时' : (data.connection === 'STALE' ? '已过期' : '未确认');
  $('modeNotice').textContent = s ? (s.mode === 'mock' ? '模拟任务 · 只读' : s.cleaning_mode==='motion_demo'?'导航与识别动作测试 · 按勾选开关启用':s.cleaning_mode==='image_pickup'?'真实导航与拾取 · 按勾选开关启用':'真实导航适配 · 清理模拟') : '只读状态';
  const c=data.control;
  if(online&&(!data.navigation?.map_id||data.navigation.map_id==='waiting-for-map')){
    loadedMapId=null;mapView.clear();
  }
  if(online&&data.navigation?.map_id&&data.navigation.map_id!=='waiting-for-map'&&loadedMapId!==data.navigation.map_id&&!mapLoading){
    mapLoading=true;const selectedApi=api,expected=data.navigation.map_id;
    void api.getMap().then(map=>{
      if(api!==selectedApi||currentStatus?.connection!=='ONLINE'||currentStatus?.navigation?.map_id!==expected)return;
      if(!map)return;
      if(map?.map_id!==expected)throw new Error('地图已切换，正在等待最新地图');
      mapView.setMap(map);loadedMapId=map.map_id;updateControls();
    }).catch(error=>log(error.message,true)).finally(()=>{mapLoading=false;});
  }
  const details=document.querySelectorAll('.map-details strong');
  if(data.capabilities?.environment==='robot_navigation'||loadedMapId){
    const pose=online?data.navigation?.robot_pose:null;
    details[0].textContent=pose?`(${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}) 米`:'未确认';
    details[1].textContent=pose?`${(pose.yaw*180/Math.PI).toFixed(1)}°`:'—';
    details[2].textContent=online&&c?.localization_valid?'可用':'未确认';
    details[3].textContent=online?new Date().toLocaleTimeString('zh-CN',{hour12:false}):'已过期';
    document.querySelector('.map-footer>span').textContent='坐标系：map';
    document.querySelector('.map-card .card-heading p').textContent=online&&c?.localization_valid?'地图已连接 / 定位可用':'定位未确认';
  }
  $('stopButton').textContent=data.capabilities?.stop_ends_task?'停止任务':'停止并暂停任务';
  $('startButton').querySelector('span').textContent=data.capabilities?.environment==='robot_navigation'?'真实导航':'等待服务就绪';
  if(data.capabilities?.preview)$('startButton').querySelector('span').textContent='模拟反馈';
  if(data.read_only===false)$('modeNotice').textContent=data.capabilities?.preview?'接口预览 · 地图与导航反馈均模拟':data.capabilities?.environment==='robot_navigation'
    ?(data.capabilities?.continuous_testing?(data.capabilities?.retry_after_navigation_abort?'真实单点导航 · 连续测试：到达或普通导航失败并确认停车后，可选下一点开始':'真实单点导航 · 连续测试：到达后可直接选下一点，失败后停止并重置'):'真实单点导航 · 拾取未启用'):'本地模拟 · 所有移动与停车均模拟';
  if(data.capabilities?.waypoints?.supported&&data.read_only===false&&!data.capabilities.preview)$('modeNotice').textContent=data.capabilities.environment==='robot_navigation'
    ?'真实导航 · 支持多点顺序执行；故障中断队列，暂停后需明确恢复':'本地模拟 · 支持多点队列，移动与停车均模拟';
  if(data.capabilities?.preview)$('modeNotice').textContent='接口预览 · 所有位置与动作反馈均模拟';
  $('controlOwner').textContent=online&&c?ownerNames[c.owner]:'未确认';
  $('controlPhase').textContent=online&&c?phaseNames[c.phase]:'—';
  $('controllerPage').textContent=online&&c?(c.controller_id===null?'未占用':c.controller_id===api.sessionId?'本页':'其他页面'):'—';
  $('takeoverStatus').textContent=online&&c?phaseNames[c.phase]:'实车接口只读，控制权未确认';
  const directions={stop:'停止',forward:'前进',backward:'后退',left:'左转',right:'右转'};
  const realManual=data.capabilities?.environment==='robot_navigation'&&!data.capabilities?.preview;
  document.querySelector('.manual-panel>p').firstChild.textContent=(realManual?'手动方向控制':'本地模拟方向控制')+' · 按住发送，松开停止 · ';
  for(const button of document.querySelectorAll('[data-direction]'))button.textContent=(realManual?'':'模拟')+directions[button.dataset.direction];
  $('manualIntentState').textContent=realManual&&data.capabilities?.manual_control?.supported!==true
    ?'当前服务未开放手动接管':(realManual?'请求方向：':'模拟意图：')+(online&&c?directions[c.manual_direction]||'其他方向':'未确认');
  if(pendingUi&&c?.command_result?.request_id===pendingUi.request_id&&c.command_result.bridge_instance_id===pendingUi.bridge){
    showResult(c.command_result);
  }
  const decisionEnabled=online&&data.decision?.auto_pickup_enabled===true;
  const realPickup=data.capabilities?.auto_pickup?.cleaning_mode==='image_pickup';
  const actionDemo=data.capabilities?.auto_pickup?.cleaning_mode==='motion_demo';
  $('autoPickupLabel').textContent=actionDemo?'导航时识别钉子并测试动作（前进 10 cm → 后退 10 cm）':realPickup?'导航时检测钉子并执行真实拾取（车头磁铁 · 28 cm）':'导航时检测钉子并暂停处理（模拟拾取）';
  $('decisionStatus').textContent=actionDemo
    ?(decisionEnabled?'本次已启用：识别 → 停车 → 前进 10 cm → 停车 → 后退 10 cm → 停车 → 恢复原目标。':'勾选后，下一次导航会在识别钉子后测试前进、后退动作。')+' 动作速度 0.04 米/秒；仅验证流程，收集未确认。'
    :realPickup
    ?(decisionEnabled?'本次已启用：检测 → 停车 → 对准接近 → 前进 28 cm → 停车 → 恢复原目标。':'勾选后，下一次导航会触发真实拾取动作。')+' 拾取速度上限 0.04 m/s；实际吸附需现场确认。'
    :decisionEnabled?'本次已启用：检测 → 停车 → 模拟拾取 → 恢复原目标；收集未确认。'
    :data.capabilities?.auto_pickup?.supported===true?'下一次开始导航可启用检测决策；本轮拾取与复查均为模拟。':'当前服务未开放检测决策；本轮不执行真实拾取。';
  if(decisionEnabled&&data.decision.detection){
    const d=data.decision.detection;
    const reason=d.last_frame_age_seconds===null?'等待检测帧':d.last_frame_age_seconds>1?'检测流已中断':
      ({WAITING_FRAMES:'等待检测帧',NO_NAIL:'未识别到钉子',BELOW_CONFIDENCE:'钉子置信度不足',STALE_FRAME:'检测帧过期',
        FRAME_OUT_OF_ORDER:'重复或乱序帧',WAITING_STABILITY:'检测尚未稳定',WAITING_CLEAR:'等待目标消失，避免重复触发',
        NOT_NAVIGATING:'等待导航进入执行阶段',INVALID_FRAME:'检测格式异常',TRIGGERED:'已触发停车处理'}[d.reason]||d.reason);
    $('decisionStatus').textContent+=` 检测反馈：${reason}；收到 ${d.frames_received} 帧`
      +(d.nail_confidence==null?'':`，置信度 ${(d.nail_confidence*100).toFixed(0)}%`)
      +(d.source_frame_age_seconds==null?'':`，帧龄 ${d.source_frame_age_seconds.toFixed(2)} 秒`)+ '。';
  }
  if(realPickup&&data.decision?.pickup){
    const p=data.decision.pickup;
    const phases={IDLE:'待命',WAIT_TARGET:'等待稳定目标',ARMING:'确认拾取接管',MOVING:'执行拾取',CLEANUP_ACK:'确认清理行程',
      RELEASING:'归还控制权',OBSERVING:'观察目标',TURNING:'对准目标',APPROACHING:'接近目标',READY_TO_CLEAR:'准备清理',
      CLEARING:'前进清理',STOPPING:'确认停车',DONE:'动作完成'};
    const stage=p.phase==='IDLE'?'待命':phases[p.controller_state]||phases[p.phase]||'执行拾取';
    $('decisionStatus').textContent+=` 拾取阶段：${stage}；已完成动作 ${p.action_count} 次。`+(p.error?` 原因：${p.error}。`:'');
  }
  $('missionMode').textContent = s ? (s.mode === 'mock' ? '模拟' : '真实导航 / 模拟清理') : '—';
  if(actionDemo&&data.decision?.action_demo){
    const d=data.decision.action_demo;
    const phases={IDLE:'待命',FORWARD:'前进中',WAIT_FORWARD_STOP:'前进后确认停车',BACKWARD:'后退中',WAIT_BACKWARD_STOP:'后退后确认停车',COMPLETE:'动作已完成',CANCELED:'动作已取消',FAULT:'动作故障'};
    $('decisionStatus').textContent+=` 动作阶段：${phases[d.phase]||'等待动作反馈'}；已完成 ${d.action_count} 次。`
      +(Number.isFinite(d.forward_m)&&Number.isFinite(d.reverse_m)?` 前进 ${(d.forward_m*100).toFixed(1)} cm，后退 ${(d.reverse_m*100).toFixed(1)} cm。`:'')
      +(d.error?` 原因：${d.error}。`:'');
  }
  if(data.capabilities?.environment==='robot_navigation')$('missionMode').textContent=decisionEnabled?(actionDemo?'真实导航 / 识别动作测试':realPickup?'真实导航 / 真实拾取':'真实导航 / 模拟拾取'):(c?.route?'真实多点导航':'真实单点导航');
  if(data.capabilities?.preview)$('missionMode').textContent='导航接口预览（模拟）';
  const arrived=s?.state==='IDLE'&&s.saved_goal&&s.halt_state==='NONE'&&s.owned_goal_id===null&&s.goal_response_pending===false&&s.stationary_confirmed===true;
  const decisionPhase=decisionEnabled?(actionDemo?{CLEANING:'识别动作测试中',VERIFYING:'确认动作与停车'}:realPickup?{CLEANING:'真实拾取中',VERIFYING:'核对动作与停车'}:{CLEANING:'模拟拾取中',VERIFYING:'模拟复查中'})[s?.state]:null;
  $('missionState').textContent = s ? ((arrived?'已到达':decisionPhase||stateLabels[s.state]) + (online ? '' : '（最后状态）')) : '—';
  if(c?.route?.state==='WAITING_STOP')$('missionState').textContent='点位已到达，等待停车确认';
  if(c?.route?.state==='PAUSED')$('missionState').textContent='多点任务已暂停';
  if(c?.route?.state==='COMPLETED')$('missionState').textContent='多点任务全部完成';
  $('missionGoal').textContent = s?.saved_goal ? `(${s.saved_goal.x}, ${s.saved_goal.y}) 米 · ${s.saved_goal.yaw_deg}°` : '—';
  $('stationaryState').textContent = !online ? '未确认（数据不可用）' :
    (s.stationary_confirmed === null ? '未提供（模拟）' : s.stationary_confirmed ? '已确认' : '未确认');
  $('actionReady').textContent = !online ? '未确认' :
    (s.action_server_ready === null ? '未提供（模拟）' : s.action_server_ready ? '已就绪' : '未就绪');
  const haltLabels = {NONE:'未请求停车',CANCELING:'取消中',VERIFYING_STOP:'核实停车中',CONFIRMED:'已确认',UNCONFIRMED:'未确认'};
  $('haltState').textContent = online && s?.halt_state ? (haltLabels[s.halt_state] || s.halt_state) : '—';
  $('cleaningMode').textContent = s ? '模拟' : '—';
  if(data.capabilities?.environment==='robot_navigation')$('cleaningMode').textContent=decisionEnabled?(actionDemo?'前进 / 后退动作测试':realPickup?'真实动作，吸附未确认':'模拟拾取'):'未启用';
  $('attemptState').textContent = s ? `${s.attempt} / ${s.max_attempts}` : '—';
  $('missionAlarm').textContent = s ? (s.alarm || '无') : '—';
  $('missionAlarm').style.color = s?.alarm ? '#e98a91' : '';
  $('statusSequence').textContent = s ? String(s.sequence) : '—';
  try { $('statusTime').textContent = s ? new Date(Number(BigInt(s.observed_at_ros_ns) / 1000000n)).toLocaleTimeString('zh-CN') + (online ? '' : '（过期）') : '—'; }
  catch { $('statusTime').textContent = '时间格式异常'; }
  const feedback = [data.connection,s?.source_instance_id,s?.state,s?.alarm,!!arrived].join('|');
  if (feedback !== lastFeedback) {
    log(`${connectionLabels[data.connection] || '状态未知'}${s ? '：'+(data.capabilities?.preview||s.mode==='mock'?'模拟':'真实适配')+' · '+(arrived?'已到达':decisionPhase||stateLabels[s.state]) : ''}${data.error ? '。'+data.error : ''}`,
      ['UNREACHABLE','INVALID','CONFLICT'].includes(data.connection));
    lastFeedback = feedback;
  }
  const routeFeedback=JSON.stringify([data.bridge_instance_id,c?.route?.state,c?.route?.completed,c?.route?.current_index]);
  if(online&&c?.route&&routeFeedback!==lastRouteFeedback){log('多点导航：'+routeProgress(c.route),c.route.state==='FAILED');lastRouteFeedback=routeFeedback;}
  updateControls();
}
let api = createNavigationApi({ baseUrl: loadConfig().navigationUrl });
document.querySelector('.map-pick').addEventListener('click',()=>{
  document.querySelector('.navigation-map').scrollIntoView({block:'center'});
  $('draftStatus').textContent='点击地图空白区填写目标，再确认坐标和朝向';
});
let unsubscribe = api.subscribeStatus(renderStatus);
function resetConnection() {
  stopManual(false);
  $('commandFeedback').textContent=pendingUi?'连接已断开，上一操作结果未确认。':'尚未发送操作';
  pendingUi=null;
  loadedMapId=null;mapView.clear();
  const details=document.querySelectorAll('.map-details strong');
  ['—','—','未确认','—'].forEach((text,i)=>{details[i].textContent=text;});
  document.querySelector('.map-card .card-heading p').textContent='地图 — / 定位未确认';
  document.querySelector('.map-footer>span').textContent='坐标系：待确认';
  $('connectButton').disabled = false; $('disconnectButton').disabled = true;
  renderStatus({connection:'DISCONNECTED',mission:null});
}
$('connectButton').addEventListener('click', async () => {
  try {
    if (!api.baseUrl) throw new Error('先在连接设置中填写导航服务地址');
    $('connectButton').disabled = true; $('disconnectButton').disabled = false;
    await api.connect();
  } catch (error) { resetConnection(); log(error.message,true); }
});
$('disconnectButton').addEventListener('click', () => { api.disconnect(); resetConnection(); });
window.addEventListener('pagehide', () => { unsubscribe(); api.disconnect(); });
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
async function submitOperation(method, payload={}){
  const selectedApi=api;
  stopManual(false);
  const request_id=crypto.randomUUID();
  pendingUi={request_id,bridge:currentStatus?.bridge_instance_id};
  $('commandFeedback').textContent='正在提交，等待后台接收…';updateControls();
  try{
    const result=await selectedApi[method]({...payload,request_id});
    if(api!==selectedApi||pendingUi?.request_id!==request_id)return;
    showResult(result);updateControls();
  }catch(error){
    if(api!==selectedApi||pendingUi?.request_id!==request_id)return;
    $('commandFeedback').textContent='结果未确认：'+error.message+'。请等待状态或停止任务。';
    log($('commandFeedback').textContent,true);
  }
}
$('startButton').addEventListener('click',()=>{
  if(!(multiMode()?routeReady():validInputs())||!validSpeeds())return;
  void submitOperation('start',{map_id:currentStatus?.control?.map_id,
    speed_limits:speedInputs(),
    ...(currentStatus?.capabilities?.auto_pickup?.supported===true?{auto_pickup:$('autoPickup').checked}:{}),
    ...(multiMode()?routeStartPayload(routeDraft,currentStatus?.control?.map_id,currentStatus?.capabilities?.waypoints):
      {goal:parseGoal({x:$('goalX').valueAsNumber,y:$('goalY').valueAsNumber,yaw_deg:$('goalYaw').valueAsNumber})})});
});
$('navigationMode').addEventListener('change',updateControls);
function saveRoute(next){
  if(save(KEYS.route,JSON.stringify(next))){routeDraft=next;updateControls();}
}
$('addWaypoint').addEventListener('click',()=>{
  if($('addWaypoint').disabled)return;
  if(routeDraft.goals.length&&routeDraft.map_id!==loadedMapId){log('地图已切换，请清空点位后重新选择。',true);return;}
  const goal=parseGoal({x:$('goalX').valueAsNumber,y:$('goalY').valueAsNumber,yaw_deg:$('goalYaw').valueAsNumber});
  saveRoute({map_id:loadedMapId,goals:[...routeDraft.goals,goal]});
});
$('clearWaypoints').addEventListener('click',()=>{if(!$('clearWaypoints').disabled)saveRoute({map_id:loadedMapId||'waiting-for-map',goals:[]});});
$('waypointList').addEventListener('click',event=>{
  const button=event.target.closest('[data-waypoint-action]');if(!button||button.disabled)return;
  const index=Number(button.dataset.index),goals=routeDraft.goals.map(goal=>({...goal}));
  if(button.dataset.waypointAction==='remove')goals.splice(index,1);
  else{const other=index+(button.dataset.waypointAction==='up'?-1:1);[goals[index],goals[other]]=[goals[other],goals[index]];}
  saveRoute({...routeDraft,goals});
});
for(const name of ['pause','resume','reset','requestManual','releaseManual','stop']){
  $(name+'Button').addEventListener('click',()=>void submitOperation(name));
}
for(const id of ['goalX','goalY','goalYaw'])$(id).addEventListener('input',updateControls);
for(const id of ['maxLinearSpeed','maxAngularSpeed'])$(id).addEventListener('input',()=>{speedEdited=true;updateControls();});
function stopManual(sendStop=true){
  const wasHeld=manualHold;manualHold=null;clearTimeout(manualTimer);
  if(wasHeld&&sendStop)void api.manualIntent({direction:'stop'}).catch(()=>api.stop().catch(()=>{}));
}
function beginManual(direction){
  if(manualHold||!controlPolicy(currentStatus,api.sessionId,api.controlAvailable).manualIntent||pendingUi)return;
  const hold={direction};manualHold=hold;
  const selectedApi=api;
  const repeat=async()=>{
    if(manualHold!==hold||selectedApi!==api)return;
    try{
      const result=await selectedApi.manualIntent({direction});
      if(result.status!=='succeeded')throw new Error(result.reason||'方向请求失败');
      if(manualHold===hold)manualTimer=setTimeout(repeat,150);
    }catch(error){stopManual(false);log(error.message,true);void selectedApi.stop().catch(()=>{});}
  };
  void repeat();
}
for(const button of document.querySelectorAll('[data-direction]')){
  button.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();button.setPointerCapture(event.pointerId);beginManual(button.dataset.direction);});
  button.addEventListener('pointerup',()=>stopManual());
  button.addEventListener('pointercancel',()=>stopManual());
  button.addEventListener('lostpointercapture',()=>stopManual());
  button.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)&&!event.repeat){event.preventDefault();beginManual(button.dataset.direction);}});
  button.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();stopManual();}});
}
function abandonControl(reason){
  stopManual(false);
  if(currentStatus?.control?.controller_id===api.sessionId){
    log(reason+'，自动请求停止任务');
    void api.stop().catch(()=>{});
  }
}
window.addEventListener('blur',()=>abandonControl('导航页面失去焦点'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)abandonControl('导航页面进入后台');});
try {
  const savedRoute=read(KEYS.route);
  if(savedRoute)routeDraft=parseRouteDraft(JSON.parse(savedRoute));
} catch{log('已有多点草稿无法读取，请清空后重新选择。',true);}
try {
  const saved = read(KEYS.goal);
  if (saved) {
    const goal = parseGoal(JSON.parse(saved));
    $('goalX').value = goal.x; $('goalY').value = goal.y; $('goalYaw').value = goal.yaw_deg;
    $('draftStatus').textContent = '已恢复本地目标草稿，尚未发送';
  }
} catch { log('已有目标草稿无法读取，请重新填写。', true); }
try{
  const saved=read(KEYS.speed);
  if(saved){const v=JSON.parse(saved);parseSpeedDraft(v);
    $('maxLinearSpeed').value=v.linear_m_s;$('maxAngularSpeed').value=v.angular_deg_s;speedEdited=true;}
}catch{log('已有速度草稿无法读取，请重新填写。',true);}
$('goalForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = [$('goalX'), $('goalY'), $('goalYaw')];
  if (!fields.every((input) => input.value.trim() && Number.isFinite(input.valueAsNumber))) {
    log('请填写有效的 X、Y 和目标朝向。', true); return;
  }
  const goal = parseGoal({ x: fields[0].valueAsNumber, y: fields[1].valueAsNumber, yaw_deg: fields[2].valueAsNumber });
  try{speedInputs();}catch(error){log(error.message,true);return;}
  if (!save(KEYS.goal, JSON.stringify(goal))) return;
  if(!save(KEYS.speed,JSON.stringify({linear_m_s:$('maxLinearSpeed').valueAsNumber,angular_deg_s:$('maxAngularSpeed').valueAsNumber})))return;
  speedEdited=true;
  $('draftStatus').textContent = `草稿已保存：(${goal.x}, ${goal.y}) · ${goal.yaw_deg}°；速度 ${speedText(speedInputs())}`;
  log(`保存目标草稿：X ${goal.x} 米，Y ${goal.y} 米，朝向 ${goal.yaw_deg}°。未发送。`);
});
$('clearDraft').addEventListener('click', () => {
  try { localStorage.removeItem(KEYS.goal); localStorage.removeItem(KEYS.speed); }
  catch { log('无法清除已保存的草稿，请检查浏览器存储权限。', true); return; }
  $('goalForm').reset(); $('draftStatus').textContent = '尚未保存目标草稿'; log('已清空本地目标草稿。');
  speedEdited=false;speedPolicyKey='';updateControls();
});
installSettings($('settingsButton'), config => {
  unsubscribe(); api.disconnect();
  api=createNavigationApi({baseUrl:config.navigationUrl});
  unsubscribe=api.subscribeStatus(renderStatus); resetConnection();
  log('共用连接设置已更新，点击连接任务服务重新获取状态。');
});
$('clearLog').addEventListener('click', () => { $('operationLog').replaceChildren(); log('本地操作记录已清空。'); });
log('导航页面已加载。连接任务服务后，根据导航就绪与停车状态开放操作。');


let recoveryBusy=false;
async function recoveryRequest(path,payload){
  const response=await fetch(path,{method:payload?'POST':'GET',cache:'no-store',
    headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined,
    signal:AbortSignal.timeout(5000)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'本地启动服务不可用');
  return result;
}
async function pollRecovery(){
  try{
    const result=await recoveryRequest('/api/operator/status');
    $('restartServiceStatus').textContent=result.message;
    recoveryBusy=result.status==='starting';
    $('restartServiceButton').disabled=recoveryBusy;
    if(recoveryBusy)setTimeout(pollRecovery,2000);
    else if(result.status==='ready'){
      log('后台服务已重新启动，等待你选点。');
      await api.connect();
    }else if(result.status==='failed')log(result.message,true);
  }catch(error){recoveryBusy=false;$('restartServiceButton').disabled=false;$('restartServiceStatus').textContent=error.message;}
}
$('restartServiceButton').addEventListener('click',()=>{
  if(currentStatus?.connection==='ONLINE'){
    log('导航服务仍在线，可使用重置任务；人工复位前请先结束整套服务。',true);return;
  }
  $('restartOriginConfirmed').checked=false;$('restartServiceDialog').showModal();
});
$('confirmRestartService').addEventListener('click',async()=>{
  if(!$('restartOriginConfirmed').checked){$('restartOriginConfirmed').reportValidity();log('请先完成复位并勾选确认。',true);return;}
  if(recoveryBusy)return;
  try{
    recoveryBusy=true;$('confirmRestartService').disabled=true;
    const config=loadConfig();
    const result=await recoveryRequest('/api/operator/restart',{confirmed_origin:true,expected_host:new URL(config.navigationUrl).hostname});
    $('restartServiceDialog').close();$('restartServiceStatus').textContent=result.message;
    log(result.message);await pollRecovery();
  }catch(error){recoveryBusy=false;log(error.message,true);$('restartServiceStatus').textContent=error.message;}
  finally{$('confirmRestartService').disabled=false;}
});
if(!new URLSearchParams(location.search).has('simulation')&&['localhost','127.0.0.1'].includes(location.hostname)){
  recoveryRequest('/api/operator/status').then(result=>{
    $('restartServiceStatus').textContent=result.message;$('restartServiceButton').disabled=result.status==='starting';
    if(result.status==='starting')void pollRecovery();
  }).catch(()=>{$('restartServiceStatus').textContent='本地启动入口未加载，请重新启动电脑网页服务。';});
}
