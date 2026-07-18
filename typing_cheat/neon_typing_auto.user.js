// ==UserScript==
// @name         Neon Typing Auto (学習用)
// @namespace    https://github.com/KOU050223/undoukai
// @version      0.1.0
// @description  otonasi-muonn.github.io/typing_game (ネオンタイピング) を自動で完走させる学習用ツール。window keydown を高速dispatch。
// @match        https://otonasi-muonn.github.io/typing_game/*
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

/*
 * 仕組み:
 *   game.js は window.addEventListener("keydown", ...) を登録し、
 *   - e.isComposing / 修飾キーは無視
 *   - e.key.length === 1 の1文字だけを判定に使う
 *   - gameState === "PLAYING" のときだけ受理
 *   isTrusted 判定は無い。
 *   打つべき次の1文字は #romaji-current の textContent。
 *   ゲーム開始は #btn-start、完了検出は #screen-completed の可視化。
 */

(function () {
  'use strict';

  const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const DOC = W.document;
  const KE = W.KeyboardEvent;

  const DEFAULT_INTERVAL_MS = 0;
  const MAX_KEYS_PER_TICK = 200;
  const AUTOSTART = false;

  function dispatchChar(ch) {
    const init = {
      key: ch,
      // 判定は e.key しか見ないが、他のリスナーの互換のため付与
      code: /^[a-zA-Z]$/.test(ch) ? 'Key' + ch.toUpperCase() :
            /^[0-9]$/.test(ch) ? 'Digit' + ch : 'Unidentified',
      keyCode: ch.toUpperCase().charCodeAt(0),
      which: ch.toUpperCase().charCodeAt(0),
      bubbles: true, cancelable: true, composed: true,
    };
    W.dispatchEvent(new KE('keydown', init));
    W.dispatchEvent(new KE('keyup', init));
  }

  function readCurrent() {
    const el = DOC.getElementById('romaji-current');
    return el ? el.textContent : '';
  }
  function readPending() {
    const cur = DOC.getElementById('romaji-current');
    const rem = DOC.getElementById('romaji-remaining');
    return (cur ? cur.textContent : '') + (rem ? rem.textContent : '');
  }
  function playing() {
    const el = DOC.getElementById('screen-playing');
    return el && el.classList.contains('active');
  }
  function completed() {
    const el = DOC.getElementById('screen-completed');
    return el && el.classList.contains('active');
  }
  function idle() {
    const el = DOC.getElementById('screen-idle');
    return el && el.classList.contains('active');
  }

  let timer = null;
  let intervalMs = DEFAULT_INTERVAL_MS;
  let stallCount = 0;

  function tick() {
    if (idle()) {
      // ゲーム開始ボタンをクリック
      const btn = DOC.getElementById('btn-start');
      if (btn) btn.click();
      return;
    }
    if (completed()) {
      stop();
      log('完了: リザルト画面');
      return;
    }
    if (!playing()) {
      // 遷移中
      return;
    }

    const pending = readPending();
    if (!pending) {
      stallCount++;
      if (stallCount > 60) { stop(); log('停止: 次の文字を検出できません'); }
      return;
    }
    const n = Math.min(pending.length, MAX_KEYS_PER_TICK);
    for (let i = 0; i < n; i++) dispatchChar(pending[i]);

    const after = readCurrent();
    if (after === pending[0]) {
      stallCount++;
      if (stallCount === 1) log('打鍵反応なし (Tampermonkey権限モード確認)');
      if (stallCount > 20) { stop(); log('停止: 打鍵が反映されません'); }
    } else {
      stallCount = 0;
      log('打鍵 ' + n + '文字 → 次: ' + (after || '(問題完了)'));
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
    ui.status.textContent = '● RUN';
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    ui.status.textContent = '○ STOP';
  }
  function log(msg) {
    ui.log.textContent = msg;
    console.log('[neon typing cheat]', msg);
  }

  const ui = {};
  function mountUI() {
    const box = document.createElement('div');
    box.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      background: rgba(15,15,25,.92); color: #7ff; font: 12px/1.4 system-ui, sans-serif;
      padding: 10px 12px; border-radius: 8px;
      box-shadow: 0 0 24px rgba(0,255,255,.25), 0 4px 20px rgba(0,0,0,.5);
      border: 1px solid rgba(0,255,255,.3);
      min-width: 180px;
    `;
    const mk = (tag, style, text) => {
      const el = document.createElement(tag);
      if (style) el.style.cssText = style;
      if (text != null) el.textContent = text;
      return el;
    };

    box.appendChild(mk('div', 'font-weight:700; margin-bottom:6px; color:#0ff;', 'Neon Typing Auto'));

    const btnRow = mk('div', 'display:flex; gap:6px; margin-bottom:6px;');
    const startBtn = mk('button', 'flex:1', 'START');
    const stopBtn  = mk('button', 'flex:1', 'STOP');
    btnRow.append(startBtn, stopBtn);
    box.appendChild(btnRow);

    const label = mk('label', 'display:flex; align-items:center; gap:4px;');
    label.append(document.createTextNode('間隔 '));
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '500';
    input.value = String(DEFAULT_INTERVAL_MS);
    input.style.width = '60px';
    label.append(input, document.createTextNode(' ms'));
    box.appendChild(label);

    const status = mk('div', 'margin-top:4px;', '○ STOP');
    const logEl  = mk('div', 'margin-top:2px; opacity:.7; font-size:11px;', '');
    box.append(status, logEl);

    DOC.body.appendChild(box);
    ui.box = box; ui.status = status; ui.log = logEl;

    input.addEventListener('change', () => {
      intervalMs = Math.max(0, Number(input.value) || 0);
      if (timer) { stop(); start(); }
    });
    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
  }

  function init() {
    mountUI();
    if (AUTOSTART) start();
    log('準備OK。STARTでアイドル画面→自動でゲーム開始→10問完走。');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
