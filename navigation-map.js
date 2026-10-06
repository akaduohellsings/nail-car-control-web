/** Occupancy grid uses ROS row order; screen Y grows downwards. */
export function validateMap(map) {
  if (!map || typeof map.map_id!=='string' || map.frame!=='map'
    || !Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width<=0 || map.height<=0
    || !Number.isFinite(map.resolution) || map.resolution<=0
    || !['x','y','yaw'].every(k=>Number.isFinite(map.origin?.[k]))
    || !Array.isArray(map.data) || map.data.length!==map.width*map.height
    || map.data.some(v=>!Number.isInteger(v)||v < -1||v > 100)) throw new Error('地图数据无效');
  return map;
}
export function pixelToWorld(map, x, y) {
  const a=x*map.resolution,b=(map.height-y)*map.resolution,c=Math.cos(map.origin.yaw),s=Math.sin(map.origin.yaw);
  return {x:map.origin.x+a*c-b*s,y:map.origin.y+a*s+b*c};
}
export function worldToPixel(map, point) {
  const a=point.x-map.origin.x,b=point.y-map.origin.y,c=Math.cos(map.origin.yaw),s=Math.sin(map.origin.yaw);
  return {x:(a*c+b*s)/map.resolution,y:map.height-(-a*s+b*c)/map.resolution};
}
/** View transforms stay in CSS pixels, independently of canvas density. */
export function zoomViewport(view, factor, anchor, min, max) {
  const scale=Math.max(min,Math.min(max,view.scale*factor)),ratio=scale/view.scale;
  return {scale,x:anchor.x-(anchor.x-view.x)*ratio,y:anchor.y-(anchor.y-view.y)*ratio};
}
export function viewportToPixel(view, point) {
  return {x:(point.x-view.x)/view.scale,y:(point.y-view.y)/view.scale};
}
export function createMapView(stage, onSelect) {
  const canvas=document.createElement('canvas');canvas.className='navigation-map';
  canvas.setAttribute('aria-label','导航地图，滚轮缩放、拖动平移，点击空白区域填写目标');
  canvas.hidden=true;stage.append(canvas);
  const bitmap=document.createElement('canvas');
  const buttons=[...stage.parentElement.querySelectorAll('[data-map-action]')];
  let map=null,robot=null,goal=null,active=false,view={scale:1,x:0,y:0},fitScale=1,gesture=null;
  let width=0,height=0;
  const render=()=>{
    if(!map)return;
    const ctx=canvas.getContext('2d'),density=window.devicePixelRatio||1;
    ctx.setTransform(density,0,0,density,0,0);ctx.clearRect(0,0,width,height);
    ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(bitmap,0,0);
    const mark=(point,color)=>{
      if(!point)return;const p=worldToPixel(map,point);
      ctx.beginPath();ctx.arc(p.x,p.y,4/view.scale,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
      if(Number.isFinite(point.yaw)){
        const end=worldToPixel(map,{x:point.x+.2*Math.cos(point.yaw),y:point.y+.2*Math.sin(point.yaw)});
        ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(end.x,end.y);ctx.strokeStyle=color;ctx.lineWidth=2/view.scale;ctx.stroke();
      }
    };
    mark(goal,'#df9c36');mark(robot,'#3984ff');ctx.restore();
    canvas.style.cursor=gesture?'grabbing':active?'crosshair':'grab';
  };
  const fit=()=>{
    if(!map||!width||!height)return;
    fitScale=Math.min(width*.9/map.width,height*.9/map.height);
    view={scale:fitScale,x:(width-map.width*fitScale)/2,y:(height-map.height*fitScale)/2};render();
  };
  const resize=()=>{
    const oldWidth=width,oldHeight=height;
    width=stage.clientWidth;height=stage.clientHeight;
    const density=window.devicePixelRatio||1;
    canvas.width=Math.max(1,Math.round(width*density));canvas.height=Math.max(1,Math.round(height*density));
    if(map){
      if(!oldWidth||!oldHeight)fit();
      else{
        const center=viewportToPixel(view,{x:oldWidth/2,y:oldHeight/2});
        const nextFit=Math.min(width*.9/map.width,height*.9/map.height);
        view.scale*=nextFit/fitScale;fitScale=nextFit;
        view.x=width/2-center.x*view.scale;view.y=height/2-center.y*view.scale;render();
      }
    }
  };
  const point=event=>{const r=canvas.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};};
  const zoom=(factor,anchor={x:width/2,y:height/2})=>{
    if(!map)return;view=zoomViewport(view,factor,anchor,fitScale*.5,fitScale*8);render();
  };
  canvas.addEventListener('wheel',event=>{
    if(!map)return;event.preventDefault();zoom(Math.exp(-Math.max(-100,Math.min(100,event.deltaY))*.002),point(event));
  },{passive:false});
  canvas.addEventListener('pointerdown',event=>{
    if(!map||event.button!==0||gesture)return;
    gesture={id:event.pointerId,start:point(event),view:{...view},moved:false};
    canvas.setPointerCapture(event.pointerId);render();
  });
  canvas.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    const p=point(event),dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
    if(Math.hypot(dx,dy)>5)gesture.moved=true;
    if(gesture.moved){view={...gesture.view,x:gesture.view.x+dx,y:gesture.view.y+dy};render();}
  });
  const end=(event,canceled=false)=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    const moved=gesture.moved||Math.hypot(point(event).x-gesture.start.x,point(event).y-gesture.start.y)>5;
    gesture=null;
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    render();
    if(canceled||moved||!active||!map)return;
    const p=viewportToPixel(view,point(event)),col=Math.floor(p.x),row=map.height-1-Math.floor(p.y);
    if(col<0||col>=map.width||row<0||row>=map.height||map.data[row*map.width+col]!==0)return;
    onSelect(pixelToWorld(map,col+.5,map.height-row-.5));
  };
  canvas.addEventListener('pointerup',event=>end(event));
  canvas.addEventListener('pointercancel',event=>end(event,true));
  canvas.addEventListener('lostpointercapture',()=>{gesture=null;render();});
  for(const button of buttons)button.addEventListener('click',()=>{
    if(button.dataset.mapAction==='zoom-in')zoom(1.25);
    else if(button.dataset.mapAction==='zoom-out')zoom(.8);
    else if(robot&&map){const p=worldToPixel(map,robot);view.x=width/2-p.x*view.scale;view.y=height/2-p.y*view.scale;render();}
    else fit();
  });
  const observer=new ResizeObserver(resize);observer.observe(stage);resize();
  return {
    setMap(value){map=validateMap(value);bitmap.width=map.width;bitmap.height=map.height;
      const ctx=bitmap.getContext('2d'),image=ctx.createImageData(map.width,map.height);
      for(let row=0;row<map.height;row++)for(let col=0;col<map.width;col++){
        const v=map.data[row*map.width+col],i=((map.height-1-row)*map.width+col)*4;
        const color=v<0?70:Math.round(245*(1-v/100));image.data.set([color,color,color,255],i);
      }
      ctx.putImageData(image,0,0);canvas.hidden=false;stage.querySelector('.map-empty').hidden=true;
      for(const b of buttons)b.disabled=false;resize();fit();
    },
    update(pose,target,enabled){robot=pose;goal=target?{...target,yaw:target.yaw_deg*Math.PI/180}:null;active=enabled;render();},
    clear(){map=null;gesture=null;canvas.hidden=true;stage.querySelector('.map-empty').hidden=false;for(const b of buttons)b.disabled=true;},
    destroy(){observer.disconnect();canvas.remove();}
  };
}
