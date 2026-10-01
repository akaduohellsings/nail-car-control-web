/** Navigation service contract. No transport is implemented in this shell. */
export class NavigationNotConnectedError extends Error {
  constructor() { super('导航接口尚未接入，未向小车发送命令'); this.name = 'NavigationNotConnectedError'; }
}

export function createNavigationApi({ baseUrl = '' } = {}) {
  // Later: replace this adapter after the HTTP bridge and control ownership are validated.
  const unavailable = async () => { throw new NavigationNotConnectedError(); };
  return Object.freeze({
    baseUrl,
    implemented: false,
    connect: unavailable,
    getStatus: unavailable,
    getMap: unavailable,
    start: unavailable,          // {request_id, map_id, goal: {x, y, yaw_deg}}
    pause: unavailable,          // {request_id}
    resume: unavailable,         // {request_id}
    reset: unavailable,          // {request_id}
    requestManual: unavailable,  // {request_id, control_epoch}
    releaseManual: unavailable, // {request_id, control_epoch}
    stop: unavailable,          // Cancel manual intent and pause mission; await confirmation.
    subscribeStatus() { return () => {}; }, // Future server-authoritative state subscription.
    disconnect() {},
  });
}
