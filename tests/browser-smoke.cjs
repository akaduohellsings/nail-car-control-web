/* Run against the local static server and physical-I/O-free simulator. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[],commands=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      const original=window.fetch.bind(window);
      window.fetch=(url,options={})=>{
        if(String(url).includes('/events'))return Promise.resolve(new Response(JSON.stringify({detected:false,count:0,message:'模拟无钉子'}),{headers:{'Content-Type':'application/json'}}));
        if(String(url).includes('/stream?')){
          const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
          const bytes=Uint8Array.from(atob(canvas.toDataURL('image/jpeg').split(',')[1]),c=>c.charCodeAt(0));
          let timer;
          return Promise.resolve(new Response(new ReadableStream({
            start(controller){
              timer=setInterval(()=>{if(!window.__webTestVideoPaused)controller.enqueue(bytes);},150);
              options.signal?.addEventListener('abort',()=>{clearInterval(timer);controller.error(new DOMException('Aborted','AbortError'));});
            },cancel(){clearInterval(timer);}
          }),{headers:{'Content-Type':'multipart/x-mixed-replace; boundary=test'}}));
        }
        return original(url,options);
      };
    });
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(!['http://127.0.0.1:8001','http://127.0.0.1:8093'].includes(url.origin))return route.abort();
      if(request.method()==='POST'&&url.pathname==='/api/v1/command')commands.push(request.postDataJSON());
      return route.continue();
    });
    await page.goto('http://127.0.0.1:8001/index.html');
    await page.waitForFunction(()=>document.getElementById('cameraTime').textContent.startsWith('接收'));
    assert.equal(await page.locator('#videoStatus').innerText(),'正在接收画面');
    await page.waitForFunction(()=>document.getElementById('detectionStatus').textContent.includes('源时间未提供'));
    assert.equal(await page.locator('[data-cmd=forward]').isDisabled(),true);
    await page.click('#settingsButton');await page.selectOption('select[name=preset]','usb');
    await page.locator('dialog details').evaluate(element=>element.open=true);
    await page.fill('input[name=navigationUrl]','http://127.0.0.1:8093');
    await page.selectOption('select[name=manualMode]','coordinated');await page.click('dialog button[type=submit]');
    await page.click('a[href="navigation.html"]');await page.click('#settingsButton');
    assert.equal(await page.inputValue('input[name=controlUrl]'),'http://192.168.55.1:5000');
    await page.click('[data-close]');await page.click('#connectButton');
    await page.waitForFunction(()=>!document.getElementById('resetButton').disabled);
    await page.click('#resetButton');
    await page.waitForFunction(()=>document.getElementById('missionState').textContent==='待命');
    await page.fill('#goalX','0.4');await page.fill('#goalY','0');await page.fill('#goalYaw','0');
    await page.waitForFunction(()=>!document.getElementById('startButton').disabled);await page.click('#startButton');
    await page.waitForFunction(()=>document.getElementById('missionState').textContent==='导航中');
    // Changing page revokes the old controller. The next page must apply afresh.
    await page.locator('nav a[href="index.html"]').click();await page.click('#connectTaskButton');
    await page.waitForFunction(()=>!document.getElementById('requestManualButton').disabled);
    assert.equal(await page.locator('[data-cmd=forward]').isDisabled(),true);
    await page.click('#requestManualButton');
    await page.waitForFunction(()=>!document.querySelector('[data-cmd=forward]').disabled);
    assert.equal(await page.locator('[data-cmd=left_forward]').isDisabled(),true);
    const box=await page.locator('[data-cmd=forward]').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.waitForFunction(async()=>{const d=await(await fetch('http://127.0.0.1:8093/api/v1/status')).json();return d.control.manual_direction==='forward';});
    await page.mouse.up();
    await page.waitForFunction(async()=>{const d=await(await fetch('http://127.0.0.1:8093/api/v1/status')).json();return d.control.manual_direction==='stop';});
    await page.click('#releaseManualButton');
    await page.waitForFunction(()=>document.querySelector('[data-cmd=forward]').disabled);
    const snapshot=await(await page.request.get('http://127.0.0.1:8093/api/v1/status')).json();
    assert.equal(snapshot.mission.state,'PAUSED');
    assert.equal(snapshot.control.manual_direction,'stop');
    for(let i=0;i<60;i++)await page.evaluate(i=>window.addEvent('🔩','event '+i),i);
    assert.equal(await page.locator('#eventsList li').count(),50);
    assert.match(await page.locator('#eventsList li').first().innerText(),/event 10/);
    await page.evaluate(()=>window.addMessage('event','<img src=x onerror="alert(1)">'));
    assert.equal(await page.locator('#messagesList img').count(),0);
    await page.evaluate(()=>window.__webTestVideoPaused=true);
    await page.waitForFunction(()=>document.getElementById('videoStatus').textContent.includes('视频不可用'),{},{timeout:10000});
    await page.evaluate(()=>window.__webTestVideoPaused=false);
    await page.waitForFunction(()=>document.getElementById('videoStatus').textContent==='正在接收画面');
    assert.deepEqual(errors,[]);
    assert.ok(commands.some(command=>command.command==='request_manual'));
    assert.ok(commands.some(command=>command.command==='manual_intent'&&command.direction==='forward'));
    console.log('PASS: shared settings, navigation → manual takeover, hold/release, release stays PAUSED, latest 50 events, safe text, video frame time/stall/reconnect, event freshness; all control simulated.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
