import {createNavigationApi,controlPolicy} from './navigation-api.js?v=20261007-calibrated-pickup';
export function calibrationAgrees(local,server){
  if(!local||!server)return false;
  const rows=k=>local[k]?.length===server[k]?.length&&local[k].every((r,i)=>['u','v','x_m','y_m'].every(n=>r[n]===server[k][i][n]));
  return rows('fit')&&rows('checks')&&['x_m','y_m','width_m'].every(k=>local.magnet?.[k]===server.magnet?.[k])
    &&local.camera?.camera_id===server.camera?.camera_id;
}
export function pickupTestPayload(observation,selected,speeds){
  if(!observation?.capture_id||!observation.pickup_calibration?.calibration_id||!selected
    ||!Number.isFinite(selected.u)||!Number.isFinite(selected.v))throw Error('请重新获取静止快照并标记钉子');
  return {capture_id:observation.capture_id,u:selected.u,v:selected.v,mount_confirmed:true,
    calibration_id:observation.pickup_calibration.calibration_id,pickup_speed_limits:speeds};
}
export function createPickupReadyGate(waitMs=1000){
  let since=null;
  return {update(ready,now){
    if(!ready){since=null;return false;}
    if(since===null)since=now;
    return now-since>=waitMs;
  }};
}
export function parkingWaitText(status){
  const reason=status?.navigation?.parking_confirmation?.reason;
  const meanings={ODOM_NOT_READY:'尚未收到里程计',WAIT_NEW_ODOM:'等待新的里程计数据',
    INVALID_ODOMETRY:'里程计数据无效',INVALID_ODOM_STAMP:'里程计时间戳无效',FUTURE_ODOM:'里程计时间戳领先系统时间',
    ODOM_SOURCE_STALE:'里程计源数据已过期',ODOM_REPLAY:'收到重复或乱序的里程计',
    ODOM_STALE:'里程计更新超时',MOVING:'里程计速度尚未降到停车范围',WAIT_STILL:'等待连续低速观测',
    GUARD_FEEDBACK_STALE:'底盘保护反馈更新超时',OUTPUT_ARMED:'底盘输出尚未解除使能',
    GUARD_WAIT_STOP:'底盘保护端尚未确认停车',NAV_ODOM_WAIT_STOP:'导航里程计尚未确认停车'};
  return '等待小车停车确认'+(meanings[reason]?'：'+meanings[reason]:'');
}
export function pickupTestBlockers({status,ready,stableReady=true,posting,observation,fresh,used,selected,model,mountConfirmed,conditions,agrees,speedValid}){
  if(posting)return ['正在提交拾取测试，请等待服务回复'];
  const missing=[],s=status?.mission,c=status?.control;
  if(!ready){
    if(status?.connection!=='ONLINE')missing.push('任务服务未连接或状态已过期，请检查连接设置'+(status?.error?'：'+status.error:''));
    else if(status.read_only||!status.capabilities?.control_enabled)missing.push('当前任务服务未开放控制，请连接可控制的导航服务');
    else if(s?.cleaning_mode!=='calibrated_pickup'||!status.capabilities?.auto_pickup?.supported
      ||!status.capabilities?.commands?.includes('pickup_test'))missing.push('当前服务未启用真实拾取，请完整启动新版服务');
    else {
      if(s?.state!=='IDLE'||c?.owner!=='none'||['RUNNING','WAITING_STOP','PAUSED'].includes(c?.route?.state))missing.push('请先停止当前任务，等待服务回到待命');
      if(c?.command_result?.status==='pending'||c?.phase==='HALTING')missing.push('等待上一条操作完成');
      if(s?.stationary_confirmed!==true||s?.owned_goal_id||s?.goal_response_pending||s?.halt_state==='UNCONFIRMED')missing.push(parkingWaitText(status));
      if(!c?.localization_valid)missing.push('定位尚未就绪，请先完成导航定位');
      if(!missing.length)missing.push('控制状态尚未就绪，其他页面可能仍占用控制权，请停止任务后重试');
    }
  }
  if(ready&&!stableReady)missing.push('等待停车及控制状态连续稳定1秒');
  if(!observation)missing.push('点击“获取静止快照”');
  else {
    if(!observation.pickup_calibration?.draft)missing.push('快照没有服务标定，请完整启动新版服务后重新获取');
    else if(!agrees)missing.push('点击“载入导航服务使用的标定”，使网页与小车使用同一份标定');
    if(!fresh)missing.push('快照已超过60秒，请重新获取并选点');
    else if(used===observation.capture_id)missing.push('这张快照已用于拾取，请重新获取并选点');
  }
  if(!model)missing.push('尚无有效标定，请载入服务标定或核验并保存');
  if(!mountConfirmed)missing.push('勾选上方“相机、磁铁安装及地面条件与本次标定一致”');
  if(!selected)missing.push('点击快照中的钉子中心，或在“识别目标”中选一个钉子');
  if(!conditions)missing.push('勾选本节“我在车旁，磁铁已固定……”现场条件确认');
  if(!speedValid)missing.push('填写有效拾取速度：移动大于0且不超过0.3米/秒，转向大于0且不超过45度/秒');
  return missing;
}
export function installPickupTest({baseUrl,context,speeds,onStarted=()=>{}}){
  const $=id=>document.getElementById(id);let api=null,status=null,posting=false,used=null,lastCapture=null,receivedAt=0;
  let readyGate=createPickupReadyGate();
  const phases={WAIT_STOP:'等待停稳',REOBSERVE:'停稳后定位',ALIGN:'对准目标',WAIT_ALIGN_STOP:'转向后停车',APPROACH:'接近并通过钉子',WAIT_FINAL_STOP:'确认停车',COMPLETE:'动作完成，吸附需现场确认',FAULT:'拾取故障',CANCELED:'动作已取消',SKIPPED:'已跳过目标',IDLE:'待命'};
  function refresh(){
    const ctx=context(),obs=ctx.observation;
    if(obs?.capture_id!==lastCapture){lastCapture=obs?.capture_id;receivedAt=performance.now();}
    const ready=api&&controlPolicy(status,api.sessionId,api.controlAvailable).pickupTest;
    const stableReady=readyGate.update(ready,performance.now());
    const fresh=obs&&performance.now()-receivedAt<60000;
    const agrees=calibrationAgrees(ctx.draft,obs?.pickup_calibration?.draft);
    const active=status?.mission&&!['IDLE','PAUSED','FAULT'].includes(status.mission.state);
    speeds.update(status?.capabilities?.auto_pickup?.speed_limits,!!active||posting);
    const blockers=pickupTestBlockers({status,ready,stableReady,posting,observation:obs,fresh,used,selected:ctx.selected,model:ctx.model,
      mountConfirmed:ctx.mountConfirmed,conditions:$('pickupTestConditions').checked,agrees,speedValid:speeds.valid()});
    $('pickupTestButton').disabled=blockers.length>0;
    $('pickupTestButton').title=blockers.join('；')||'已准备好，可执行拾取测试';
    $('pickupTestBlockers').replaceChildren(...blockers.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    $('pickupStopButton').disabled=posting||!api?.controlAvailable;
    $('loadServiceCalibration').disabled=!obs?.pickup_calibration||posting;
    if(!posting){
      const p=status?.decision?.pickup;
      let text=status?.connection==='ONLINE'?(p?phases[p.phase]||'待命':'当前服务未接入标定拾取'):'等待任务服务连接';
      if(p?.error||p?.skip_reason)text+='：'+(p.error||p.skip_reason);
      if(!active)text+=blockers.length?'；按钮暂不可用，请完成下方提示':'；已准备好，可点击拾取';
      const receipt=status?.control?.command_result;
      if(receipt?.command==='pickup_test'&&['failed','rejected'].includes(receipt.status))text+='；'+receipt.reason;
      $('pickupTestStatus').textContent=text;
    }
  }
  function connect(url){
    if(api)api.disconnect();status=null;readyGate=createPickupReadyGate();api=createNavigationApi({baseUrl:url});
    api.subscribeStatus(next=>{status=next;refresh();});void api.connect().catch(e=>{$('pickupTestStatus').textContent=e.message;});
  }
  $('pickupTestButton').addEventListener('click',async()=>{
    refresh();if($('pickupTestButton').disabled)return;
    posting=true;refresh();$('pickupTestStatus').textContent='正在提交拾取测试……';
    try{
      const ctx=context(),payload=pickupTestPayload(ctx.observation,ctx.selected,speeds.read());
      const receipt=await api.pickupTest(payload);
      if(receipt.status==='rejected'||receipt.status==='failed')throw Error(receipt.reason||'拾取测试被拒绝');
      used=ctx.observation.capture_id;onStarted();$('pickupTestStatus').textContent='测试已接受，等待动作与停车反馈';
    }catch(e){$('pickupTestStatus').textContent='结果：'+e.message;}
    finally{posting=false;}
  });
  $('pickupStopButton').addEventListener('click',()=>{void api.stop().then(()=>{
    $('pickupTestStatus').textContent='停止已提交，等待停车确认';
  }).catch(e=>{$('pickupTestStatus').textContent=e.message;});});
  const stopOnLeave=()=>{
    if(status?.control?.controller_id===api?.sessionId&&status?.mission?.state!=='IDLE')void api.stop().catch(()=>{});
  };
  window.addEventListener('blur',stopOnLeave);window.addEventListener('pagehide',stopOnLeave);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopOnLeave();});
  $('pickupTestConditions').addEventListener('change',refresh);
  const timer=setInterval(refresh,500);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  connect(baseUrl);refresh();
  return {refresh,connect};
}
