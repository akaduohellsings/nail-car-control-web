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
export function installPickupTest({baseUrl,context,speeds,onStarted=()=>{}}){
  const $=id=>document.getElementById(id);let api=null,status=null,posting=false,used=null,lastCapture=null,receivedAt=0;
  const phases={WAIT_STOP:'等待停稳',REOBSERVE:'停稳后定位',ALIGN:'对准目标',WAIT_ALIGN_STOP:'转向后停车',APPROACH:'接近并通过钉子',WAIT_FINAL_STOP:'确认停车',COMPLETE:'动作完成，吸附需现场确认',FAULT:'拾取故障',CANCELED:'动作已取消',SKIPPED:'已跳过目标',IDLE:'待命'};
  function refresh(){
    const ctx=context(),obs=ctx.observation;
    if(obs?.capture_id!==lastCapture){lastCapture=obs?.capture_id;receivedAt=performance.now();}
    const ready=api&&controlPolicy(status,api.sessionId,api.controlAvailable).pickupTest;
    const fresh=obs&&performance.now()-receivedAt<60000;
    const agrees=calibrationAgrees(ctx.draft,obs?.pickup_calibration?.draft);
    $('pickupTestButton').disabled=posting||!ready||!fresh||used===obs?.capture_id||!ctx.selected||!ctx.model
      ||!ctx.mountConfirmed||!$('pickupTestConditions').checked||!agrees||!speeds.valid();
    $('pickupStopButton').disabled=posting||!api?.controlAvailable;
    $('loadServiceCalibration').disabled=!obs?.pickup_calibration||posting;
    const active=status?.mission&&!['IDLE','PAUSED','FAULT'].includes(status.mission.state);
    speeds.update(status?.capabilities?.auto_pickup?.speed_limits,!!active||posting);
    if(!posting){
      const p=status?.decision?.pickup;
      let text=status?.connection==='ONLINE'?(p?phases[p.phase]||'待命':'当前服务未接入标定拾取'):'等待任务服务连接';
      if(p?.error||p?.skip_reason)text+='：'+(p.error||p.skip_reason);
      if(obs?.pickup_calibration&&!agrees)text+='；请先载入服务使用的标定';
      if(obs&&!fresh)text+='；快照已过期，请重新获取';
      const receipt=status?.control?.command_result;
      if(receipt?.command==='pickup_test'&&['failed','rejected'].includes(receipt.status))text+='；'+receipt.reason;
      $('pickupTestStatus').textContent=text;
    }
  }
  function connect(url){
    if(api)api.disconnect();status=null;api=createNavigationApi({baseUrl:url});
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
