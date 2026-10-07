/** Static ground geometry only. No network, navigation or motion functions. */
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function cameraValid(c){
  if(!c||typeof c.camera_id!=='string'||!c.camera_id||c.coordinate_space!=='raw_image_pixels'
    ||c.distortion_model!=='plumb_bob'||!Number.isInteger(c.width)||!Number.isInteger(c.height)
    ||c.width<=0||c.height<=0||!Array.isArray(c.k)||c.k.length!==9||!c.k.every(finite)
    ||!Array.isArray(c.d)||c.d.length!==5||!c.d.every(finite)||c.k[0]<=0||c.k[4]<=0
    ||[1,3,6,7].some(i=>Math.abs(c.k[i])>1e-8)||Math.abs(c.k[8]-1)>1e-8)
    throw Error('相机参数不可用或图像坐标格式不支持');
  return c;
}
function distort(x,y,d){
  const [k1,k2,p1,p2,k3]=d,r2=x*x+y*y,radial=1+k1*r2+k2*r2*r2+k3*r2*r2*r2;
  return [x*radial+2*p1*x*y+p2*(r2+2*x*x),y*radial+p1*(r2+2*y*y)+2*p2*x*y];
}
export function undistortPixel(camera,u,v){
  const c=cameraValid(camera);
  if(!finite(u)||!finite(v)||u<0||v<0||u>=c.width||v>=c.height)throw Error('像素点超出图像');
  const xd=(u-c.k[2])/c.k[0],yd=(v-c.k[5])/c.k[4];let x=xd,y=yd;
  for(let i=0;i<25;i++){
    const [dx,dy]=distort(x,y,c.d),ex=xd-dx,ey=yd-dy;
    if(Math.hypot(ex,ey)<1e-10)return [x,y];
    // Newton inverse: verify convergence rather than treating raw pixels as rays.
    const eps=1e-6,a=distort(x+eps,y,c.d),b=distort(x,y+eps,c.d);
    const j00=(a[0]-dx)/eps,j10=(a[1]-dy)/eps,j01=(b[0]-dx)/eps,j11=(b[1]-dy)/eps;
    const det=j00*j11-j01*j10;
    if(!finite(det)||Math.abs(det)<1e-10)break;
    x+=(j11*ex-j01*ey)/det;y+=(-j10*ex+j00*ey)/det;
    if(!finite(x)||!finite(y)||Math.hypot(x,y)>10)break;
  }
  throw Error('该像素的畸变校正未收敛');
}
const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
function hull(points){
  const ordered=points.map(p=>[...p]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const half=rows=>{const h=[];for(const p of rows){while(h.length>=2&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
  return [...half(ordered).slice(0,-1),...half([...ordered].reverse()).slice(0,-1)];
}
function inside(point,polygon){return polygon.length>=3&&polygon.every((p,i)=>cross(p,polygon[(i+1)%polygon.length],point)>=-1e-9);}
function solve(rows,values){
  const n=8,m=Array.from({length:n},(_,i)=>[...Array.from({length:n},(_,j)=>rows.reduce((s,r)=>s+r[i]*r[j],0)),rows.reduce((s,r,k)=>s+r[i]*values[k],0)]);
  const size=Math.max(...m.flatMap(r=>r.slice(0,n).map(Math.abs)));
  for(let i=0;i<n;i++){
    let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[pivot][i]))pivot=j;
    if(Math.abs(m[pivot][i])<size*1e-10)throw Error('标记分布退化，请覆盖前后、左右不同位置');
    [m[i],m[pivot]]=[m[pivot],m[i]];const d=m[i][i];for(let j=i;j<=n;j++)m[i][j]/=d;
    for(let k=0;k<n;k++)if(k!==i){const f=m[k][i];for(let j=i;j<=n;j++)m[k][j]-=f*m[i][j];}
  }
  return m.map(r=>r[n]);
}
function apply(model,p){
  const x=(p[0]-model.center[0])/model.scale,y=(p[1]-model.center[1])/model.scale,h=model.h;
  const d=h[6]*x+h[7]*y+1;
  if(!finite(d)||Math.abs(d)<1e-5)throw Error('目标接近映射奇点');
  const result=[(h[0]*x+h[1]*y+h[2])/d,(h[3]*x+h[4]*y+h[5])/d];
  if(!result.every(finite))throw Error('地面换算结果无效');
  return result;
}
function pointsValid(rows,c){
  if(!Array.isArray(rows)||rows.length>40)throw Error('标定点数量无效');
  return rows.map(r=>{
    if(!r||!['u','v','x_m','y_m'].every(k=>finite(r[k]))||r.x_m<0||r.x_m>3||Math.abs(r.y_m)>2)
      throw Error('请输入实测坐标：前方0至300 cm，左右不超过200 cm');
    return undistortPixel(c,r.u,r.v);
  });
}
export function fitCalibration(draft){
  if(draft?.schema_version!==1)throw Error('标定文件版本不支持');
  const c=cameraValid(draft.camera),fit=draft.fit,checks=draft.checks;
  if(!Array.isArray(fit)||fit.length<6||!Array.isArray(checks)||checks.length<2)throw Error('至少需要6个标定点和2个独立核验点');
  const p=pointsValid(fit,c),q=pointsValid(checks,c),all=[...fit,...checks];
  for(let i=0;i<all.length;i++)for(let j=0;j<i;j++){
    if(Math.hypot(all[i].u-all[j].u,all[i].v-all[j].v)<1
      ||Math.hypot(all[i].x_m-all[j].x_m,all[i].y_m-all[j].y_m)<.005)
      throw Error('标定点及独立核验点不能重复');
  }
  const center=[0,1].map(i=>p.reduce((s,a)=>s+a[i],0)/p.length);
  const scale=Math.sqrt(p.reduce((s,a)=>s+(a[0]-center[0])**2+(a[1]-center[1])**2,0)/p.length);
  if(scale<1e-4)throw Error('标记覆盖区域太小');
  const polygon=hull(p),rows=[],values=[];
  p.forEach((a,i)=>{const u=(a[0]-center[0])/scale,v=(a[1]-center[1])/scale,{x_m:x,y_m:y}=fit[i];
    rows.push([u,v,1,0,0,0,-x*u,-x*v],[0,0,0,u,v,1,-y*u,-y*v]);values.push(x,y);});
  const model={h:solve(rows,values),center,scale,polygon,camera:c};
  // A projective horizon inside the calibrated hull invalidates the whole region.
  const denominators=p.map(a=>model.h[6]*(a[0]-center[0])/scale+model.h[7]*(a[1]-center[1])/scale+1);
  if(Math.min(...denominators)<=1e-4&&Math.max(...denominators)>=-1e-4)throw Error('标定范围跨越映射奇点');
  if(!q.every(a=>inside(a,polygon)))throw Error('独立核验点必须位于标定点围成的区域内');
  const errors=(points,rows)=>points.map((a,i)=>{const v=apply(model,a);return Math.hypot(v[0]-rows[i].x_m,v[1]-rows[i].y_m);});
  const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length),training=errors(p,fit),validation=errors(q,checks);
  if(rms(training)>.02||Math.max(...validation)>.03||rms(validation)>.02)throw Error('误差过大：核验均方根需≤2 cm，单点需≤3 cm，请重新检查标记和坐标');
  const magnet=draft.magnet;
  if(!magnet||!['x_m','y_m','width_m'].every(k=>finite(magnet[k]))||magnet.x_m<0||magnet.x_m>1
    ||Math.abs(magnet.y_m)>.5||magnet.width_m<=0||magnet.width_m>1)throw Error('请填写实测磁铁位置和有效吸附宽度');
  if(typeof draft.mount_note!=='string'||!draft.mount_note.trim()||draft.mount_note.length>200)throw Error('请记录相机和磁铁安装状态');
  return {...model,magnet:{...magnet},training_rms_m:rms(training),validation_rms_m:rms(validation),validation_max_m:Math.max(...validation)};
}
export function locatePixel(model,camera,u,v){
  cameraValid(camera);
  if(['camera_id','width','height','frame_id','topic','coordinate_space','distortion_model'].some(k=>camera[k]!==model.camera[k])
    ||['k','d'].some(k=>camera[k].some((v,i)=>v!==model.camera[k][i])))throw Error('相机或画幅已变更，请重新标定');
  const p=undistortPixel(camera,u,v);
  if(!inside(p,model.polygon))throw Error('目标在标定区域之外，暂不估算距离');
  const [x_m,y_m]=apply(model,p),magnet=model.magnet;
  return {x_m,y_m,lateral_error_m:y_m-magnet.y_m,in_straight_sweep:Math.abs(y_m-magnet.y_m)<=magnet.width_m/2,
    forward_to_magnet_m:x_m-magnet.x_m,collection_confirmed:false};
}
