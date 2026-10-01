import { createNavigationApi } from './navigation-api.js';

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
let lastFeedback = '';
function renderStatus(data) {
  const online = data.connection === 'ONLINE', s = data.mission;
  $('connectionText').textContent = connectionLabels[data.connection] || '状态未知';
  document.querySelector('.connection i').style.background = online ? '#6cbd9c' : '#d5ad62';
  $('taskBadge').textContent = online ? '实时' : (data.connection === 'STALE' ? '已过期' : '未确认');
  $('modeNotice').textContent = s ? (s.mode === 'mock' ? '模拟任务 · 只读' : '真实导航适配 · 清理模拟') : '只读状态';
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
}
let api = createNavigationApi({ baseUrl: read(KEYS.service) || (location.port === '8091' ? location.origin : '') });
let unsubscribe = api.subscribeStatus(renderStatus);
function resetConnection() {
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
    log(baseUrl ? '导航服务地址已保存。点击连接只读状态开始读取。' : '已清空导航服务地址。');
  } catch (error) { $('settingsError').textContent = error.message; }
});
$('clearLog').addEventListener('click', () => { $('operationLog').replaceChildren(); log('本地操作记录已清空。'); });
log('导航页面已加载。只读状态可连接，所有运动操作保持禁用。');
