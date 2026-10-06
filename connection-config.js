/** Shared addresses; saving settings never starts hardware or sends commands. */
export const CONFIG_KEY = 'nail.connection.v1';
export const PRESETS = { hotspot: 'http://192.168.0.100', computer: 'http://192.168.137.2', usb: 'http://192.168.55.1' };
export function isSimulationPage(locationRef = globalThis.location) {
  return !!locationRef && ['localhost','127.0.0.1','[::1]'].includes(locationRef.hostname)
    && new URLSearchParams(locationRef.search).get('simulation') === '1';
}
export function normalizeUrl(value, {optional = false} = {}) {
  if (!value && optional) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('地址必须是 HTTP/HTTPS，不能包含密码、查询参数或片段');
  return url.href.replace(/\/$/, '');
}
export function addressesFor(robotUrl) {
  const root = new URL(normalizeUrl(robotUrl));
  if (root.pathname !== '/') throw new Error('小车地址只填写协议与 IP，不填写路径');
  const port = number => { const url = new URL(root); url.port = number; return url.origin; };
  return {robotUrl: root.origin, videoUrl: port(8080), controlUrl: port(5000),
    eventsUrl: port(5001), navigationUrl: port(8092)};
}
function legacyFollowsOperator(value) {
  const hosts=new Set(Object.values(PRESETS).map(url=>new URL(url).hostname));
  if(!hosts.has(new URL(value.robotUrl).hostname))return false;
  return [['videoUrl',8080],['controlUrl',5000],['eventsUrl',5001],['navigationUrl',8092]].every(([key,port])=>{
    if(!value[key])return false;
    const url=new URL(value[key]);
    return hosts.has(url.hostname)&&url.pathname==='/'&&(url.port===String(port)||(key==='navigationUrl'&&url.port==='8091'));
  });
}
export function validateConfig(value) {
  const config = {schema_version: 1};
  for (const key of ['robotUrl','videoUrl','controlUrl','eventsUrl','navigationUrl'])
    config[key] = normalizeUrl(value[key], {optional: key === 'navigationUrl'});
  config.manualMode = value.manualMode === 'coordinated' ? 'coordinated' : 'standalone';
  if(value.followOperator!==undefined&&typeof value.followOperator!=='boolean')throw new Error('启动地址跟随设置无效');
  config.followOperator=value.followOperator??legacyFollowsOperator(config);
  return config;
}
export function loadConfig(storage = localStorage) {
  if(isSimulationPage())return validateConfig({robotUrl:location.origin,videoUrl:location.origin,
    controlUrl:location.origin,eventsUrl:location.origin,navigationUrl:location.origin,manualMode:'coordinated'});
  try {
    const saved = storage.getItem(CONFIG_KEY);
    if (saved) return validateConfig(JSON.parse(saved));
  } catch { /* Corrupt storage must not prevent loading the page. */ }
  const defaults = {...addressesFor(PRESETS.hotspot), manualMode: 'standalone'};
  try {
    const previous = storage.getItem('nail.navigation.serviceUrl.v1');
    if (previous !== null) defaults.navigationUrl = normalizeUrl(previous, {optional:true});
  } catch { /* Use the defaults if an old address is invalid. */ }
  return validateConfig(defaults);
}
export function saveConfig(value, storage = localStorage) {
  const config = validateConfig(value);
  storage.setItem(CONFIG_KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent('nail:connection-change', {detail: config}));
  return config;
}

export function operatorConnection(current,recommended) {
  if(current.followOperator!==true)return current;
  const next=validateConfig({...recommended,manualMode:current.manualMode,followOperator:true});
  return next;
}
export async function readOperatorConnection(fetcher=fetch) {
  if(isSimulationPage())return null;
  try{
    const response=await fetcher('/api/operator/connection',{cache:'no-store',signal:AbortSignal.timeout(1800)});
    if(!response.ok)return null;
    const value=await response.json();
    if(value?.schema_version!==1)return null;
    return validateConfig({...value,followOperator:true});
  }catch{return null;}
}
