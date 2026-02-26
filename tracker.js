(function () {
  // ── Session ID (persists across pages, resets when localStorage clears) ──
  var SESSION_KEY = 'fe_sid';
  var sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SESSION_KEY, sid);
  }

  var page = window.location.pathname || '/';
  var referrer = document.referrer || '';

  // ── Page view ─────────────────────────────────────────────
  fetch('/api/track/pageview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sid, page: page, referrer: referrer }),
    credentials: 'include',
    keepalive: true,
  }).catch(function () {});

  // ── Click tracking ────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button, a, [data-track]');
    if (!el) return;

    var label = (
      el.getAttribute('data-track') ||
      el.getAttribute('aria-label') ||
      el.textContent.trim().slice(0, 60) ||
      el.getAttribute('href') ||
      'unknown'
    ).replace(/\s+/g, ' ').trim();

    var tag = el.tagName.toLowerCase();

    fetch('/api/track/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid, page: page, element: tag + ':' + label }),
      credentials: 'include',
      keepalive: true,
    }).catch(function () {});
  }, { passive: true });
})();
