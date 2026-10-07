/* Isolated browser fixture. All observations/images are simulated; no robot I/O. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const {fixture}=await import('./pickup-geometry.test.mjs');const draft=fixture(),base='http://127.0.0.1:18764';
 const output=path.join(__dirname,'../.local/pickup-static');fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({base})=>localStorage.setItem('nail.connection.v1',JSON.stringify({schema_version:1,
   robotUrl:base,videoUrl:base,controlUrl:base,eventsUrl:base,navigationUrl:base,manualMode:'coordinated',followOperator:false})),{base});
  await page.route('**/*',route=>{
   const request=route.request();requests.push({method:request.method(),url:request.url()});
   if(new URL(request.url()).origin!==base)return route.abort();return route.continue();
  });
  let mode='ok',jpeg,initialStopPending=true;
  await page.route('**/api/v1/pickup/observation',route=>{
   requests.push({method:route.request().method(),url:route.request().url()});
   if(mode==='moving'||initialStopPending){initialStopPending=false;return route.fulfill({status:409,json:{error:'STATIONARY_SNAPSHOT_REQUIRED'}});}
   return route.fulfill({json:{schema_version:1,capture_id:'test-only',source_stamp_ns:'10000000000',source_age_seconds:.1,
      camera:draft.camera,boxes:[{u:320,v:240,width:20,height:10,confidence:.9}],stationary:true,
      image_jpeg_base64:jpeg,motion_command_sent:false,collection_confirmed:false}});
  });
  await page.goto(base+'/pickup-localization.html');
  jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');
   ctx.fillStyle='#e0e4df';ctx.fillRect(0,0,640,480);ctx.strokeStyle='#6b7870';
   for(let x=0;x<640;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,480);ctx.stroke();}
   for(let y=0;y<480;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(640,y);ctx.stroke();}
   ctx.fillStyle='#23342b';ctx.fillRect(312,232,16,16);return c.toDataURL('image/jpeg').split(',')[1];});
  assert.equal(await page.textContent('#forwardDistance'),'—');
  await page.click('#captureButton');await page.waitForFunction(()=>document.getElementById('captureStatus').textContent.includes('已获取'));
  assert.equal(requests.filter(r=>r.url.includes('/api/v1/pickup/observation')).length,2);
  assert.equal(await page.locator('#targetSelect option').count(),2);
  const canvas=page.locator('#photo');
  async function clickPoint(p){const b=await canvas.boundingBox();await page.mouse.click(b.x+1+p.u/640*(b.width-2),b.y+1+p.v/480*(b.height-2));}
  for(const [key,button] of [['fit','#addFit'],['checks','#addCheck']])for(const p of draft[key]){
   await clickPoint(p);await page.fill('#pointX',String(p.x_m*100));await page.fill('#pointY',String(p.y_m*100));await page.click(button);
  }
  assert.equal(await page.locator('#pointRows tr').count(),8);
  for(const [id,value] of [['#magnetX','20'],['#magnetY','0'],['#magnetWidth','15'],['#mountNote','TEST ONLY · simulated camera and magnet']])await page.fill(id,value);
  await page.click('#saveCalibration');assert.match(await page.textContent('#calibrationStatus'),/核验通过/);
  await page.check('#mountConfirmed');await page.selectOption('#targetSelect','0');
  assert.ok(Math.abs(parseFloat(await page.textContent('#forwardDistance'))-60)<.5);assert.match(await page.textContent('#sweepResult'),/带内/);
  assert.ok(await page.locator('#groundPreview circle').count());
  await page.screenshot({path:path.join(output,'desktop-test.png'),fullPage:true});
  // Refresh keeps only measured data; the mounting assertion and snapshot are never reused.
  await page.reload();assert.equal(await page.isChecked('#mountConfirmed'),false);assert.equal(await page.textContent('#forwardDistance'),'—');
  await page.click('#captureButton');await page.waitForFunction(()=>document.getElementById('captureStatus').textContent.includes('已获取'));
  await page.check('#mountConfirmed');await clickPoint({u:10,v:10});assert.match(await page.textContent('#targetStatus'),/区域之外/);
  mode='moving';await page.click('#captureButton');await page.waitForFunction(()=>document.getElementById('captureStatus').textContent.includes('尚未确认停稳'));
  assert.equal(await page.textContent('#forwardDistance'),'—');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(output,'mobile-test.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));
  fs.writeFileSync(path.join(output,'browser-validation.json'),JSON.stringify({passed:true,
   fixture_only:true,requests,control_requests_sent:false,physical_acceptance_complete:false},null,2));
  console.log('PASS: same-frame fixture, 6 fit + 2 holdouts, measured magnet, persistence, out-of-region, moving rejection, desktop/mobile; GET only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
