import {loadConfig} from './connection-config.js';
import {installSettings} from './connection-settings.js';

/* ============================================================
   钉探 – 智能小车控制台  |  app.js
   ============================================================ */

(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  let config = loadConfig();
  const setVideoAddress = () => {$('#cameraImage').src = config.videoUrl + '/stream?topic=/detected_image';};
  installSettings($('#settingsButton'), value => {
    if (moving) {sendCommand('stop'); moving=false;}
    config=value; setVideoAddress();
    addMessage('system', '连接设置已保存，手动页与导航页共用。');
  });
  setVideoAddress();

  function now() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  }

  /* ── status ──────────────────────────────────────────────── */
  const STATUS_MAP = {
    running:      { dot: 'status-dot--green',  text: '正常运行' },
    disconnected: { dot: 'status-dot--yellow', text: '正常运行'   },
    error:        { dot: 'status-dot--red',    text: '报错'     },
  };

  window.setCarStatus = function(key) {
    const s = STATUS_MAP[key];
    if (!s) return;
    const dot  = $('#statusDot');
    const text = $('#statusText');
    dot.className  = 'status-dot ' + s.dot;
    text.textContent = s.text;
  };

  window.setCarStatus('disconnected');

  /* ── command labels ──────────────────────────────────────── */
  const CMD_LABELS = {
    forward: '前进',
    backward: '后退',
    left: '左转',
    right: '右转',
    left_forward: '左前',
    right_forward: '右前',
    left_backward: '左后',
    right_backward: '右后',
    stop: '停止'
  };

  /* ── send command ────────────────────────────────────────── */
  function sendCommand(cmd) {
    fetch(`${config.controlUrl}/cmd?move=${encodeURIComponent(cmd)}`)
      .then(response => {
        if (response.ok) {
          addMessage('cmd', `发送命令：${CMD_LABELS[cmd] || cmd}`);
        }
      })
      .catch(error => {
        console.error(error);
        addMessage('system', `命令发送失败：${error.message}`);
      });
  }

  /* ── D-pad ────────────────────────────────────────────────── */
  let moving = false;

  $$('.dpad-btn').forEach((btn) => {
    const cmd = btn.dataset.cmd;
    if (!cmd) return;

    const trigger = () => {
      moving = true;
      sendCommand(cmd);
    };

    btn.addEventListener('mousedown', trigger);
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      trigger();
    });
  });

  document.addEventListener('mouseup', () => {
    if (moving) {
      sendCommand('stop');
      moving = false;
    }
  });

  document.addEventListener('touchend', () => {
    if (moving) {
      sendCommand('stop');
      moving = false;
    }
  });

  /* ── messages ────────────────────────────────────────────── */
  window.addMessage = function(type, text) {
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
    while(list.children.length > 100){
    list.removeChild(list.firstChild);
}
  };

  window.addEvent = function(icon, text, type) {
    const list = $('#eventsList');
    const li = document.createElement('li');
    const clsMap = {
      nail: 'event-nail',
      picked: 'event-picked',
      clear: 'event-clear'
    };
    li.className = `event-item ${clsMap[type] || 'event-nail'}`;
    li.innerHTML = `
      <span class="event-icon">${icon}</span>
      <span class="event-text">${text}</span>
      <span class="event-time">${now()}</span>`;
    
        // 新消息添加到底部
        list.appendChild(li);


        // 自动滚动到底部
        list.scrollTop = list.scrollHeight;

    // 限制事件列表数量，防止溢出
    while (list.children.length > 50) {
      list.removeChild(list.lastChild);
    }

    window.addMessage('event', `小车上报：${text}`);
  };

  /* ── camera clock ────────────────────────────────────────── */
  (function tickClock() {
    const el = $('#cameraTime');
    setInterval(() => { el.textContent = now(); }, 1000);
    el.textContent = now();
  })();

  window.addMessage('system', '钉探系统已就绪，等待小车连接...');

  /* ── YOLO钉子识别事件 ───────────────────────── */

  let lastCount = 0;
  let lastDetected = false;

  setInterval(()=>{

    fetch(config.eventsUrl + '/events')

    .then(response => response.json())
    .then(data => {
        /*
          只在状态变化时添加事件
          防止YOLO连续30fps刷屏
        */
        if(
          data.detected &&
          (
            !lastDetected ||
            data.count !== lastCount
          )
        ){

            addEvent(
                "🔩",
                data.message,
                "nail"
            );

        }
        lastDetected = data.detected;
        lastCount = data.count;
    })

    .catch(error=>{

        console.log(
          "YOLO事件连接失败:",
          error
        );

    });

  },1000);
  
})();