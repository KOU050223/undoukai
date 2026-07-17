// ==UserScript==
// @name         myTyping Auto Typer (学習用)
// @namespace    https://github.com/KOU050223/undoukai
// @version      0.1.0
// @description  myTyping (typing.twi1.me) を高速で自動タイピングする学習用ツール。合成KeyboardEventを document に dispatch してゲームハンドラを直接叩く。
// @match        https://typing.twi1.me/game/*
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

/*
 * 仕組み:
 *   ゲーム本体 (typing.min.js) は document に addEventListener("keydown", W) を
 *   登録している。W は e.keyCode / e.key を見ており isTrusted 判定は無い。
 *   よって new KeyboardEvent("keydown", { keyCode, key, ... }) を document に
 *   dispatch すれば人間のキー押下と同じルートで受理される。
 *
 * 使い方:
 *   1. ページを開く (設定モーダルが出た状態)
 *   2. 画面右下の [START] を押す
 *   3. 設定モーダルは Enter で閉じられる → ゲーム開始
 *   4. 出題されたローマ字候補を上から順に高速dispatch
 *   5. [STOP] で停止
 */

(function () {
  'use strict';

  // Tampermonkey の sandbox から抜けてページと同じ document / KeyboardEvent を使う
  const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const DOC = W.document;
  const KE = W.KeyboardEvent;

  // ---- 設定 ------------------------------------------------------------
  const DEFAULT_INTERVAL_MS = 0;   // tick間隔(ms)。0=最速
  const MAX_KEYS_PER_TICK = 200;   // 1tickで一気に叩く上限（暴走防止）
  const AUTOSTART = false;         // true にするとページを開いた瞬間から回す

  // ---- keyCode テーブル (最低限) ---------------------------------------
  // ローマ字入力で使う ASCII 英小文字と記号
  const codeMap = {
    ' ': { code: 'Space', keyCode: 32 },
    '-': { code: 'Minus', keyCode: 189 },
    ',': { code: 'Comma', keyCode: 188 },
    '.': { code: 'Period', keyCode: 190 },
    '/': { code: 'Slash', keyCode: 191 },
    ';': { code: 'Semicolon', keyCode: 186 },
    ':': { code: 'Quote', keyCode: 186 }, // 日本語配列: 実質同じキー扱いで来る
    '@': { code: 'BracketLeft', keyCode: 192 },
    '[': { code: 'BracketRight', keyCode: 219 },
    ']': { code: 'Backslash', keyCode: 221 },
  };
  const shiftedDigit = { '!':'1','"':'2','#':'3','$':'4','%':'5','&':'6',"'":'7','(':'8',')':'9' };

  function toEventInit(ch) {
    let key = ch;
    let code, keyCode;
    let shift = false;

    if (/^[a-z]$/.test(ch)) {
      key = ch;
      code = 'Key' + ch.toUpperCase();
      keyCode = ch.toUpperCase().charCodeAt(0);
    } else if (/^[A-Z]$/.test(ch)) {
      key = ch;
      code = 'Key' + ch;
      keyCode = ch.charCodeAt(0);
      shift = true;
    } else if (/^[0-9]$/.test(ch)) {
      code = 'Digit' + ch;
      keyCode = ch.charCodeAt(0);
    } else if (shiftedDigit[ch]) {
      const d = shiftedDigit[ch];
      key = ch;
      code = 'Digit' + d;
      keyCode = d.charCodeAt(0);
      shift = true;
    } else if (codeMap[ch]) {
      code = codeMap[ch].code;
      keyCode = codeMap[ch].keyCode;
    } else {
      // fallback: そのまま送る (which に charCode)
      code = 'Unidentified';
      keyCode = ch.charCodeAt(0);
    }

    return {
      key, code, keyCode,
      which: keyCode,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
  }

  function dispatchKey(ch) {
    const init = toEventInit(ch);
    DOC.dispatchEvent(new KE('keydown', init));
    DOC.dispatchEvent(new KE('keypress', { ...init, charCode: ch.charCodeAt(0) }));
    DOC.dispatchEvent(new KE('keyup', init));
  }

  function dispatchSpecial(name) {
    const map = {
      Enter:     { key: 'Enter',     code: 'Enter',     keyCode: 13 },
      Space:     { key: ' ',         code: 'Space',     keyCode: 32 },
      Escape:    { key: 'Escape',    code: 'Escape',    keyCode: 27 },
      Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8  },
    };
    const init = { ...map[name], which: map[name].keyCode, bubbles: true, cancelable: true, composed: true };
    DOC.dispatchEvent(new KE('keydown', init));
    DOC.dispatchEvent(new KE('keyup',   init));
  }

  // ---- お題テキストの取得 ---------------------------------------------
  // ゲーム中は .mtjMainSc 内の .mtjMainSc-roma 等に入力予定のローマ字が
  // 出ている。まだ確定できていないので、実行時に window.__typingCheatProbe()
  // を呼ぶと現在の DOM を JSON で返す。まずはそれを使って合わせ込む。
  function probe() {
    const out = {};
    const sels = [
      '.mtjMainSc', '.mtjMainSc-roma', '.mtjMainSc-romaNext', '.mtjMainSc-roma-old',
      '.mtjMainSc-kana', '.mtjMainSc-questionOriginal',
      '.mtjRoma', '.mtjKana', '.mtjRomaOld', '.mtjRomaNext',
    ];
    for (const s of sels) {
      const els = [...DOC.querySelectorAll(s)];
      if (els.length) out[s] = els.map(e => ({
        cls: e.className, text: e.innerText, html: e.innerHTML.slice(0, 200),
      }));
    }
    return out;
  }
  window.__typingCheatProbe = probe;

  // 現在打つべき次の1文字を返す。
  // ゲーム画面のローマ字は
  //   <div class="mtjGmSc-roma">
  //     <span class="mtjInputted">既入力</span>
  //     <span class="mtjNowInput">次の1文字</span>
  //     <span class="mtjRemain">残り</span>
  //   </div>
  function readNextChar() {
    const now = DOC.querySelector('.mtjGmSc-roma .mtjNowInput');
    return now ? now.innerText : '';
  }

  // 未打鍵ローマ字全体（NowInput + Remain）
  function readPending() {
    const roma = DOC.querySelector('.mtjGmSc-roma');
    if (!roma) return '';
    const now = roma.querySelector('.mtjNowInput');
    const rem = roma.querySelector('.mtjRemain');
    return (now ? now.innerText : '') + (rem ? rem.innerText : '');
  }

  // ---- 実行ループ ------------------------------------------------------
  let timer = null;
  let intervalMs = DEFAULT_INTERVAL_MS;
  let stallCount = 0;

  function readyPromptVisible() {
    // "スペースを押すとスタート" 画面かどうか
    const el = DOC.querySelector('.mtjGmSc-readyArea');
    return el && getComputedStyle(el).display !== 'none';
  }
  function settingModalVisible() {
    const el = DOC.querySelector('.mtjSeSc-box');
    return el && getComputedStyle(el).display !== 'none';
  }
  function resultModalVisible() {
    const el = DOC.querySelector('.mtjRsSc-box, .mtjRsSc');
    return el && getComputedStyle(el).display !== 'none';
  }

  function tick() {
    // 設定モーダル → Enter で決定
    if (settingModalVisible()) {
      dispatchSpecial('Enter');
      return;
    }
    // 「スペースを押すとスタート」→ Space
    if (readyPromptVisible()) {
      dispatchSpecial('Space');
      return;
    }
    // 結果画面が出たら止める
    if (resultModalVisible()) {
      stop();
      log('完了: 結果画面');
      return;
    }

    // 現在の問題の未打鍵ローマ字を丸ごと取得して一気に叩く
    const pending = readPending();
    if (!pending) {
      stallCount++;
      if (stallCount > 60) { stop(); log('停止: 次の文字を検出できません'); }
      return;
    }
    const n = Math.min(pending.length, MAX_KEYS_PER_TICK);
    for (let i = 0; i < n; i++) dispatchKey(pending[i]);

    const after = readNextChar();
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
    console.log('[myTyping cheat]', msg);
  }

  // ---- コントロールUI --------------------------------------------------
  const ui = {};
  function mountUI() {
    const box = document.createElement('div');
    box.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      background: rgba(20,20,20,.92); color: #eee; font: 12px/1.4 system-ui, sans-serif;
      padding: 10px 12px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,.4);
      min-width: 180px;
    `;
    const mk = (tag, style, text) => {
      const el = document.createElement(tag);
      if (style) el.style.cssText = style;
      if (text != null) el.textContent = text;
      return el;
    };

    box.appendChild(mk('div', 'font-weight:700; margin-bottom:6px;', 'myTyping Auto'));

    const btnRow = mk('div', 'display:flex; gap:6px; margin-bottom:6px;');
    const startBtn = mk('button', 'flex:1', 'START');
    const stopBtn  = mk('button', 'flex:1', 'STOP');
    btnRow.append(startBtn, stopBtn);
    box.appendChild(btnRow);

    const label = mk('label', 'display:flex; align-items:center; gap:4px;');
    label.append(document.createTextNode('間隔 '));
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '500';
    input.value = String(DEFAULT_INTERVAL_MS); // 0 = 最速
    input.style.width = '60px';
    label.append(input, document.createTextNode(' ms'));
    box.appendChild(label);

    const status = mk('div', 'margin-top:4px;', '○ STOP');
    const logEl  = mk('div', 'margin-top:2px; opacity:.7; font-size:11px;', '');
    box.append(status, logEl);

    DOC.body.appendChild(box);
    ui.box = box;
    ui.status = status;
    ui.log = logEl;
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
    log('準備OK。まず設定モーダルで OK 相当 (Enter) を送ってからタイプを始めます。');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
