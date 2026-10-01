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
let api = createNavigationApi({ baseUrl: read(KEYS.service) || '' });
// Reserved adapter entry; nothing calls connect/start/pause in this page shell.
let unsubscribe = api.subscribeStatus(() => {});
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
    unsubscribe = api.subscribeStatus(() => {});
    $('settingsDialog').close();
    log(baseUrl ? '导航服务地址已保存。接口待接入，仍保持离线。' : '已清空导航服务地址。');
  } catch (error) { $('settingsError').textContent = error.message; }
});
$('clearLog').addEventListener('click', () => { $('operationLog').replaceChildren(); log('本地操作记录已清空。'); });
log('导航页面已加载。小车接口尚未接入，所有实车操作保持禁用。');
