/** Shared addresses; saving settings never starts hardware or sends commands. */
export const CONFIG_KEY = 'nail.connection.v1';
export const PRESETS = { hotspot: 'http://192.168.0.100', usb: 'http://192.168.55.1' };
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
    eventsUrl: port(5001), navigationUrl: port(8091)};
}
export function validateConfig(value) {
  const config = {schema_version: 1};
  for (const key of ['robotUrl','videoUrl','controlUrl','eventsUrl','navigationUrl'])
    config[key] = normalizeUrl(value[key], {optional: key === 'navigationUrl'});
  config.manualMode = value.manualMode === 'coordinated' ? 'coordinated' : 'standalone';
  return config;
}
export function loadConfig(storage = localStorage) {
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
