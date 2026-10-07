export const MAX_WAYPOINTS = 20;
export const routeActive = route => ['RUNNING','WAITING_STOP','PAUSED'].includes(route?.state);
export function navigationArrived(data) {
  const s=data?.mission;
  if(s?.state!=='IDLE'||!s.saved_goal||s.owned_goal_id!==null
    ||s.goal_response_pending!==false||s.stationary_confirmed!==true)return false;
  if(s.halt_state==='NONE')return true;
  const completion=data.navigation?.goal_completion;
  return s.halt_state==='CONFIRMED'&&completion?.source==='stationary_pose'
    &&['x','y','yaw_deg'].every(key=>Number.isFinite(completion.goal?.[key])&&completion.goal[key]===s.saved_goal[key]);
}
export function parseRouteDraft(value) {
  if (!value || typeof value.map_id !== 'string' || !value.map_id || !Array.isArray(value.goals)
      || value.goals.length > MAX_WAYPOINTS) throw new Error('多点草稿格式错误');
  const goals=value.goals.map(goal=>{
    if(!goal || Object.keys(goal).sort().join()!=='x,y,yaw_deg'
      || Object.values(goal).some(v=>typeof v!=='number'||!Number.isFinite(v))) throw new Error('点位坐标无效');
    return {...goal};
  });
  return {map_id:value.map_id,goals};
}
export function routeStartPayload(draft, mapId, capability) {
  const parsed=parseRouteDraft(draft);
  if(capability?.supported!==true) throw new Error('当前服务未支持多点导航，请启动更新后的服务');
  if(parsed.map_id!==mapId) throw new Error('地图已切换，请清空多点草稿并重新选点');
  if(!parsed.goals.length || parsed.goals.length>capability.max_points) throw new Error('请添加有效的导航点');
  return {map_id:mapId,goals:parsed.goals};
}
export function routeProgress(route) {
  if(!route)return '尚未启动多点任务';
  const phase={RUNNING:'执行中',WAITING_STOP:'等待停车确认',PAUSED:'已暂停',COMPLETED:'全部完成',STOPPED:'已停止',FAILED:'已中断'};
  return `${phase[route.state]} · 已到达 ${route.completed} / ${route.total} 点`
    +(['RUNNING','PAUSED'].includes(route.state)?` · 当前第 ${route.current_index+1} 点`:'')
    +(route.reason?` · ${route.reason}`:'');
}
