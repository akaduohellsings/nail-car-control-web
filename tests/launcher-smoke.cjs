const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin==='http://localhost:8000'?route.continue():route.abort());
    await page.goto('http://localhost:8000/navigation.html?simulation=1');
    await page.click('#settingsButton');
    assert.equal(await page.inputValue('input[name=navigationUrl]'),'http://localhost:8000');
    assert.equal(await page.locator('dialog button[type=submit]').isDisabled(),true);
    await page.click('[data-close]');await page.click('#connectButton');
    await page.waitForFunction(()=>!document.getElementById('resetButton').disabled);
    await page.click('#resetButton');
    await page.fill('#goalX','0.4');await page.fill('#goalY','0');await page.fill('#goalYaw','0');
    await page.waitForFunction(()=>!document.getElementById('startButton').disabled);
    await page.click('#startButton');
    await page.waitForFunction(()=>document.getElementById('missionState').textContent==='导航中');
    await page.locator('nav a[href="index.html?simulation=1"]').click();
    await page.click('#connectTaskButton');
    await page.waitForFunction(()=>!document.getElementById('requestManualButton').disabled);
    await page.click('#requestManualButton');
    await page.waitForFunction(()=>!document.querySelector('[data-cmd=forward]').disabled);
    await page.click('#releaseManualButton');
    await page.waitForFunction(async()=>{
      const data=await(await fetch('/api/v1/status')).json();
      return data.control.controller_id===null&&data.control.phase==='PAUSED'
        &&data.control.command_result?.command==='release_manual'&&data.control.command_result.status==='succeeded';
    });
    await page.click('a[href="navigation.html?simulation=1"]');await page.click('#connectButton');
    await page.waitForFunction(()=>document.getElementById('missionState').textContent==='已暂停');
    assert.deepEqual(errors,[]);
    console.log('PASS launcher: localhost:8000 same-origin simulator, preview preserves saved addresses, page links retain simulation, release confirms ownership relinquished and navigation stays paused.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
