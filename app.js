/* ============================================================
   钉探 – 智能小车控制台  |  app.js
   ============================================================ */

(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function now() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  }

  /* ── status ──────────────────────────────────────────────── */
  const STATUS_MAP = {
    running:      { dot: 'status-dot--green',  text: '正常运行' },
    disconnected: { dot: 'status-dot--yellow', text: '未连接'   },
    error:        { dot: 'status-dot--red',    text: '报错'     },
  };

  function setStatus(key) {
    const s = STATUS_MAP[key];
    if (!s) return;
    const dot  = $('#statusDot');
    const text = $('#statusText');
    dot.className  = 'status-dot ' + s.dot;
    text.textContent = s.text;
  }

  $('#statusSelect').addEventListener('change', (e) => {
    setStatus(e.target.value);
    addMessage('system', `小车状态已切换为：${STATUS_MAP[e.target.value].text}`);
  });

  /* ── command select & dynamic params ─────────────────────── */
  const CMD_LABELS = {
    forward:    '向前',
    backward:   '向后',
    left:       '向左',
    right:      '向右',
    wait:       '等待',
    pickup:     '拾取',
    resolution: '清晰度调整',
  };

  function renderParams(cmd) {
    const box = $('#formParams');
    if (cmd === 'resolution') {
      box.innerHTML = `
        <div class="params-row">
          <div>
            <label for="paramW">宽 (px)</label>
            <input id="paramW" type="number" value="1920" min="1" />
          </div>
          <div>
            <label for="paramH">高 (px)</label>
            <input id="paramH" type="number" value="1080" min="1" />
          </div>
          <div>
            <label for="paramFPS">帧率 (fps)</label>
            <input id="paramFPS" type="number" value="30" min="1" max="120" />
          </div>
        </div>`;
    } else {
      box.innerHTML = '';
    }
  }

  $('#cmdSelect').addEventListener('change', (e) => renderParams(e.target.value));
  renderParams('forward'); // init

  /* ── send command ────────────────────────────────────────── */
  function buildCmdText(cmd) {
    let text = `发送命令：${CMD_LABELS[cmd]}`;
    if (cmd === 'resolution') {
      const w   = $('#paramW')?.value  || '?';
      const h   = $('#paramH')?.value  || '?';
      const fps = $('#paramFPS')?.value || '?';
      text += `  [${w}×${h} @ ${fps}fps]`;
    }
    return text;
  }

  function sendCommand(cmd) {
    const text = buildCmdText(cmd);
    addMessage('cmd', text);
    // Simulate reply after short delay
    setTimeout(() => {
      addMessage('event', `小车反馈：已执行"${CMD_LABELS[cmd]}"`);
    }, 600);
  }

  $('#btnSendCmd').addEventListener('click', () => {
    sendCommand($('#cmdSelect').value);
  });

  /* ── D-pad ───────────────────────────────────────────────── */
  $$('.dpad-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (!cmd) return;
      $('#cmdSelect').value = cmd;
      renderParams(cmd);
      // Commands with params: just select, let user configure then send
      if (cmd === 'resolution') return;
      sendCommand(cmd);
    });
  });

  /* ── messages ────────────────────────────────────────────── */
  function addMessage(type, text) {
    const list = $('#messagesList');
    const tagMap = {
      system: { cls: 'msg-system',   tag: 'tag-system', label: '系统' },
      cmd:    { cls: 'msg-sent',     tag: 'tag-cmd',    label: '命令' },
      event:  { cls: 'msg-received', tag: 'tag-event',  label: '事件' },
    };
    const t = tagMap[type] || tagMap.system;
    const div = document.createElement('div');
    div.className = `message ${t.cls}`;
    div.innerHTML = `
      <span class="msg-time">${now()}</span>
      <span class="msg-tag ${t.tag}">${t.label}</span>
      <span class="msg-text">${text}</span>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  /* ── simulate event ──────────────────────────────────────── */
  const EVENTS = [
    { icon: '🔩', text: '识别到钉子',       cls: 'event-nail',   msgTag: 'event' },
    { icon: '✅', text: '已拾取钉子',       cls: 'event-picked', msgTag: 'event' },
    { icon: '🟢', text: '暂无障碍，可通行', cls: 'event-clear',  msgTag: 'event' },
  ];

  $('#btnSimEvent').addEventListener('click', () => {
    const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    // Add to events list
    const li = document.createElement('li');
    li.className = `event-item ${ev.cls}`;
    li.innerHTML = `
      <span class="event-icon">${ev.icon}</span>
      <span class="event-text">${ev.text}</span>
      <span class="event-time">${now()}</span>`;
    const list = $('#eventsList');
    list.insertBefore(li, list.firstChild);
    // Add to messages
    addMessage('event', `小车上报：${ev.text}`);
  });

  /* ── camera canvas – simulated road + scanning line ──────── */
  (function drawCamera() {
    const canvas = $('#cameraCanvas');
    const ctx    = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    let scanY = 0;

    // Random "nails" on the road
    const nails = Array.from({ length: 4 }, () => ({
      x: 60 + Math.random() * (W - 120),
      y: 80 + Math.random() * (H - 120),
      r: 4 + Math.random() * 4,
    }));

    function frame() {
      // Road background
      ctx.fillStyle = '#1a1f27';
      ctx.fillRect(0, 0, W, H);

      // Lane lines
      ctx.strokeStyle = '#3a3f4a';
      ctx.lineWidth = 2;
      ctx.setLineDash([18, 14]);
      ctx.beginPath();
      ctx.moveTo(W * 0.33, 0); ctx.lineTo(W * 0.28, H);
      ctx.moveTo(W * 0.66, 0); ctx.lineTo(W * 0.72, H);
      ctx.stroke();
      ctx.setLineDash([]);

      // Road edges
      ctx.strokeStyle = '#4a4f5a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W * 0.1, 0); ctx.lineTo(W * 0.05, H);
      ctx.moveTo(W * 0.9, 0); ctx.lineTo(W * 0.95, H);
      ctx.stroke();

      // Nails
      nails.forEach((n) => {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = '#f8514988';
        ctx.fill();
        ctx.strokeStyle = '#f85149';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Small cross
        ctx.beginPath();
        ctx.moveTo(n.x - n.r, n.y); ctx.lineTo(n.x + n.r, n.y);
        ctx.moveTo(n.x, n.y - n.r); ctx.lineTo(n.x, n.y + n.r);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Scan line
      scanY = (scanY + 1.5) % H;
      const grad = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 10);
      grad.addColorStop(0, 'rgba(79,140,255,0)');
      grad.addColorStop(0.5, 'rgba(79,140,255,0.55)');
      grad.addColorStop(1, 'rgba(79,140,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 10, W, 20);

      // HUD corners
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 2;
      const cs = 16;
      // top-left
      ctx.beginPath(); ctx.moveTo(4, 4 + cs); ctx.lineTo(4, 4); ctx.lineTo(4 + cs, 4); ctx.stroke();
      // top-right
      ctx.beginPath(); ctx.moveTo(W - 4 - cs, 4); ctx.lineTo(W - 4, 4); ctx.lineTo(W - 4, 4 + cs); ctx.stroke();
      // bottom-left
      ctx.beginPath(); ctx.moveTo(4, H - 4 - cs); ctx.lineTo(4, H - 4); ctx.lineTo(4 + cs, H - 4); ctx.stroke();
      // bottom-right
      ctx.beginPath(); ctx.moveTo(W - 4 - cs, H - 4); ctx.lineTo(W - 4, H - 4); ctx.lineTo(W - 4, H - 4 - cs); ctx.stroke();

      // Center crosshair
      ctx.strokeStyle = 'rgba(79,140,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 14, H / 2); ctx.lineTo(W / 2 + 14, H / 2);
      ctx.moveTo(W / 2, H / 2 - 14); ctx.lineTo(W / 2, H / 2 + 14);
      ctx.stroke();

      requestAnimationFrame(frame);
    }
    frame();
  })();

  /* ── camera clock ────────────────────────────────────────── */
  (function tickClock() {
    const el = $('#cameraTime');
    setInterval(() => { el.textContent = now(); }, 1000);
    el.textContent = now();
  })();

})();
