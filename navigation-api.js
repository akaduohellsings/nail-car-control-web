/** Task v1 transport. Real navigation requires an explicit navigation capability. */
export class NavigationNotConnectedError extends Error {
  constructor() { super('当前服务未开放导航控制，未向小车发送命令'); this.name = 'NavigationNotConnectedError'; }
}
const statusFields = ['schema_version','mode','source_instance_id','sequence','observed_at_ros_ns',
  'state','saved_goal','target_event_id','attempt','max_attempts','alarm','pending','cleaning_mode',
  'stationary_confirmed','halt_state','owned_goal_id','goal_response_pending','action_server_ready'];
const states = ['IDLE','NAV_STARTING','NAVIGATING','CANCELING','WAIT_STOP','CLEANING','VERIFYING','RESUMING','PAUSED','FAULT'];
export function validateEnvelope(data) {
  const invalid = () => { throw new Error('导航状态格式不符合 v1 接口'); };
  if (!data || data.schema_version !== 1 || typeof data.read_only !== 'boolean' || typeof data.bridge_instance_id !== 'string'
      || !['ONLINE','WAITING','STALE','INVALID','CONFLICT'].includes(data.connection)
      || !Number.isFinite(data.stale_after_seconds) || data.stale_after_seconds <= 0
      || !(data.age_seconds === null || (Number.isFinite(data.age_seconds) && data.age_seconds >= 0))) invalid();
  const s = data.mission;
  if (s !== null) {
    if (!s || Object.keys(s).length !== statusFields.length || statusFields.some(key => !(key in s))
        || s.schema_version !== 1 || !['mock','nav2_with_mock_cleaning','nav2_with_image_pickup'].includes(s.mode)
        || !states.includes(s.state) || !['mock','image_pickup'].includes(s.cleaning_mode)
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
  if(data.navigation!==undefined){
    const n=data.navigation;
    if(!n || typeof n.map_id!=='string' || (n.robot_pose!==null
      && !['x','y','yaw'].every(key=>Number.isFinite(n.robot_pose?.[key]))))invalid();
  }
  const positive = v => typeof v==='number' && Number.isFinite(v) && v>0;
  const speeds = v => v && positive(v.linear_m_s) && positive(v.angular_rad_s);
  const limits=data.capabilities?.speed_limits;
  if(limits!==undefined && (!positive(limits?.linear_max_m_s) || !positive(limits?.angular_max_rad_s)
      || !speeds(limits.defaults) || limits.defaults.linear_m_s>limits.linear_max_m_s
      || limits.defaults.angular_rad_s>limits.angular_max_rad_s)) invalid();
  if(data.control?.speed_limits!=null && !speeds(data.control.speed_limits)) invalid();
  if (data.read_only === false) {
    const c = data.control, cap = data.capabilities;
    const simulation=cap?.environment==='local_simulation' && s?.mode==='mock';
    const robot=cap?.environment==='robot_navigation' && ['nav2_with_mock_cleaning','nav2_with_image_pickup'].includes(s?.mode)
      && Array.isArray(cap.commands) && cap.commands.length===5
      && ['start','pause','resume','reset','stop'].every(command=>cap.commands.includes(command));
    if (!cap || cap.schema_version !== 1 || (!simulation&&!robot) || cap.control_enabled !== true
        || !c || c.schema_version !== 1
        || !Number.isSafeInteger(c.control_epoch) || c.control_epoch < 0
        || !['none','automatic','manual','blocked'].includes(c.owner)
        || !['READY','NAV_STARTING','HALTING','MANUAL_READY','PAUSED','FAULT'].includes(c.phase)
        || !(c.controller_id === null || typeof c.controller_id === 'string')
        || typeof c.map_id !== 'string' || !c.map_id || typeof c.localization_valid !== 'boolean'
        || !Number.isFinite(c.lease_remaining_seconds) || c.lease_remaining_seconds < 0
        || !['stop','forward','backward','left','right'].includes(c.manual_direction)) invalid();
    if (c.command_result !== null) validateReceipt(c.command_result);
  }
  return data;
}

export function validateReceipt(receipt) {
  if (!receipt || receipt.schema_version !== 1 || typeof receipt.bridge_instance_id !== 'string'
      || typeof receipt.request_id !== 'string' || typeof receipt.command !== 'string'
      || !['pending','succeeded','failed','rejected'].includes(receipt.status)
      || !(receipt.reason === null || typeof receipt.reason === 'string')) throw new Error('命令结果格式异常');
  return receipt;
}

const loopback = baseUrl => {try {return ['127.0.0.1','localhost','[::1]'].includes(new URL(baseUrl).hostname);} catch {return false;} };
export function controlPolicy(data, sessionId, locallyAllowed = true) {
  const c=data?.control, s=data?.mission;
  const available=locallyAllowed && data?.connection==='ONLINE' && data?.read_only===false
    && data.capabilities?.control_enabled===true
    && ((data.capabilities.environment==='local_simulation'&&s?.mode==='mock')
      || (data.capabilities.environment==='robot_navigation'&&['nav2_with_mock_cleaning','nav2_with_image_pickup'].includes(s?.mode)));
  const simulation=data?.capabilities?.environment==='local_simulation';
  const own=c?.controller_id===sessionId, free=c?.controller_id===null, ready=available && (own||free);
  const busy=c?.command_result?.status==='pending', halting=c?.phase==='HALTING', manual=ready&&own&&c.owner==='manual';
  const stopped=s?.stationary_confirmed===true && !s.owned_goal_id && s.goal_response_pending===false && s.halt_state!=='UNCONFIRMED';
  const retry= data?.capabilities?.retry_after_navigation_abort===true && s?.state==='FAULT' && s.alarm==='NAVIGATION_ABORTED';
  return {available,own,manual,
    start:ready&&!busy&&!halting&&stopped&&c.localization_valid&&(s.state==='IDLE'||retry)&&c.owner!=='manual',
    pause:ready&&!busy&&!halting&&s.state!=='IDLE'&&s.state!=='FAULT'&&c.owner!=='manual',
    resume:ready&&!busy&&!halting&&stopped&&c.localization_valid&&s.state==='PAUSED'&&!!s.saved_goal&&c.owner!=='manual'&&c.phase!=='FAULT',
    reset:ready&&!busy&&!halting&&stopped&&['IDLE','PAUSED','FAULT'].includes(s.state)&&c.owner!=='manual',
    requestManual:simulation&&ready&&!busy&&!halting&&c.owner!=='manual'&&c.phase!=='FAULT',
    releaseManual:simulation&&manual&&!busy,
    manualIntent:simulation&&manual&&!busy&&c.phase==='MANUAL_READY',
    stop:available};
}

export function createNavigationApi({ baseUrl = '', sessionId = crypto.randomUUID() } = {}) {
  const unavailable = async () => { throw new NavigationNotConnectedError(); };
  let running = false, timer = null, freshnessTimer = null, controller = null, generation = 0;
  let latest=null, receivedAt=0, stoppedOnLoss=false, intentSequence=0;
  const listeners = new Set();
  const emit = value => { for (const listener of listeners) listener(value); };
  async function getStatus() {
    const ownGeneration=generation;
    if (!baseUrl) throw new Error('请先填写导航服务地址');
    const url = new URL(baseUrl);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('导航服务地址无效');
    const ownController = new AbortController(); controller = ownController;
    const timeout = setTimeout(() => ownController.abort(), 1800);
    try {
      const response = await fetch(baseUrl.replace(/\/$/,'') + '/api/v1/status',
        {method:'GET',cache:'no-store',signal:ownController.signal});
      if (!response.ok) throw new Error('状态服务响应异常：' + response.status);
      const data=validateEnvelope(await response.json());
      if(ownGeneration===generation){latest=data; receivedAt=performance.now();}
      return data;
    } finally { clearTimeout(timeout); if (controller === ownController) controller = null; }
  }
  const localControl = () => latest?.read_only===false && latest.capabilities?.control_enabled===true
    && ((loopback(baseUrl)&&latest.capabilities.environment==='local_simulation')
      || latest.capabilities.environment==='robot_navigation');
  const fresh = () => latest?.connection==='ONLINE' && performance.now()-receivedAt <
    (latest.stale_after_seconds-latest.age_seconds)*1000;
  async function post(path, body, keepalive=false) {
    const abort=new AbortController(), timeout=setTimeout(()=>abort.abort(),1800);
    try {
      const response=await fetch(baseUrl.replace(/\/$/,'')+path,
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:abort.signal,keepalive});
      const data=await response.json();
      if(!response.ok && !data.request_id)throw new Error(data.error||'命令服务异常');
      if (path==='/api/v1/command') {
        const result=validateReceipt(data);
        if(result.request_id!==body.request_id || result.bridge_instance_id!==body.bridge_instance_id || result.command!==body.command)
          throw new Error('命令结果不匹配');
        return result;
      }
      if(!response.ok)throw new Error(data.error||'控制会话心跳失败');
      return data;
    } finally {clearTimeout(timeout);}
  }
  async function send(command, payload={}, keepalive=false) {
    if(!localControl())throw new NavigationNotConnectedError();
    if(command!=='stop' && !fresh())throw new Error('任务状态过期，不能发送新操作');
    const actionNames={request_manual:'requestManual',release_manual:'releaseManual',manual_intent:'manualIntent'};
    const policy=controlPolicy(latest,sessionId,localControl());
    if(command!=='stop'&&!policy[actionNames[command]||command])throw new Error('当前控制权或停车条件不允许该操作');
    const body={...payload,schema_version:1,request_id:payload.request_id||crypto.randomUUID(),command,
      session_id:sessionId,bridge_instance_id:latest.bridge_instance_id,control_epoch:latest.control.control_epoch};
    return post('/api/v1/command',body,keepalive);
  }
  function stopOnLoss() {
    if(!stoppedOnLoss && localControl() && latest.control.controller_id===sessionId){
      stoppedOnLoss=true; void send('stop',{},true).catch(()=>{});
    }
  }
  async function poll(epoch) {
    try {
      const data=await getStatus();
      if(running && epoch===generation){
        emit(data);
        if(data.connection!=='ONLINE'){stopOnLoss();}
        else if(localControl() && data.control.controller_id===sessionId){
          stoppedOnLoss=false;
          try {
            await post('/api/v1/heartbeat',{schema_version:1,session_id:sessionId,
              bridge_instance_id:data.bridge_instance_id,control_epoch:data.control.control_epoch});
          } catch(error) {
            // Ownership can advance between GET and heartbeat. Read the next
            // status before deciding; this rejection never renews the lease.
            if(error.message!=='STALE_SESSION_OR_EPOCH')throw error;
          }
        }
      }
    } catch (error) { if (running && epoch === generation){stopOnLoss();emit({connection:'UNREACHABLE',mission:null,error:error.message});} }
    finally { if (running && epoch === generation) timer = setTimeout(() => poll(epoch), 800); }
  }
  function disconnect() {
    stopOnLoss();
    running = false; generation++; clearTimeout(timer); clearInterval(freshnessTimer); controller?.abort();
    latest=null;
    emit({connection:'DISCONNECTED',mission:null});
  }
  return Object.freeze({
    baseUrl,
    sessionId,
    get implemented(){return localControl();},
    get readOnly(){return !localControl();},
    get controlAvailable(){return localControl()&&fresh();},
    async connect() {
      if (!baseUrl) throw new Error('请先填写导航服务地址');
      if (!running) {
        running=true;
        freshnessTimer=setInterval(()=>{
          if(latest?.connection==='ONLINE'&&!fresh()){
            latest={...latest,connection:'STALE',age_seconds:latest.age_seconds+(performance.now()-receivedAt)/1000};
            stopOnLoss();emit(latest);
          }
        },100);
        await poll(++generation);
      }
    },
    getStatus,
    getMap: async () => {
      if(!baseUrl||latest?.capabilities?.environment!=='robot_navigation')return unavailable();
      const abort=new AbortController(), timeout=setTimeout(()=>abort.abort(),1800);
      try {
        const response=await fetch(baseUrl.replace(/\/$/,'')+'/api/v1/map',{cache:'no-store',signal:abort.signal});
        if(!response.ok)throw new Error('地图服务不可用');
        return response.json();
      } finally {clearTimeout(timeout);}
    },
    start: payload=>send('start',payload),
    pause: payload=>send('pause',payload),
    resume: payload=>send('resume',payload),
    reset: payload=>send('reset',payload),
    requestManual: payload=>send('request_manual',payload),
    releaseManual: payload=>send('release_manual',payload),
    manualIntent: payload=>send('manual_intent',{...payload,intent_sequence:++intentSequence}),
    stop: payload=>send('stop',payload,true),
    subscribeStatus(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    disconnect,
  });
}
