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
  (document.body || document.documentElement).appendChild(overlay);

  // ── Check lock status ──────────────────────────────────
  fetch('/api/settings', { credentials: 'include' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.sitelock_enabled || data.unlocked) {
        overlay.remove();
        return;
      }

      // Check if current user is admin
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
      overlay.remove(); // fail open
    });

  // ── Splash screen with password input ─────────────────
  function showSplash(el, message) {
    el.innerHTML = [
      '<div style="',
        'max-width:440px;width:90%;',
        'background:#1a1a1f;',
        'border:1px solid rgba(212,168,67,0.25);',
        'border-radius:16px;',
        'padding:2.5rem 2rem;',
        'text-align:center;',
        'box-shadow:0 8px 48px rgba(0,0,0,0.6);',
      '">',
        '<div style="font-size:2.5rem;margin-bottom:0.75rem;">🔒</div>',
        '<div style="',
          'font-family:\'Playfair Display\',Georgia,serif;',
          'font-size:1.6rem;font-weight:700;color:#f0ede6;margin-bottom:0.75rem;',
        '">FundsEdge</div>',
        '<p style="',
          'color:rgba(240,237,230,0.7);font-family:Inter,sans-serif;',
          'font-size:0.95rem;line-height:1.6;margin:0 0 1.5rem;',
        '">',
          escapeHtml(message || 'This site is temporarily unavailable. Please check back soon.'),
        '</p>',
        '<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">',
          '<input id="sl-pw-input" type="password" placeholder="Enter access password"',
            ' onkeydown="if(event.key===\'Enter\')document.getElementById(\'sl-pw-btn\').click()"',
            ' style="',
              'flex:1;padding:0.65rem 0.85rem;',
              'background:#0d0d0f;border:1px solid rgba(212,168,67,0.3);',
              'border-radius:8px;color:#f0ede6;font-family:Inter,sans-serif;',
              'font-size:0.9rem;outline:none;',
            '">',
          '<button id="sl-pw-btn" onclick="slUnlock()"',
            ' style="',
              'padding:0.65rem 1.1rem;',
              'background:linear-gradient(135deg,#a87d28,#c9a84c);',
              'color:#0c0c0e;border:none;border-radius:8px;',
              'font-weight:700;font-size:0.9rem;cursor:pointer;white-space:nowrap;',
            '">Unlock</button>',
        '</div>',
        '<div id="sl-pw-error" style="',
          'color:#e07070;font-family:Inter,sans-serif;',
          'font-size:0.85rem;min-height:1.2em;',
        '"></div>',
      '</div>',
    ].join('');
  }

  // ── Unlock handler (global so inline onclick can reach it) ─
  window.slUnlock = function () {
    var input = document.getElementById('sl-pw-input');
    var errEl = document.getElementById('sl-pw-error');
    var btn   = document.getElementById('sl-pw-btn');
    if (!input || !input.value.trim()) return;

    btn.disabled = true;
    btn.textContent = '…';
    errEl.textContent = '';

    fetch('/api/settings/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password: input.value }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          window.location.reload();
        } else {
          errEl.textContent = data.error || 'Incorrect password.';
          btn.disabled = false;
          btn.textContent = 'Unlock';
        }
      })
      .catch(function () {
        errEl.textContent = 'Connection error. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Unlock';
      });
  };

  // ── Admin warning banner ───────────────────────────────
  function showAdminBanner(message) {
    var banner = document.createElement('div');
    banner.id = 'sl-admin-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'z-index:2147483646',
      'background:#8b1a1a', 'color:#fff',
      'font-family:Inter,sans-serif', 'font-size:0.85rem',
      'padding:0.5rem 1rem',
      'display:flex', 'align-items:center', 'justify-content:space-between', 'gap:1rem',
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
