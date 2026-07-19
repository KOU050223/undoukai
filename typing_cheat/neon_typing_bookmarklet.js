(() => {
  'use strict';

  if (location.hostname !== 'otonasi-muonn.github.io' || !location.pathname.startsWith('/typing_game')) {
    alert('先にネオンタイピングを開いてから、このブックマークをクリックしてください。');
    return;
  }

  if (window.__neonTypingBookmarkletTimer) {
    clearInterval(window.__neonTypingBookmarkletTimer);
  }

  const startedAt = Date.now();

  function active(id) {
    return document.getElementById(id)?.classList.contains('active');
  }

  function stop(message) {
    clearInterval(window.__neonTypingBookmarkletTimer);
    delete window.__neonTypingBookmarkletTimer;
    if (message) alert(message);
  }

  function dispatchChar(char) {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: char,
      code: /^[a-z]$/i.test(char) ? `Key${char.toUpperCase()}` : 'Unidentified',
      bubbles: true,
      cancelable: true,
    }));
  }

  function tick() {
    if (active('screen-completed')) {
      stop();
      return;
    }

    if (active('screen-idle')) {
      document.getElementById('btn-start')?.click();
      return;
    }

    if (active('screen-playing')) {
      const current = document.getElementById('romaji-current')?.textContent || '';
      const remaining = document.getElementById('romaji-remaining')?.textContent || '';
      for (const char of current + remaining) dispatchChar(char);
    }

    if (Date.now() - startedAt > 30000) {
      stop('30秒以内に開始できませんでした。ページを再読み込みして試してください。');
    }
  }

  window.__neonTypingBookmarkletTimer = setInterval(tick, 0);
})();
