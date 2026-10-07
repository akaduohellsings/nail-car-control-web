import {loadConfig} from './connection-config.js?v=20261006-video-network';
import {installSettings} from './connection-settings.js?v=20261006-video-network';
import {fitCalibration,locatePixel,cameraValid} from './pickup-geometry.js?v=20261007-static';
import {getStationaryObservation} from './pickup-snapshot.js?v=20261007-snapshot-wait';
import {installPickupSpeeds} from './pickup-speed.js?v=20261007-calibrated-pickup';
import {installPickupTest} from './pickup-test.js?v=20261007-pickup-button';
const $=id=>document.getElementById(id),KEY='nail.pickup.groundCalibration.v1';
let config=loadConfig(),observation=null,photo=null,selected=null,model=null,busy=false,generation=0;
let draft={schema_version:1,camera:null,fit:[],checks:[],magnet:null,mount_note:''};
let pickupUI=null;
const pickupSpeeds=installPickupSpeeds(()=>pickupUI?.refresh());
function message(id,text){$(id).textContent=text;}
function address(){message('connectionAddress','任务服务：'+(config.navigationUrl||'请填写连接设置'));}
function number(id){const value=$(id).value.trim();if(!value)throw Error('请填写全部实测数据');const n=Number(value);if(!Number.isFinite(n))throw Error('数值格式错误');return n;}
function invalidate(){model=null;message('calibrationStatus','标定尚未完成核验或数据已修改');updateLocation();}
function fillDraft(){
  for(const [id,key] of [['magnetX','x_m'],['magnetY','y_m'],['magnetWidth','width_m']])$(id).value=draft.magnet?.[key]===undefined?'':String(draft.magnet[key]*100);
  $('mountNote').value=draft.mount_note||'';renderPoints();
}
function readDraft(){return {...draft,magnet:{x_m:number('magnetX')/100,y_m:number('magnetY')/100,width_m:number('magnetWidth')/100},mount_note:$('mountNote').value.trim()};}
function renderPoints(){
  $('pointRows').replaceChildren();
  for(const [key,label] of [['fit','标定'],['checks','核验']])draft[key].forEach((p,i)=>{
    const tr=document.createElement('tr');for(const text of [`${label} ${i+1}`,`${p.u.toFixed(1)}, ${p.v.toFixed(1)}`,`${(p.x_m*100).toFixed(1)} / ${(p.y_m*100).toFixed(1)}`]){
      const td=document.createElement('td');td.textContent=text;tr.append(td);}
    const td=document.createElement('td'),button=document.createElement('button');button.textContent='移除';button.className='text-button';
    button.addEventListener('click',()=>{draft[key].splice(i,1);invalidate();renderPoints();draw();});td.append(button);tr.append(td);$('pointRows').append(tr);
  });
}
function draw(){
  const canvas=$('photo'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);if(photo)ctx.drawImage(photo,0,0);
  if(!observation)return;
  ctx.lineWidth=2;ctx.font='14px sans-serif';
  for(const [i,b] of observation.boxes.entries()){ctx.strokeStyle='#ffc46b';ctx.strokeRect(b.u-b.width/2,b.v-b.height/2,b.width,b.height);ctx.fillStyle='#ffc46b';ctx.fillText(`钉子 ${i+1}`,b.u-b.width/2,Math.max(15,b.v-b.height/2-5));}
  if(draft.camera?.camera_id===observation.camera.camera_id)for(const [key,color] of [['fit','#83d8b8'],['checks','#b4a5ff']]){
    ctx.fillStyle=color;draft[key].forEach((p,i)=>{ctx.beginPath();ctx.arc(p.u,p.v,4,0,Math.PI*2);ctx.fill();ctx.fillText(`${key==='fit'?'标':'验'}${i+1}`,p.u+7,p.v-7);});}
  if(selected){ctx.strokeStyle='#ffecb0';ctx.beginPath();ctx.arc(selected.u,selected.v,8,0,Math.PI*2);ctx.stroke();}
}
function preview(position){
  const svg=$('groundPreview');svg.replaceChildren();if(!position||!model)return;
  const m=model.magnet,maxX=Math.max(.6,position.x_m+.15,m.x_m+.15),maxY=Math.max(.3,Math.abs(position.y_m)+.1,Math.abs(m.y_m)+m.width_m);
  const x=y=>180-y/maxY*145,y=x=>235-x/maxX*205;
  function shape(name,attrs,text){const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;svg.append(e);}
  shape('rect',{x:x(m.y_m+m.width_m/2),y:y(maxX),width:m.width_m/maxY*145,height:y(m.x_m)-y(maxX),fill:'#224d43',opacity:.65});
  shape('line',{x1:x(0),y1:y(0),x2:x(0),y2:y(maxX),stroke:'#6e819d','stroke-dasharray':'4 4'});
  shape('rect',{x:x(m.y_m+m.width_m/2),y:y(m.x_m)-3,width:m.width_m/maxY*145,height:6,fill:'#83d8b8'});
  shape('circle',{cx:x(position.y_m),cy:y(position.x_m),r:6,fill:'#ffc46b'});
  for(const [tx,ty,label] of [[10,20,'俯视：左 ← → 右'],[295,45,'前方 ↑'],[10,252,'绿色：磁铁预计直行扫过带'],[x(position.y_m)+9,y(position.x_m)-8,'目标'],[x(0)+5,y(0),'车体原点']])shape('text',{x:tx,y:ty,fill:'#c4d2e6','font-size':12},label);
}
function updateLocation(){
  for(const id of ['forwardDistance','lateralDistance','magnetError'])message(id,'—');preview(null);
  try{
    if(!model)throw Error('尚未标定或核验未通过');
    if(!observation)throw Error('请先获取停稳快照');
    if(!$('mountConfirmed').checked)throw Error('请核对相机、磁铁安装及地面条件');
    if(!selected)throw Error('请选择识别目标，或点击画面做标记定位测试');
    const p=locatePixel(model,observation.camera,selected.u,selected.v),cm=v=>(v*100).toFixed(1);
    message('forwardDistance',`${cm(p.x_m)} cm`);message('lateralDistance',`${p.y_m>=0?'左':'右'} ${cm(Math.abs(p.y_m))} cm`);
    message('magnetError',`${p.lateral_error_m>=0?'向左':'向右'}偏 ${cm(Math.abs(p.lateral_error_m))} cm`);
    message('sweepResult',p.forward_to_magnet_m<0?'目标已在磁铁后方':p.in_straight_sweep?'在预计直行扫过带内':'在预计直行扫过带外，需要对准');
    message('targetStatus',`${selected.kind==='nail'?'识别框中心地面位置近似':'手动标记位置测试'}；到磁铁横线还差 ${cm(p.forward_to_magnet_m)} cm。仅为冻结快照估计，吸附未确认。`);preview(p);
  }catch(error){message('sweepResult','暂不可估算');message('targetStatus',error.message);}
  pickupUI?.refresh();
}
async function capture(){
  if(busy)return;busy=true;$('captureButton').disabled=true;const version=++generation;
  observation=null;photo=null;selected=null;$('mountConfirmed').checked=false;draw();updateLocation();
  message('photoTime','快照为冻结画面，移动小车或物品后请重新获取。');message('pixelText','点击画面选择一个像素点。');
  $('targetSelect').replaceChildren(new Option('手动选点（标记定位测试）','manual'));
  message('captureStatus','获取同一帧图像和识别结果……');
  try{
    if(!config.navigationUrl)throw Error('请填写导航任务服务地址');
    const data=await getStationaryObservation(config.navigationUrl,{onRetry:attempt=>{
      if(version===generation)message('captureStatus',`等待停车确认与同帧识别结果（第${attempt}次确认，最多等待8秒）……`);
    }});
    cameraValid(data.camera);if(data.schema_version!==1||data.stationary!==true||!Array.isArray(data.boxes)||!data.source_stamp_ns)throw Error('快照格式不完整');
    const image=new Image();image.src='data:image/jpeg;base64,'+data.image_jpeg_base64;await image.decode();
    if(image.naturalWidth!==data.camera.width||image.naturalHeight!==data.camera.height)throw Error('画面尺寸与相机参数不一致');
    if(version!==generation)return;
    observation=data;photo=image;$('photo').width=data.camera.width;$('photo').height=data.camera.height;
    $('targetSelect').replaceChildren(new Option('手动选点（标记定位测试）','manual'));
    data.boxes.forEach((b,i)=>$('targetSelect').add(new Option(`钉子 ${i+1} · ${(b.confidence*100).toFixed(0)}%`,String(i))));
    message('photoTime',`冻结快照 · 源时间戳 ${data.source_stamp_ns} · 获取时帧龄 ${data.source_age_seconds.toFixed(2)} 秒`);
    message('captureStatus',`已获取停稳快照：${data.boxes.length} 个钉子候选。移动小车或物品后重新拍照。`);
    if(draft.camera&&draft.camera.camera_id!==data.camera.camera_id)invalidate();
    draw();updateLocation();
  }catch(error){
    const reasons={NOT_FOUND:'服务尚未支持静止定位，请完整重启加载新版',STATIONARY_SNAPSHOT_REQUIRED:'小车尚未确认停稳或仍有任务，请先停止任务，停稳后重新获取',CAMERA_INFO_NOT_READY:'等待相机参数，请确认已完整启动新版服务',MATCHED_CAMERA_DETECTION_NOT_READY:'没有新鲜的同帧图像和识别结果，请稍后重试',SNAPSHOT_ENCODING_UNAVAILABLE:'小车图像编码组件不可用',SERVICE_STARTING:'任务服务正在启动，请稍后重试',SNAPSHOT_TIMEOUT:'获取快照超时，请检查任务服务连接'};
    if(version===generation)message('captureStatus','未获取：'+(error.name==='TimeoutError'?reasons.SNAPSHOT_TIMEOUT:reasons[error.message]||error.message));
  }
  finally{busy=false;$('captureButton').disabled=false;}
}
$('photo').addEventListener('click',event=>{
  if(!observation)return;const rect=$('photo').getBoundingClientRect();
  const style=getComputedStyle($('photo')),left=parseFloat(style.borderLeftWidth),top=parseFloat(style.borderTopWidth);
  const width=rect.width-left-parseFloat(style.borderRightWidth),height=rect.height-top-parseFloat(style.borderBottomWidth);
  selected={u:Math.min(observation.camera.width-1,Math.max(0,(event.clientX-rect.left-left)*observation.camera.width/width)),v:Math.min(observation.camera.height-1,Math.max(0,(event.clientY-rect.top-top)*observation.camera.height/height)),kind:'manual'};
  $('targetSelect').value='manual';message('pixelText',`选中像素：u=${selected.u.toFixed(1)}，v=${selected.v.toFixed(1)}`);draw();updateLocation();
});
$('targetSelect').addEventListener('change',()=>{const b=observation?.boxes[Number($('targetSelect').value)];selected=$('targetSelect').value==='manual'||!b?null:{u:b.u,v:b.v,kind:'nail'};message('pixelText',selected?`识别框中心：u=${selected.u.toFixed(1)}，v=${selected.v.toFixed(1)}`:'点击画面选择一个像素点。');draw();updateLocation();});
function addPoint(key){try{
  if(!observation||!selected)throw Error('请先获取画面并点击地面标记');
  if(draft.camera&&draft.camera.camera_id!==observation.camera.camera_id)throw Error('相机已变化，请清空旧标记重新标定');
  if(draft[key].length>=40)throw Error('每类最多40个点');
  draft.camera=structuredClone(observation.camera);draft[key].push({u:selected.u,v:selected.v,x_m:number('pointX')/100,y_m:number('pointY')/100});invalidate();renderPoints();draw();message('formStatus','标记已添加；填写全部数据后计算核验。');
}catch(error){message('formStatus',error.message);}}
$('addFit').addEventListener('click',()=>addPoint('fit'));$('addCheck').addEventListener('click',()=>addPoint('checks'));
$('clearPoints').addEventListener('click',()=>{draft.fit=[];draft.checks=[];draft.camera=null;try{localStorage.removeItem(KEY);}catch{}invalidate();renderPoints();draw();});
$('saveCalibration').addEventListener('click',()=>{try{
  const next=readDraft(),fitted=fitCalibration(next);localStorage.setItem(KEY,JSON.stringify(next));draft=next;model=fitted;
  message('calibrationStatus',`核验通过：均方根 ${(model.validation_rms_m*100).toFixed(2)} cm，最大 ${(model.validation_max_m*100).toFixed(2)} cm`);
  message('formStatus','已保存到本浏览器，可导出备份；实际钉子定位仍需尺子核对。');updateLocation();
}catch(error){invalidate();message('formStatus','未保存：'+error.message);}});
for(const id of ['magnetX','magnetY','magnetWidth','mountNote'])$(id).addEventListener('input',invalidate);
$('mountConfirmed').addEventListener('change',updateLocation);$('captureButton').addEventListener('click',capture);
$('exportCalibration').addEventListener('click',()=>{try{const next=readDraft();fitCalibration(next);const url=URL.createObjectURL(new Blob([JSON.stringify(next,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='nail-ground-calibration.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){message('formStatus','无法导出：'+error.message);}});
$('importCalibration').addEventListener('change',async event=>{try{
  const file=event.target.files[0];if(!file)return;if(file.size>100000)throw Error('文件过大');
  const next=JSON.parse(await file.text()),fitted=fitCalibration(next);localStorage.setItem(KEY,JSON.stringify(next));draft=next;model=fitted;$('mountConfirmed').checked=false;fillDraft();draw();updateLocation();
  message('calibrationStatus','已导入并重新核验；请获取当前快照、确认安装条件');message('formStatus','导入完成。');
}catch(error){message('formStatus','未导入：'+error.message);}finally{event.target.value='';}});
installSettings($('settingsButton'),next=>{config=next;generation++;observation=null;photo=null;selected=null;$('mountConfirmed').checked=false;pickupUI.connect(config.navigationUrl);address();draw();updateLocation();message('captureStatus','连接设置已更新，请重新获取画面。');});
try{const saved=localStorage.getItem(KEY);if(saved){const next=JSON.parse(saved),fitted=fitCalibration(next);draft=next;model=fitted;message('calibrationStatus','已载入标定，请获取当前快照并核对安装条件');}}
catch(error){message('formStatus','已有标定无法使用：'+error.message);}
$('loadServiceCalibration').addEventListener('click',()=>{try{
  const next=observation?.pickup_calibration?.draft,fitted=fitCalibration(next);localStorage.setItem(KEY,JSON.stringify(next));
  draft=structuredClone(next);model=fitted;$('mountConfirmed').checked=false;fillDraft();draw();updateLocation();
  message('calibrationStatus','已载入任务服务的标定，请重新确认安装条件');
}catch(e){message('formStatus',e.message);}});
pickupUI=installPickupTest({baseUrl:config.navigationUrl,speeds:pickupSpeeds,
  context:()=>({observation,selected,model,draft:readDraftSafe(),mountConfirmed:$('mountConfirmed').checked}),
  onStarted:()=>{$('pickupTestConditions').checked=false;}});
function readDraftSafe(){try{return readDraft();}catch{return null;}}
address();fillDraft();updateLocation();
