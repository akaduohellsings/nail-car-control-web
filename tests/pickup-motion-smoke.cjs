/* Entire service and camera are fixtures; every control request is intercepted. */
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:18765';
const draft=JSON.parse(fs.readFileSync(path.resolve(root,'../小车/config/pickup_ground_calibration.json'),'utf8'));
const server=http.createServer((req,res)=>{
 const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,base).pathname));
 if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(target,(error,data)=>{if(error){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(target)]||'application/octet-stream');res.end(data);});
});
const limits={linear_max_m_s:.3,angular_max_rad_s:Math.PI/4,defaults:{linear_m_s:.05,angular_rad_s:.24}};
let s={schema_version:1,read_only:false,bridge_instance_id:'fixture',connection:'ONLINE',age_seconds:0,stale_after_seconds:2.5,
 mission:{schema_version:1,mode:'nav2_with_calibrated_pickup',source_instance_id:'fixture',sequence:1,observed_at_ros_ns:'10000000000',
  state:'IDLE',saved_goal:null,target_event_id:null,attempt:0,max_attempts:3,alarm:null,pending:null,cleaning_mode:'calibrated_pickup',
  stationary_confirmed:true,halt_state:'NONE',owned_goal_id:null,goal_response_pending:false,action_server_ready:true},
 control:{schema_version:1,control_epoch:0,owner:'none',phase:'READY',controller_id:null,map_id:'map-fixture',localization_valid:true,
  lease_remaining_seconds:0,manual_direction:'stop',command_result:null,speed_limits:null,route:null},
 navigation:{robot_pose:{x:0,y:0,yaw:0},map_id:'map-fixture'},
 decision:{auto_pickup_enabled:false,cleaning_mode:'calibrated_pickup',collection_confirmed:false,pickup:{phase:'IDLE',action_count:0}},
 capabilities:{schema_version:1,environment:'robot_navigation',control_enabled:true,
  commands:['start','pause','resume','reset','stop','request_manual','release_manual','manual_intent','pickup_test'],
  speed_limits:limits,manual_control:{supported:true,directions:['stop','forward','backward','left','right'],speed_limits:limits},
  continuous_testing:true,stop_ends_task:true,waypoints:{supported:true,max_points:20},
  auto_pickup:{supported:true,cleaning_mode:'calibrated_pickup',speed_limits:{...limits,defaults:{linear_m_s:.04,angular_rad_s:.24}}}}};
(async()=>{
 await new Promise(resolve=>server.listen(18765,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const commands=[],errors=[];let jpeg;
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({base})=>localStorage.setItem('nail.connection.v1',JSON.stringify({schema_version:1,
   robotUrl:base,videoUrl:base,controlUrl:base,eventsUrl:base,navigationUrl:base,manualMode:'coordinated',followOperator:false})),{base});
  await page.route('**/*',route=>{
   if(new URL(route.request().url()).origin!==base)return route.abort();return route.continue();
  });
  await page.route('**/api/v1/**',route=>{
   const req=route.request(),url=new URL(req.url()).pathname;
   if(url.endsWith('/status')){s.mission.sequence++;return route.fulfill({json:s});}
   if(url.endsWith('/map'))return route.fulfill({json:{map_id:'map-fixture',frame:'map',width:40,height:40,resolution:.1,origin:{x:-1,y:-1,yaw:0},data:Array(1600).fill(0)}});
   if(url.endsWith('/observation'))return route.fulfill({json:{schema_version:1,capture_id:'capture-fixture',source_stamp_ns:'10000000000',source_age_seconds:.1,
    camera:draft.camera,boxes:[],image_jpeg_base64:jpeg,stationary:true,motion_command_sent:false,collection_confirmed:false,
    pickup_calibration:{calibration_id:'calibration-fixture',draft}}});
   const body=req.postDataJSON();
   if(url.endsWith('/heartbeat'))return route.fulfill({json:{schema_version:1,status:'accepted'}});
   if(url.endsWith('/command')){
    commands.push(body);const receipt={schema_version:1,bridge_instance_id:'fixture',request_id:body.request_id,command:body.command,status:'pending',reason:null};
    s.control.command_result=receipt;
    if(body.command==='stop'){
     receipt.status='succeeded';s.mission.state='IDLE';s.mission.stationary_confirmed=true;s.control.owner='none';s.control.controller_id=null;
    }else{
     s.control.controller_id=body.session_id;s.control.control_epoch++;s.control.owner='automatic';s.control.lease_remaining_seconds=3;
     s.mission.state=body.command==='pickup_test'?'CLEANING':'NAVIGATING';s.mission.stationary_confirmed=false;
     s.decision.auto_pickup_enabled=!!body.auto_pickup;s.decision.pickup.phase='ALIGN';
    }
    return route.fulfill({json:receipt});
   }
   return route.fulfill({status:404,json:{error:'FIXTURE_ONLY'}});
  });
  await page.goto(base+'/pickup-localization.html');
  jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');ctx.fillStyle='#dbddd7';ctx.fillRect(0,0,640,480);return c.toDataURL('image/jpeg').split(',')[1];});
  assert.equal(commands.length,0);
  await page.click('#captureButton');await page.waitForFunction(()=>document.getElementById('captureStatus').textContent.includes('已获取'));
  await page.click('#loadServiceCalibration');await page.check('#mountConfirmed');
  const point=draft.fit[5],box=await page.locator('#photo').boundingBox();
  await page.mouse.click(box.x+point.u/640*box.width,box.y+point.v/480*box.height);
  await page.fill('#pickupLinearSpeed','.12');await page.fill('#pickupAngularSpeed','30');await page.click('#savePickupSpeed');
  assert.equal(await page.isDisabled('#pickupTestButton'),true);await page.check('#pickupTestConditions');
  await page.waitForFunction(()=>!document.getElementById('pickupTestButton').disabled);
  assert.equal(commands.length,0);await page.click('#pickupTestButton');
  await page.waitForFunction(()=>document.getElementById('pickupTestStatus').textContent.includes('对准目标'));
  assert.equal(commands[0].command,'pickup_test');assert.equal(commands[0].capture_id,'capture-fixture');
  assert.equal(commands[0].pickup_speed_limits.linear_m_s,.12);assert.ok(Math.abs(commands[0].pickup_speed_limits.angular_rad_s-Math.PI/6)<1e-12);
  assert.equal(commands[0].goal,undefined);assert.equal(await page.isDisabled('#pickupTestButton'),true);
  await page.click('#pickupStopButton');await page.waitForFunction(()=>document.getElementById('pickupStopButton').disabled===false);
  assert.equal(commands.at(-1).command,'stop');
  await page.goto(base+'/navigation.html');await page.click('#connectButton');
  await page.waitForFunction(()=>!document.getElementById('autoPickup').disabled);
  await page.fill('#goalX','.7');await page.fill('#goalY','0');await page.fill('#goalYaw','0');
  assert.equal(await page.inputValue('#pickupLinearSpeed'),'0.12');assert.equal(await page.inputValue('#pickupAngularSpeed'),'30');
  await page.fill('#pickupLinearSpeed','.31');await page.click('#startButton');
  await page.waitForFunction(()=>document.getElementById('missionState').textContent.includes('导航中'));
  assert.equal(commands.at(-1).auto_pickup,false);assert.equal(commands.at(-1).pickup_speed_limits,undefined);
  await page.click('#stopButton');await page.waitForFunction(()=>!document.getElementById('autoPickup').disabled);
  await page.fill('#pickupLinearSpeed','.12');await page.check('#autoPickup');
  await page.click('#startButton');await page.waitForFunction(()=>document.getElementById('missionState').textContent.includes('导航中'));
  assert.equal(commands.at(-1).command,'start');assert.equal(commands.at(-1).auto_pickup,true);
  assert.equal(commands.at(-1).pickup_speed_limits.linear_m_s,.12);assert.match(await page.textContent('#autoPickupLabel'),/磁铁拾取/);
  s.mission.state='CLEANING';s.decision.pickup.phase='APPROACH';
  await page.waitForFunction(()=>document.getElementById('decisionStatus').textContent.includes('接近并通过钉子'));
  assert.equal(await page.isDisabled('#pickupLinearSpeed'),true);assert.equal(await page.isDisabled('#stopButton'),false);
  const out=path.join(root,'.local/pickup-motion');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'navigation-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(out,'navigation-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'browser-validation.json'),JSON.stringify({passed:true,fixture_only:true,commands,physical_acceptance_complete:false},null,2));
  console.log('PASS: manual pixel pickup, explicit conditions, separate speed drafts, Stop, calibrated navigation, mobile; intercepted fixtures only.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
