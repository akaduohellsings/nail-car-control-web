import {addressesFor, PRESETS, loadConfig, saveConfig, isSimulationPage,readOperatorConnection,operatorConnection} from './connection-config.js?v=20261006-video-network';

export function installSettings(button, onSaved) {
  const dialog = document.createElement('dialog');
  dialog.className = 'connection-settings';
  dialog.innerHTML = `<form><div class="settings-heading"><strong>连接设置 · 两个页面共用</strong><button type="button" data-close aria-label="关闭">✕</button></div>
    <p>保存只修改连接地址；不会启动服务或移动小车。</p>
    <label>连接方式 <select name="preset"><option value="custom">自定义</option><option value="computer">电脑热点</option><option value="hotspot">小车热点</option><option value="usb">Type-C</option></select></label>
    <label>小车地址 <input name="robotUrl" type="url" required></label>
    <p>电脑热点填写小车获得的 IP，例如 192.168.137.2；不是电脑的网关地址。IP 可修改。</p>
    <label class="follow-operator"><input name="followOperator" type="checkbox"> 跟随本地启动配置中的小车地址</label>
    <button type="button" data-operator>使用启动配置</button>
    <button type="button" data-addresses>按小车地址更新服务</button>
    <details><summary>服务地址（可分别设置）</summary>
      <label>视频服务 <input name="videoUrl" type="url" required></label>
      <label>旧手动服务 <input name="controlUrl" type="url" required></label>
      <label>检测事件服务 <input name="eventsUrl" type="url" required></label>
      <label>导航任务服务 <input name="navigationUrl" type="url"></label>
    </details>
    <label>手动控制方式 <select name="manualMode"><option value="standalone">独立手动 · 需关闭导航</option><option value="coordinated">任务协调 · 当前仅本地模拟</option></select></label>
    <p>切换页面沿用地址；每个页面重新获取状态和控制权。</p>
    <p data-error role="alert"></p><button type="submit">保存设置</button></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  if(isSimulationPage()){
    dialog.querySelector('strong').textContent='本地模拟预览 · 原连接设置保留';
    for(const field of form.querySelectorAll('input,select,button[type=submit]'))field.disabled=true;
    dialog.querySelector('[data-operator]').disabled=true;
    dialog.querySelector('[data-addresses]').disabled=true;
    for(const link of document.querySelectorAll('a[href="index.html"],a[href="navigation.html"]'))
      link.href=link.getAttribute('href')+'?simulation=1';
  }
  const fields = ['robotUrl','videoUrl','controlUrl','eventsUrl','navigationUrl','manualMode'];
  let editVersion=0;
  const fill = config => {for (const key of fields) form.elements[key].value = config[key];form.elements.followOperator.checked=config.followOperator===true;};
  const applyRobot = () => {
    try {fill({...addressesFor(form.elements.robotUrl.value.trim()), manualMode:form.elements.manualMode.value,followOperator:false}); dialog.querySelector('[data-error]').textContent='';}
    catch(error) {dialog.querySelector('[data-error]').textContent=error.message;}
  };
  form.elements.preset.addEventListener('change', () => {
    const value = PRESETS[form.elements.preset.value];
    if (value) {form.elements.robotUrl.value=value; applyRobot();}
  });
  form.elements.robotUrl.addEventListener('change', applyRobot);
  dialog.querySelector('[data-addresses]').addEventListener('click',()=>{editVersion++;applyRobot();});
  form.addEventListener('input',()=>{editVersion++;});
  for(const name of ['robotUrl','videoUrl','controlUrl','eventsUrl','navigationUrl'])form.elements[name].addEventListener('input',()=>{form.elements.followOperator.checked=false;});
  const useOperator=async()=>{
    const version=editVersion,config=await readOperatorConnection();
    if(version!==editVersion)return;
    if(!config){form.elements.followOperator.checked=false;dialog.querySelector('[data-error]').textContent='未读取到启动配置，请重启电脑网页服务，或手动填写小车地址。';return;}
    fill({...config,manualMode:form.elements.manualMode.value});form.elements.preset.value='custom';
    dialog.querySelector('[data-error]').textContent='已填入启动地址，请核对后保存。';
  };
  dialog.querySelector('[data-operator]').addEventListener('click',()=>void useOperator());
  form.elements.followOperator.addEventListener('change',()=>{if(form.elements.followOperator.checked)void useOperator();});
  button.addEventListener('click', () => {fill(loadConfig());form.elements.preset.value='custom';dialog.querySelector('[data-error]').textContent='';dialog.showModal();});
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const config = saveConfig({...Object.fromEntries(fields.map(key => [key,form.elements[key].value.trim()])),followOperator:form.elements.followOperator.checked});
      dialog.close(); onSaved(config);
    } catch(error) {dialog.querySelector('[data-error]').textContent='未保存：'+error.message;}
  });
  window.addEventListener('storage', event => {
    if (event.key === 'nail.connection.v1' && !isSimulationPage()) {dialog.close(); onSaved(loadConfig());}
  });
  if(!isSimulationPage())void readOperatorConnection().then(recommended=>{
    if(!recommended||editVersion||dialog.open)return;
    const current=loadConfig(),next=operatorConnection(current,recommended);
    if(JSON.stringify(current)===JSON.stringify(next))return;
    try{saveConfig(next);onSaved(next);}catch{/* Manual settings remain usable if storage is unavailable. */}
  });
  return dialog;
}
