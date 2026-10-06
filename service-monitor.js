/** Poll serially, cap each request and discard replies from old addresses. */
export function createEventMonitor({onStatus,onEvent,fetcher=fetch}) {
  let generation=0,timer=null,controller=null,last=null,seen=new Set(),order=[];
  function stop(){generation++;clearTimeout(timer);controller?.abort();last=null;seen.clear();order=[];}
  function start(baseUrl){
    stop();const epoch=generation;
    const poll=async()=>{
      controller=new AbortController();const abort=controller,timeout=setTimeout(()=>abort.abort(),1800);
      try{
        const response=await fetcher(baseUrl+'/events',{cache:'no-store',signal:abort.signal});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const data=await response.json();
        if(epoch!==generation)return;
        if(typeof data.detected!=='boolean'||!Number.isSafeInteger(data.count)||data.count<0||typeof data.message!=='string'
          ||data.detected!==(data.count>0)||(data.event_id!==undefined&&(typeof data.event_id!=='string'||!data.event_id)))
          throw new Error('检测事件格式异常');
        const stamp=data.observed_at_ros_ns;
        let fresh=null;
        if(stamp!==undefined){
          if(!/^[0-9]+$/.test(String(stamp)))throw new Error('检测时间格式异常');
          const age=(Date.now()-Number(BigInt(stamp)/1000000n))/1000;
          fresh=age>=-3&&age<=3;
        }
        onStatus({state:fresh===false?'STALE':'ONLINE',receivedAt:Date.now(),sourceFresh:fresh});
        if(fresh===false)return;
        const eventId=data.event_id;
        const changed=!last?.detected||last.count!==data.count;
        if(data.detected&&(eventId? !seen.has(eventId):changed))onEvent(data);
        if(eventId&&!seen.has(eventId)){
          seen.add(eventId);order.push(eventId);if(order.length>128)seen.delete(order.shift());
        }
        last={detected:data.detected,count:data.count};
      }catch(error){if(epoch===generation)onStatus({state:'UNREACHABLE',error:error.message});}
      finally{
        clearTimeout(timeout);
        if(epoch===generation)timer=setTimeout(poll,1000);
      }
    };
    void poll();
  }
  return {start,stop};
}

/** MJPEG bytes may split anywhere; retain only one unfinished JPEG. */
export function createJpegParser(onFrame) {
  let buffer=new Uint8Array();
  return chunk=>{
    const joined=new Uint8Array(buffer.length+chunk.length);joined.set(buffer);joined.set(chunk,buffer.length);buffer=joined;
    let start=-1;
    for(let i=0;i+1<buffer.length;i++){
      if(start<0&&buffer[i]===255&&buffer[i+1]===216)start=i;
      else if(start>=0&&buffer[i]===255&&buffer[i+1]===217){
        onFrame(buffer.slice(start,i+2));buffer=buffer.slice(i+2);i=-1;start=-1;
      }
    }
    if(buffer.length>4*1024*1024)throw new Error('视频帧超过大小限制');
    if(start>0)buffer=buffer.slice(start);
    else if(start<0)buffer=buffer.slice(-1);
  };
}

export function videoStreamUrl(baseUrl,topic) {
  if(typeof topic!=='string'||!/^\/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/.test(topic))
    throw new Error('图像话题格式无效');
  // Legacy async_web_server_cpp passes query values directly to ROS.
  return baseUrl.replace(/\/$/,'')+'/stream?topic='+topic;
}

export function createVideoMonitor({image,onStatus,fetcher=fetch,now=()=>Date.now(),
    clock={setTimeout:(...args)=>globalThis.setTimeout(...args),clearTimeout:id=>globalThis.clearTimeout(id),
      setInterval:(...args)=>globalThis.setInterval(...args),clearInterval:id=>globalThis.clearInterval(id)}}) {
  let generation=0,abort=null,retry=null,watchdog=null,blobUrl=null,url='',attempt=0;
  function clear(){
    clock.clearTimeout(retry);clock.clearInterval(watchdog);abort?.abort();
    image.onload=null;image.onerror=null;image.removeAttribute('src');
    if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}
  }
  function stop(){generation++;clear();onStatus({state:'PAUSED'});}
  function start(baseUrl,topic='/detected_image'){
    stop();url=videoStreamUrl(baseUrl,topic);attempt=0;
    const epoch=generation;
    const failed=(error,state='UNREACHABLE')=>{
      if(epoch!==generation)return;
      clear();const delay=Math.min(30000,2000*2**Math.min(attempt++,4));
      onStatus({state,retrySeconds:delay/1000,error:error.message,url,topic});
      retry=clock.setTimeout(connect,delay);
    };
    const fallback=()=>{
      if(epoch!==generation)return;
      onStatus({state:'UNVERIFIED',url,topic});
      image.onload=()=>{if(epoch===generation)onStatus({state:'UNVERIFIED',loaded:true,url,topic});};
      image.onerror=()=>failed(new Error('视频连接失败'));
      image.src=url;
      let waited=0;
      watchdog=clock.setInterval(()=>{
        if(image.naturalWidth){clock.clearInterval(watchdog);onStatus({state:'UNVERIFIED',loaded:true,url,topic});}
        else if(++waited>=10)failed(new Error('兼容模式未加载图像，请检查视频地址和画面来源'));
      },1000);
    };
    const connect=async()=>{
      if(epoch!==generation)return;
      onStatus({state:'CONNECTING',url,topic});abort=new AbortController();const ownAbort=abort;
      let receivedAt=now(),responseReceived=false,streamConnected=false,frames=0,timedOut=false;
      watchdog=clock.setInterval(()=>{if(now()-receivedAt>5000){timedOut=true;ownAbort.abort();}},500);
      try{
        const response=await fetcher(url,{signal:ownAbort.signal,cache:'no-store'});
        responseReceived=true;
        if(epoch!==generation){await response.body?.cancel();return;}
        if(!response.ok||!response.body)throw new Error('视频服务返回 '+response.status);
        streamConnected=true;
        receivedAt=now();
        onStatus({state:'WAITING_FRAMES',url,topic});
        const parser=createJpegParser(bytes=>{
          if(epoch!==generation)return;
          receivedAt=now();attempt=0;frames++;
          const next=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'})),previous=blobUrl;
          blobUrl=next;image.src=next;if(previous)URL.revokeObjectURL(previous);
          onStatus({state:'ONLINE',receivedAt,url,topic});
        });
        const reader=response.body.getReader();
        try{
          while(epoch===generation){const {value,done}=await reader.read();if(done)break;parser(value);}
        }finally{reader.releaseLock();ownAbort.abort();}
        if(epoch===generation)throw new Error('视频流已结束');
      }catch(error){
        if(epoch!==generation)return;
        clock.clearInterval(watchdog);
        // Legacy MJPEG servers may omit CORS. An <img> can display them,
        // but cannot expose per-frame freshness to JavaScript.
        if(!responseReceived&&!timedOut&&error.name==='TypeError')fallback();
        else if(streamConnected)failed(new Error(frames?'视频流已中断，请检查画面源和网络':'视频服务已连接，但没有收到该画面的图像'),frames?'STALLED':'NO_FRAMES');
        else failed(timedOut?new Error('视频服务连接超时，请检查小车地址、8080端口和启动状态'):error);
      }
    };
    void connect();
  }
  return {start,stop};
}
