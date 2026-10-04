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
export function createMapView(stage, onSelect) {
  const canvas=document.createElement('canvas');canvas.className='navigation-map';
  canvas.setAttribute('aria-label','导航地图，点击可填写目标坐标');
  canvas.hidden=true;stage.append(canvas);
  let map=null, robot=null,goal=null,active=false, image=null;
  const render=()=>{
    if(!map)return;
    const ctx=canvas.getContext('2d');ctx.putImageData(image,0,0);
    const mark=(point,color)=>{
      if(!point)return;const p=worldToPixel(map,point);
      ctx.beginPath();ctx.arc(p.x,p.y,2.8,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
      if(Number.isFinite(point.yaw)){
        const end=worldToPixel(map,{x:point.x+.2*Math.cos(point.yaw),y:point.y+.2*Math.sin(point.yaw)});
        ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(end.x,end.y);ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.stroke();
      }
    };
    mark(goal,'#df9c36');mark(robot,'#3984ff');canvas.style.cursor=active?'crosshair':'default';
  };
  canvas.addEventListener('click',event=>{
    if(!active||!map)return;const rect=canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)*map.width/rect.width,y=(event.clientY-rect.top)*map.height/rect.height;
    const col=Math.floor(x),row=map.height-1-Math.floor(y);
    if(col<0||col>=map.width||row<0||row>=map.height||map.data[row*map.width+col]!==0)return;
    onSelect(pixelToWorld(map,col+.5,map.height-row-.5));
  });
  return {
    setMap(value){map=validateMap(value);canvas.width=map.width;canvas.height=map.height;
      canvas.style.width=`min(90%, ${560*map.width/map.height}px)`;
      const ctx=canvas.getContext('2d');image=ctx.createImageData(map.width,map.height);
      for(let row=0;row<map.height;row++)for(let col=0;col<map.width;col++){
        const v=map.data[row*map.width+col],i=((map.height-1-row)*map.width+col)*4;
        const color=v<0?70:Math.round(245*(1-v/100));
        image.data.set([color,color,color,255],i);
      }
      canvas.hidden=false;stage.querySelector('.map-empty').hidden=true;render();
    },
    update(pose,target,enabled){robot=pose;goal=target?{...target,yaw:target.yaw_deg*Math.PI/180}:null;active=enabled;render();},
    clear(){map=null;canvas.hidden=true;stage.querySelector('.map-empty').hidden=false;}
  };
}
