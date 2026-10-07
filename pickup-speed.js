import {parseSpeedInputs,speedText} from './navigation-speed.js';
export const PICKUP_SPEED_KEY='nail.pickup.speedDraft.v1';
export const PICKUP_SPEED_POLICY={linear_max_m_s:.3,angular_max_rad_s:Math.PI/4,
  defaults:{linear_m_s:.04,angular_rad_s:.24}};
export function parsePickupSpeeds(linear,angularDeg,policy=PICKUP_SPEED_POLICY){
  return parseSpeedInputs(linear,angularDeg,policy);
}
export function installPickupSpeeds(onChange=()=>{}){
  const $=id=>document.getElementById(id);let policy=PICKUP_SPEED_POLICY;
  try{const saved=JSON.parse(localStorage.getItem(PICKUP_SPEED_KEY));if(saved){
    parsePickupSpeeds(saved.linear_m_s,saved.angular_deg_s);$('pickupLinearSpeed').value=saved.linear_m_s;$('pickupAngularSpeed').value=saved.angular_deg_s;
  }}catch{$('pickupSpeedHint').textContent='拾取速度草稿无法读取，请重新填写。';}
  const read=()=>parsePickupSpeeds($('pickupLinearSpeed').valueAsNumber,$('pickupAngularSpeed').valueAsNumber,policy);
  for(const id of ['pickupLinearSpeed','pickupAngularSpeed'])$(id).addEventListener('input',()=>{
    try{read();$('pickupSpeedHint').textContent='速度已修改，随下一次任务生效；可保存草稿。';}catch(e){$('pickupSpeedHint').textContent=e.message;}
    onChange();
  });
  $('savePickupSpeed').addEventListener('click',()=>{try{
    const speeds=read();localStorage.setItem(PICKUP_SPEED_KEY,JSON.stringify({linear_m_s:speeds.linear_m_s,angular_deg_s:$('pickupAngularSpeed').valueAsNumber}));
    $('pickupSpeedHint').textContent='已保存拾取速度：'+speedText(speeds)+'；当前动作速度不变。';
  }catch(e){$('pickupSpeedHint').textContent='未保存：'+e.message;}});
  return {read,valid(){try{read();return true;}catch{return false;}},update(next,locked=false){
    policy=next||PICKUP_SPEED_POLICY;
    $('pickupLinearSpeed').max=policy.linear_max_m_s;$('pickupAngularSpeed').max=policy.angular_max_rad_s*180/Math.PI;
    for(const id of ['pickupLinearSpeed','pickupAngularSpeed','savePickupSpeed'])$(id).disabled=locked;
  }};
}
