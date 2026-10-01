import { createNavigationApi, controlPolicy } from './navigation-api.js';

const $ = (id) => document.getElementById(id);
const KEYS = { goal: 'nail.navigation.goalDraft.v1', service: 'nail.navigation.serviceUrl.v1' };
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
const stateLabels = {IDLE:'待命',NAV_STARTING:'等待导航接受',NAVIGATING:'导航中',CANCELING:'取消导航中',
  WAIT_STOP:'等待停车确认',CLEANING:'清理中',VERIFYING:'复查中',RESUMING:'恢复导航中',PAUSED:'已暂停',FAULT:'故障'};
const connectionLabels = {ONLINE:'任务状态在线',WAITING:'服务在线 · 等待任务',STALE:'任务状态已过期',
  INVALID:'状态格式异常',CONFLICT:'多个任务节点冲突',UNREACHABLE:'状态服务不可达',DISCONNECTED:'未连接状态服务'};
let lastFeedback = '', currentStatus=null, pendingUi=null, manualHold=null, manualTimer=null;
const operationNames={start:'开始导航',pause:'暂停任务',resume:'恢复导航',reset:'重置任务',
  request_manual:'申请手动接管',release_manual:'结束手动接管',stop:'停止并暂停'};
const phaseNames={READY:'就绪',NAV_STARTING:'等待导航接受',HALTING:'取消导航 / 等待停车',
  MANUAL_READY:'手动接管已确认',PAUSED:'已停车，等待明确操作',FAULT:'停止未确认或任务故障'};
const ownerNames={none:'未分配',automatic:'自动任务',manual:'手动控制',blocked:'暂不允许控制'};
function validInputs(){return ['goalX','goalY','goalYaw'].every(id=>$(id).value.trim()&&Number.isFinite($(id).valueAsNumber));}
function updateControls(){
  const p=controlPolicy(currentStatus,api.sessionId,api.controlAvailable);
  for(const action of ['start','pause','resume','reset','requestManual','releaseManual','stop']){
    $(action+'Button').disabled=!p[action] || (action!=='stop'&&!!pendingUi) || (action==='start'&&!validInputs());
  }
  for(const button of document.querySelectorAll('[data-direction]'))button.disabled=!p.manualIntent||!!pendingUi;
  if(!p.manualIntent&&manualHold)stopManual(false);
}
function showResult(result){
  const name=operationNames[result.command]||'操作';
  const texts={pending:'已接收，等待状态确认',succeeded:result.command==='start'||result.command==='resume'?'导航已接受（模拟）':'已完成（模拟）',
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
  const online = data.connection === 'ONLINE', s = data.mission;
  $('connectionText').textContent = connectionLabels[data.connection] || '状态未知';
  document.querySelector('.connection i').style.background = online ? '#6cbd9c' : '#d5ad62';
  $('taskBadge').textContent = online ? '实时' : (data.connection === 'STALE' ? '已过期' : '未确认');
  $('modeNotice').textContent = s ? (s.mode === 'mock' ? '模拟任务 · 只读' : '真实导航适配 · 清理模拟') : '只读状态';
  const c=data.control;
  if(data.read_only===false)$('modeNotice').textContent='本地模拟 · 所有移动与停车均模拟';
  $('controlOwner').textContent=online&&c?ownerNames[c.owner]:'未确认';
  $('controlPhase').textContent=online&&c?phaseNames[c.phase]:'—';
  $('controllerPage').textContent=online&&c?(c.controller_id===null?'未占用':c.controller_id===api.sessionId?'本页':'其他页面'):'—';
  $('takeoverStatus').textContent=online&&c?phaseNames[c.phase]:'实车接口只读，控制权未确认';
  const directions={stop:'停止',forward:'前进',backward:'后退',left:'左转',right:'右转'};
  $('manualIntentState').textContent='模拟意图：'+(online&&c?directions[c.manual_direction]:'未确认');
  if(pendingUi&&c?.command_result?.request_id===pendingUi.request_id&&c.command_result.bridge_instance_id===pendingUi.bridge){
    showResult(c.command_result);
  }
  $('missionMode').textContent = s ? (s.mode === 'mock' ? '模拟' : '真实导航 / 模拟清理') : '—';
  $('missionState').textContent = s ? (stateLabels[s.state] + (online ? '' : '（最后状态）')) : '—';
  $('missionGoal').textContent = s?.saved_goal ? `(${s.saved_goal.x}, ${s.saved_goal.y}) 米 · ${s.saved_goal.yaw_deg}°` : '—';
  $('stationaryState').textContent = !online ? '未确认（数据不可用）' :
    (s.stationary_confirmed === null ? '未提供（模拟）' : s.stationary_confirmed ? '已确认' : '未确认');
  $('actionReady').textContent = !online ? '未确认' :
    (s.action_server_ready === null ? '未提供（模拟）' : s.action_server_ready ? '已就绪' : '未就绪');
  const haltLabels = {NONE:'未请求停车',CANCELING:'取消中',VERIFYING_STOP:'核实停车中',CONFIRMED:'已确认',UNCONFIRMED:'未确认'};
  $('haltState').textContent = online && s?.halt_state ? (haltLabels[s.halt_state] || s.halt_state) : '—';
  $('cleaningMode').textContent = s ? '模拟' : '—';
  $('attemptState').textContent = s ? `${s.attempt} / ${s.max_attempts}` : '—';
  $('missionAlarm').textContent = s ? (s.alarm || '无') : '—';
  $('missionAlarm').style.color = s?.alarm ? '#e98a91' : '';
  $('statusSequence').textContent = s ? String(s.sequence) : '—';
  try { $('statusTime').textContent = s ? new Date(Number(BigInt(s.observed_at_ros_ns) / 1000000n)).toLocaleTimeString('zh-CN') + (online ? '' : '（过期）') : '—'; }
  catch { $('statusTime').textContent = '时间格式异常'; }
  const feedback = [data.connection,s?.source_instance_id,s?.state,s?.alarm].join('|');
  if (feedback !== lastFeedback) {
    log(`${connectionLabels[data.connection] || '状态未知'}${s ? '：'+(s.mode==='mock'?'模拟':'真实适配')+' · '+stateLabels[s.state] : ''}${data.error ? '。'+data.error : ''}`,
      ['UNREACHABLE','INVALID','CONFLICT'].includes(data.connection));
    lastFeedback = feedback;
  }
  updateControls();
}
let api = createNavigationApi({ baseUrl: read(KEYS.service) || (['8091','8093'].includes(location.port) ? location.origin : '') });
let unsubscribe = api.subscribeStatus(renderStatus);
function resetConnection() {
  stopManual(false);
  $('commandFeedback').textContent=pendingUi?'连接已断开，上一操作结果未确认。':'尚未发送操作';
  pendingUi=null;
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
  if(!validInputs())return;
  void submitOperation('start',{map_id:currentStatus?.control?.map_id,
    goal:parseGoal({x:$('goalX').valueAsNumber,y:$('goalY').valueAsNumber,yaw_deg:$('goalYaw').valueAsNumber})});
});
for(const name of ['pause','resume','reset','requestManual','releaseManual','stop']){
  $(name+'Button').addEventListener('click',()=>void submitOperation(name));
}
for(const id of ['goalX','goalY','goalYaw'])$(id).addEventListener('input',updateControls);
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
      if(result.status!=='succeeded')throw new Error(result.reason||'模拟方向请求失败');
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
function abandonControl(){
  stopManual(false);
  if(currentStatus?.control?.controller_id===api.sessionId)void api.stop().catch(()=>{});
}
window.addEventListener('blur',abandonControl);
document.addEventListener('visibilitychange',()=>{if(document.hidden)abandonControl();});
try {
  const saved = read(KEYS.goal);
  if (saved) {
    const goal = parseGoal(JSON.parse(saved));
    $('goalX').value = goal.x; $('goalY').value = goal.y; $('goalYaw').value = goal.yaw_deg;
    $('draftStatus').textContent = '已恢复本地目标草稿，尚未发送';
  }
} catch { log('已有目标草稿无法读取，请重新填写。', true); }
$('goalForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = [$('goalX'), $('goalY'), $('goalYaw')];
  if (!fields.every((input) => input.value.trim() && Number.isFinite(input.valueAsNumber))) {
    log('请填写有效的 X、Y 和目标朝向。', true); return;
  }
  const goal = parseGoal({ x: fields[0].valueAsNumber, y: fields[1].valueAsNumber, yaw_deg: fields[2].valueAsNumber });
  if (!save(KEYS.goal, JSON.stringify(goal))) return;
  $('draftStatus').textContent = `草稿已保存：(${goal.x}, ${goal.y}) · ${goal.yaw_deg}°`;
  log(`保存目标草稿：X ${goal.x} 米，Y ${goal.y} 米，朝向 ${goal.yaw_deg}°。未发送。`);
});
$('clearDraft').addEventListener('click', () => {
  try { localStorage.removeItem(KEYS.goal); }
  catch { log('无法清除已保存的草稿，请检查浏览器存储权限。', true); return; }
  $('goalForm').reset(); $('draftStatus').textContent = '尚未保存目标草稿'; log('已清空本地目标草稿。');
});
$('settingsButton').addEventListener('click', () => {
  $('serviceUrl').value = api.baseUrl; $('settingsError').textContent = ''; $('settingsDialog').showModal();
});
$('closeSettings').addEventListener('click', () => $('settingsDialog').close());
$('settingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  let baseUrl = $('serviceUrl').value.trim();
  try {
    if (baseUrl) {
      const parsed = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('请输入不含凭据、查询参数或片段的 HTTP/HTTPS 服务地址');
      }
      baseUrl = parsed.href.replace(/\/$/, '');
    }
    if (!save(KEYS.service, baseUrl)) return;
    unsubscribe(); api.disconnect();
    api = createNavigationApi({ baseUrl });
    unsubscribe = api.subscribeStatus(renderStatus);
    resetConnection();
    $('settingsDialog').close();
    log(baseUrl ? '导航服务地址已保存。点击连接任务服务开始读取。' : '已清空导航服务地址。');
  } catch (error) { $('settingsError').textContent = error.message; }
});
$('clearLog').addEventListener('click', () => { $('operationLog').replaceChildren(); log('本地操作记录已清空。'); });
log('导航页面已加载。实车接口只读，控制操作仅限本地模拟服务。');
