import {addressesFor, PRESETS, loadConfig, saveConfig} from './connection-config.js';

export function installSettings(button, onSaved) {
  const dialog = document.createElement('dialog');
  dialog.className = 'connection-settings';
  dialog.innerHTML = `<form><div class="settings-heading"><strong>连接设置 · 两个页面共用</strong><button type="button" data-close aria-label="关闭">✕</button></div>
    <p>保存只修改连接地址；不会启动服务或移动小车。</p>
    <label>连接方式 <select name="preset"><option value="custom">自定义</option><option value="hotspot">小车热点</option><option value="usb">Type-C</option></select></label>
    <label>小车地址 <input name="robotUrl" type="url" required></label>
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
  const fields = ['robotUrl','videoUrl','controlUrl','eventsUrl','navigationUrl','manualMode'];
  const fill = config => {for (const key of fields) form.elements[key].value = config[key];};
  const applyRobot = () => {
    try {fill({...addressesFor(form.elements.robotUrl.value.trim()), manualMode:form.elements.manualMode.value}); dialog.querySelector('[data-error]').textContent='';}
    catch(error) {dialog.querySelector('[data-error]').textContent=error.message;}
  };
  form.elements.preset.addEventListener('change', () => {
    const value = PRESETS[form.elements.preset.value];
    if (value) {form.elements.robotUrl.value=value; applyRobot();}
  });
  form.elements.robotUrl.addEventListener('change', applyRobot);
  button.addEventListener('click', () => {fill(loadConfig());form.elements.preset.value='custom';dialog.querySelector('[data-error]').textContent='';dialog.showModal();});
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const config = saveConfig(Object.fromEntries(fields.map(key => [key,form.elements[key].value.trim()])));
      dialog.close(); onSaved(config);
    } catch(error) {dialog.querySelector('[data-error]').textContent='未保存：'+error.message;}
  });
  window.addEventListener('storage', event => {
    if (event.key === 'nail.connection.v1') {dialog.close(); onSaved(loadConfig());}
  });
  return dialog;
}
