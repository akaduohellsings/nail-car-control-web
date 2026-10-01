/** Read-only v1 navigation status. Commands remain unavailable. */
export class NavigationNotConnectedError extends Error {
  constructor() { super('本阶段只读，未向小车发送控制命令'); this.name = 'NavigationNotConnectedError'; }
}
const statusFields = ['schema_version','mode','source_instance_id','sequence','observed_at_ros_ns',
  'state','saved_goal','target_event_id','attempt','max_attempts','alarm','pending','cleaning_mode',
  'stationary_confirmed','halt_state','owned_goal_id','goal_response_pending','action_server_ready'];
const states = ['IDLE','NAV_STARTING','NAVIGATING','CANCELING','WAIT_STOP','CLEANING','VERIFYING','RESUMING','PAUSED','FAULT'];
export function validateEnvelope(data) {
  const invalid = () => { throw new Error('导航状态格式不符合 v1 接口'); };
  if (!data || data.schema_version !== 1 || data.read_only !== true || typeof data.bridge_instance_id !== 'string'
      || !['ONLINE','WAITING','STALE','INVALID','CONFLICT'].includes(data.connection)
      || !Number.isFinite(data.stale_after_seconds) || data.stale_after_seconds <= 0
      || !(data.age_seconds === null || (Number.isFinite(data.age_seconds) && data.age_seconds >= 0))) invalid();
  const s = data.mission;
  if (s !== null) {
    if (!s || Object.keys(s).length !== statusFields.length || statusFields.some(key => !(key in s))
        || s.schema_version !== 1 || !['mock','nav2_with_mock_cleaning'].includes(s.mode)
        || !states.includes(s.state) || s.cleaning_mode !== 'mock'
        || typeof s.source_instance_id !== 'string' || !s.source_instance_id
        || typeof s.observed_at_ros_ns !== 'string' || !/^\d+$/.test(s.observed_at_ros_ns)
        || ['sequence','attempt','max_attempts'].some(key => !Number.isSafeInteger(s[key]) || s[key] < 0)
        || s.max_attempts < 1 || s.max_attempts > 3 || s.attempt > s.max_attempts
        || ['stationary_confirmed','goal_response_pending','action_server_ready'].some(key => s[key] !== null && typeof s[key] !== 'boolean')
        || ['target_event_id','alarm','halt_state','owned_goal_id'].some(key => s[key] !== null && typeof s[key] !== 'string')) invalid();
    if (s.saved_goal !== null && (Object.keys(s.saved_goal).sort().join() !== 'x,y,yaw_deg'
        || Object.values(s.saved_goal).some(v => typeof v !== 'number' || !Number.isFinite(v)))) invalid();
    if (s.pending !== null && (!s.pending || Object.keys(s.pending).sort().join() !== 'operation,request_id'
        || !['navigate','cancel','stop','clean','verify'].includes(s.pending.operation)
        || typeof s.pending.request_id !== 'string' || !s.pending.request_id)) invalid();
  }
  if (data.connection === 'ONLINE' && (!s || data.age_seconds === null || data.age_seconds > data.stale_after_seconds)) invalid();
  return data;
}

export function createNavigationApi({ baseUrl = '' } = {}) {
  const unavailable = async () => { throw new NavigationNotConnectedError(); };
  let running = false, timer = null, controller = null, generation = 0;
  const listeners = new Set();
  const emit = value => { for (const listener of listeners) listener(value); };
  async function getStatus() {
    if (!baseUrl) throw new Error('请先填写导航服务地址');
    const url = new URL(baseUrl);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('导航服务地址无效');
    const ownController = new AbortController(); controller = ownController;
    const timeout = setTimeout(() => ownController.abort(), 1800);
    try {
      const response = await fetch(baseUrl.replace(/\/$/,'') + '/api/v1/status',
        {method:'GET',cache:'no-store',signal:ownController.signal});
      if (!response.ok) throw new Error('状态服务响应异常：' + response.status);
      return validateEnvelope(await response.json());
    } finally { clearTimeout(timeout); if (controller === ownController) controller = null; }
  }
  async function poll(epoch) {
    try { const data = await getStatus(); if (running && epoch === generation) emit(data); }
    catch (error) { if (running && epoch === generation) emit({connection:'UNREACHABLE',mission:null,error:error.message}); }
    finally { if (running && epoch === generation) timer = setTimeout(() => poll(epoch), 800); }
  }
  function disconnect() {
    running = false; generation++; clearTimeout(timer); controller?.abort();
    emit({connection:'DISCONNECTED',mission:null});
  }
  return Object.freeze({
    baseUrl,
    implemented: false,
    readOnly: true,
    async connect() { if (!baseUrl) throw new Error('请先填写导航服务地址'); if (!running) {running=true; await poll(++generation);} },
    getStatus,
    getMap: unavailable,
    start: unavailable,          // {request_id, map_id, goal: {x, y, yaw_deg}}
    pause: unavailable,          // {request_id}
    resume: unavailable,         // {request_id}
    reset: unavailable,          // {request_id}
    requestManual: unavailable,  // {request_id, control_epoch}
    releaseManual: unavailable, // {request_id, control_epoch}
    stop: unavailable,          // Cancel manual intent and pause mission; await confirmation.
    subscribeStatus(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    disconnect,
  });
}
