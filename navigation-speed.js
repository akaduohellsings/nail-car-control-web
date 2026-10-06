/** UI uses degrees/second; the command contract uses radians/second. */
export const DEFAULT_SPEEDS={linear_m_s:.05,angular_deg_s:13.75};
export function parseSpeedInputs(linear,angularDeg,policy=null){
  if(typeof linear!=='number'||typeof angularDeg!=='number'||!Number.isFinite(linear)||!Number.isFinite(angularDeg)
      ||linear<=0||angularDeg<=0)throw new Error('速度必须是大于 0 的数字');
  const angular=angularDeg*Math.PI/180;
  const maxLinear=policy?.linear_max_m_s??.06,maxAngular=policy?.angular_max_rad_s??.24;
  if(linear>maxLinear||angular>maxAngular+1e-12)
    throw new Error(`当前最大允许 ${maxLinear} 米/秒、${Math.floor(maxAngular*180/Math.PI*100)/100} 度/秒`);
  return {linear_m_s:linear,angular_rad_s:angular};
}
export function speedText(limits){
  return `${Number(limits.linear_m_s.toFixed(3))} 米/秒 · ${(limits.angular_rad_s*180/Math.PI).toFixed(2)} 度/秒`;
}

/** Restore drafts before connecting; execution still uses the connected service policy. */
export function parseSpeedDraft(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('速度草稿格式错误');
  return parseSpeedInputs(value.linear_m_s,value.angular_deg_s,{linear_max_m_s:.3,angular_max_rad_s:Math.PI/4});
}
