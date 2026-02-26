(function () {
  // Skip the admin page entirely
  if (window.location.pathname.replace(/\/$/, '').endsWith('admin') ||
      window.location.pathname.includes('admin.html')) return;

  // ── Immediately block content to prevent flash ─────────
  var overlay = document.createElement('div');
  overlay.id = 'sl-overlay';
  overlay.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
    'background:#0d0d0f', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'justify-content:center',
  ].join(';');
  // Append to documentElement so it works even before <body> exists
  (document.body || document.documentElement).appendChild(overlay);

  // ── Check lock status ──────────────────────────────────
  fetch('/api/settings', { credentials: 'include' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.sitelock_enabled) {
        overlay.remove();
        return;
      }

      // Check if current user is admin (soft client-side check)
      var isAdmin = false;
      try {
        var stored = localStorage.getItem('ia_user');
        if (stored) isAdmin = !!JSON.parse(stored).is_admin;
      } catch (_) {}

      if (isAdmin) {
        overlay.remove();
        showAdminBanner(data.sitelock_message);
      } else {
        showSplash(overlay, data.sitelock_message);
      }
    })
    .catch(function () {
      // Fail open — don't lock visitors out if API is down
      overlay.remove();
    });

  // ── Splash screen for non-admin visitors ──────────────
  function showSplash(el, message) {
    el.innerHTML = [
      '<div style="',
        'max-width:480px;width:90%;',
        'background:#1a1a1f;',
        'border:1px solid rgba(212,168,67,0.25);',
        'border-radius:16px;',
        'padding:2.5rem 2rem;',
        'text-align:center;',
        'box-shadow:0 8px 48px rgba(0,0,0,0.6);',
      '">',
        '<div style="font-size:2.5rem;margin-bottom:1rem;">🔒</div>',
        '<div style="',
          'font-family:\'Playfair Display\',Georgia,serif;',
          'font-size:1.6rem;font-weight:700;',
          'color:#f0ede6;margin-bottom:1rem;',
        '">FundsEdge</div>',
        '<p style="',
          'color:rgba(240,237,230,0.75);',
          'font-family:Inter,sans-serif;',
          'font-size:1rem;line-height:1.6;',
          'margin:0;',
        '">',
          escapeHtml(message || 'This site is temporarily unavailable. Please check back soon.'),
        '</p>',
      '</div>',
    ].join('');
  }

  // ── Admin warning banner ───────────────────────────────
  function showAdminBanner(message) {
    var banner = document.createElement('div');
    banner.id = 'sl-admin-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'z-index:2147483646',
      'background:#8b1a1a',
      'color:#fff',
      'font-family:Inter,sans-serif',
      'font-size:0.85rem',
      'padding:0.5rem 1rem',
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'gap:1rem',
    ].join(';');
    banner.innerHTML = [
      '<span>⚠ <strong>ADMIN:</strong> Site is currently locked to visitors',
        ' — message: &ldquo;' + escapeHtml(message) + '&rdquo;</span>',
      '<button onclick="this.parentElement.remove()" style="',
        'background:none;border:1px solid rgba(255,255,255,0.4);',
        'color:#fff;padding:0.2rem 0.6rem;border-radius:4px;',
        'cursor:pointer;font-size:0.8rem;white-space:nowrap;',
        '">Dismiss</button>',
    ].join('');
    document.body.prepend(banner);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
