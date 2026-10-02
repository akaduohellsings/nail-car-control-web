/** Every lost input cancels the hold. Reconnect never resumes a previous hold. */
export function bindManualInput({buttons, canMove, move, stop, stopAll = stop, repeat = () => false, onError = () => {},
  documentRef = document, windowRef = window}) {
  let held = null, timer = null;
  function cancel(sendStop=true) {
    const previous=held; held=null; clearTimeout(timer);
    if (previous&&sendStop) Promise.resolve(stop()).catch(onError);
  }
  function begin(direction) {
    if (direction === 'stop') {held=null;clearTimeout(timer);Promise.resolve(stopAll()).catch(onError);return;}
    if (held || !canMove(direction)) return;
    const hold={direction}; held=hold;
    const tick=async()=>{
      if(held!==hold)return;
      if(!canMove(direction)){cancel();return;}
      try {
        await move(direction);
        if(held===hold && repeat())timer=setTimeout(tick,150);
      } catch(error) {
        // The operator may already have released the button while awaiting HTTP.
        if(held===hold)cancel();
        onError(error);
      }
    };
    void tick();
  }
  for(const button of buttons){
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;event.preventDefault();
      button.setPointerCapture(event.pointerId);begin(button.dataset.cmd);
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,cancel);
    button.addEventListener('keydown',event=>{
      if([' ','Enter'].includes(event.key)&&!event.repeat){event.preventDefault();begin(button.dataset.cmd);}
    });
    button.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();cancel();}});
  }
  windowRef.addEventListener('blur',cancel);
  windowRef.addEventListener('pagehide',cancel);
  documentRef.addEventListener('visibilitychange',()=>{if(documentRef.hidden)cancel();});
  return {cancel, get holding(){return held!==null;}};
}
