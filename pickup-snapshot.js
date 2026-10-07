/** Read-only snapshot acquisition. Every retry must pass the server's stop checks. */
const retryable = new Set(['STATIONARY_SNAPSHOT_REQUIRED', 'CAMERA_INFO_NOT_READY',
  'MATCHED_CAMERA_DETECTION_NOT_READY', 'SERVICE_STARTING']);

export async function getStationaryObservation(url, {
  fetcher = fetch, clock = () => performance.now(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry = () => {}
} = {}) {
  const deadline = clock() + 8000;
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - clock();
    if (remaining <= 0) throw Error('SNAPSHOT_TIMEOUT');
    const response = await fetcher(url + '/api/v1/pickup/observation', {
      method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(Math.ceil(Math.min(4000, remaining)))
    });
    const data = await response.json();
    if (clock() >= deadline) throw Error('SNAPSHOT_TIMEOUT');
    if (response.ok) return data;
    const code = data.error || 'SNAPSHOT_REQUEST_FAILED';
    if (!retryable.has(code) || deadline - clock() <= 250) throw Error(code);
    onRetry(attempt + 1, code);
    await wait(250);
  }
}
