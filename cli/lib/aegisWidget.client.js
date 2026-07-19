// AegisRunner dev widget — a floating shield button injected into your dev app.
// Click it to scan the current page or the whole site, set login credentials,
// and watch progress, without leaving the app you're building. Rendered in a
// shadow root so it never collides with your app's styles. Served by the
// vite/nuxt/next plugins at /__aegis/widget.js (dev only).
(function () {
  // SSR-safe: this file is also bundled into Next's client entry, which can be
  // evaluated where there's no DOM. Bail unless we're really in a browser.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__aegisWidgetMounted) return;
  window.__aegisWidgetMounted = true;

  var API = '/__aegis';
  // Solid cyan shield + dark check — high contrast against the dark #0f172a button
  // (the old dark-on-dark fill made the icon nearly invisible). currentColor lets
  // the header reuse it at a different tint if needed.
  var SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22" aria-hidden="true">' +
    '<path d="M12 2.6l7 2.6v5.2c0 4.4-2.9 8.3-7 9.6-4.1-1.3-7-5.2-7-9.6V5.2l7-2.6z" fill="#22d3ee" stroke="#22d3ee" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M8.6 12.2l2.4 2.4 4.4-4.6" fill="none" stroke="#062a33" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var CSS =
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
    'svg{display:block}' +
    '.fab{position:fixed;right:20px;bottom:20px;width:46px;height:46px;border-radius:50%;background:#0f172a;' +
      'border:1px solid #334155;display:flex;align-items:center;justify-content:center;cursor:pointer;' +
      'z-index:2147483000;box-shadow:0 6px 22px rgba(2,6,23,.45);transition:transform .15s,border-color .15s}' +
    '.fab:hover{transform:translateY(-2px);border-color:#22d3ee}' +
    '.panel{position:fixed;right:20px;bottom:78px;width:300px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;' +
      'border-radius:14px;z-index:2147483000;overflow:hidden;box-shadow:0 16px 48px rgba(2,6,23,.55);font-size:13px;line-height:1.45}' +
    '.panel[hidden]{display:none}' +
    '.hd{display:flex;align-items:center;gap:8px;padding:13px 14px;border-bottom:1px solid #1e293b}' +
    '.hd b{font-size:13px;font-weight:600;letter-spacing:.2px}' +
    '.hd .x{margin-left:auto;color:#64748b;cursor:pointer;font-size:16px;line-height:1;padding:2px 5px;border-radius:6px}' +
    '.hd .x:hover{color:#e2e8f0;background:#1e293b}' +
    '.bd{padding:12px 14px;display:flex;flex-direction:column;gap:9px}' +
    'button.act{width:100%;padding:9px 12px;border-radius:9px;border:1px solid transparent;cursor:pointer;font-size:13px;' +
      'font-weight:600;text-align:left;display:flex;align-items:center;gap:8px;transition:filter .12s}' +
    'button.act:disabled{opacity:.5;cursor:default}' +
    'button.primary{background:#22d3ee;color:#04222b;border-color:#22d3ee}' +
    'button.primary:hover:not(:disabled){filter:brightness(1.06)}' +
    'button.ghost{background:#0b1424;color:#cbd5e1;border-color:#334155}' +
    'button.ghost:hover:not(:disabled){border-color:#475569;background:#111c30}' +
    '.act .sub{margin-left:auto;font-weight:400;color:#64748b;font-size:11px}' +
    '.primary .sub{color:#0e5f70}' +
    '.sep{height:1px;background:#1e293b;margin:2px 0}' +
    '.creds summary{cursor:pointer;color:#94a3b8;font-size:12px;padding:2px 0;list-style:none;display:flex;align-items:center;gap:6px}' +
    '.creds summary::-webkit-details-marker{display:none}' +
    '.creds summary .chev{transition:transform .15s;color:#64748b}' +
    '.creds[open] summary .chev{transform:rotate(90deg)}' +
    '.creds .fields{display:flex;flex-direction:column;gap:7px;padding-top:9px}' +
    '.creds input{width:100%;padding:8px 10px;border-radius:8px;background:#0b1424;border:1px solid #334155;color:#e2e8f0;font-size:12px}' +
    '.creds input:focus{outline:none;border-color:#22d3ee}' +
    '.creds .save{align-self:flex-start;padding:6px 12px;font-size:12px;font-weight:600;border-radius:8px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;cursor:pointer}' +
    '.creds .save:hover{border-color:#475569}' +
    '.hint{color:#64748b;font-size:11px}' +
    '.status{display:flex;align-items:center;gap:8px;padding:11px 14px;border-top:1px solid #1e293b;color:#94a3b8;font-size:12px;min-height:40px}' +
    '.status a{color:#22d3ee;text-decoration:none;font-weight:600}' +
    '.status a:hover{text-decoration:underline}' +
    '.dot{width:8px;height:8px;border-radius:50%;background:#475569;flex:0 0 auto}' +
    '.dot.run{background:#22d3ee;animation:pulse 1.1s infinite}' +
    '.dot.ok{background:#34d399}.dot.err{background:#f87171}' +
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}';

  var host = document.createElement('div');
  host.setAttribute('data-aegis', '');
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>' + CSS + '</style>' +
    '<div class="fab" title="AegisRunner — scan this app">' + SVG + '</div>' +
    '<div class="panel" hidden>' +
      '<div class="hd">' + SVG + '<b>AegisRunner</b><span class="x" title="Close">×</span></div>' +
      '<div class="bd">' +
        '<button class="act primary" data-scope="page">Test this page<span class="sub">this route</span></button>' +
        '<button class="act ghost" data-scope="site">Test whole site<span class="sub">full crawl</span></button>' +
        '<button class="act ghost" id="aegis-run">Run generated tests<span class="sub">execute suite</span></button>' +
        '<div class="sep"></div>' +
        '<details class="creds">' +
          '<summary><span class="chev">›</span> Login credentials <span class="hint">(for gated pages)</span></summary>' +
          '<div class="fields">' +
            '<input type="text" autocomplete="off" data-f="u" placeholder="Username or email" />' +
            '<input type="password" autocomplete="off" data-f="p" placeholder="Password" />' +
            '<button class="save">Save credentials</button>' +
          '</div>' +
        '</details>' +
      '</div>' +
      '<div class="status"><span class="dot"></span><span class="msg">Ready to scan.</span></div>' +
    '</div>';

  var panel = root.querySelector('.panel');
  var dot = root.querySelector('.dot');
  var msg = root.querySelector('.msg');
  var actButtons = root.querySelectorAll('button.act');
  var scopeButtons = root.querySelectorAll('button.act[data-scope]');

  root.querySelector('.fab').addEventListener('click', function () {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) poll();
  });
  root.querySelector('.x').addEventListener('click', function () { panel.hidden = true; });

  scopeButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      var scope = b.getAttribute('data-scope');
      setStatus('run', scope === 'page' ? 'Scanning this page…' : 'Scanning the whole site…');
      setBusy(true);
      post('/scan', { scope: scope, path: location.pathname + location.search }).then(poll);
    });
  });

  var runBtn = root.querySelector('#aegis-run');
  if (runBtn) runBtn.addEventListener('click', function () {
    setStatus('run', 'Running your tests…');
    setBusy(true);
    post('/run', {}).then(poll);
  });

  root.querySelector('.save').addEventListener('click', function () {
    var u = root.querySelector('[data-f=u]').value.trim();
    var p = root.querySelector('[data-f=p]').value;
    post('/credentials', { username: u, password: p }).then(function () {
      var s = root.querySelector('.save');
      s.textContent = 'Saved ✓';
      setTimeout(function () { s.textContent = 'Save credentials'; }, 1800);
    });
  });

  var polling = false;
  function poll() {
    if (polling) return;
    polling = true;
    fetch(API + '/status').then(function (r) { return r.json(); }).then(function (s) {
      polling = false;
      applyStatus(s);
      if (s && s.scanning) setTimeout(poll, 1500);
    }).catch(function () { polling = false; });
  }

  function applyStatus(s) {
    s = s || {};
    if (s.scanning) { setStatus('run', s.message || 'Scanning…'); setBusy(true); return; }
    setBusy(false);
    if (s.error) { setStatus('err', s.message || 'Scan failed.'); return; }
    if (s.resultsUrl) {
      dot.className = 'dot ok';
      msg.innerHTML = escapeHtml(s.message || 'Done.') + ' <a href="' + encodeURI(s.resultsUrl) + '" target="_blank" rel="noopener">View results ↗</a>';
      return;
    }
    setStatus('', s.message || 'Ready to scan.');
  }

  function setStatus(kind, text) { dot.className = 'dot' + (kind ? ' ' + kind : ''); msg.textContent = text; }
  function setBusy(b) { actButtons.forEach(function (x) { x.disabled = b; }); }
  function escapeHtml(t) { var d = document.createElement('div'); d.textContent = String(t); return d.innerHTML; }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); }).catch(function () { return {}; });
  }

  document.documentElement.appendChild(host);
})();
