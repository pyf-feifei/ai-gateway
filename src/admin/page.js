export function getAdminPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Gateway</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg-0:#09090b;--bg-1:#0f0f13;--bg-2:#18181b;--bg-3:#27272a;
  --bg-hover:#1f1f25;--text-0:#fafafa;--text-1:#a1a1aa;--text-2:#71717a;
  --border:#27272a;--primary:#6366f1;--primary-hover:#818cf8;
  --success:#22c55e;--danger:#ef4444;--danger-hover:#dc2626;--warning:#f59e0b;
  --radius:8px;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg-0);color:var(--text-0);min-height:100vh}
a{color:inherit;text-decoration:none}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--bg-3);border-radius:3px}

/* Login */
.login-view{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg-0)}
.login-card{background:var(--bg-2);border:1px solid var(--border);border-radius:16px;padding:48px;width:420px;text-align:center}
.login-logo{font-size:32px;font-weight:700;background:linear-gradient(135deg,#6366f1,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
.login-sub{color:var(--text-2);margin-bottom:28px;font-size:14px}
.login-card input{margin-bottom:16px}

/* Layout */
.main-view{display:flex;min-height:100vh}
.sidebar{width:260px;background:var(--bg-1);border-right:1px solid var(--border);display:flex;flex-direction:column;position:fixed;height:100vh;z-index:10}
.sidebar-header{padding:24px 20px;border-bottom:1px solid var(--border)}
.sidebar-header .logo{font-size:20px;font-weight:700;background:linear-gradient(135deg,#6366f1,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sidebar-nav{flex:1;padding:12px}
.nav-item{display:block;padding:10px 16px;color:var(--text-1);border-radius:var(--radius);margin-bottom:4px;cursor:pointer;transition:all .15s;font-size:14px;font-weight:500}
.nav-item:hover{background:var(--bg-hover);color:var(--text-0)}
.nav-item.active{background:var(--primary);color:#fff}
.sidebar-footer{padding:16px;border-top:1px solid var(--border)}
.content{flex:1;margin-left:260px;padding:32px;max-width:1200px}

/* Section header */
.section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.section-header h2{font-size:24px;font-weight:600}

/* Cards */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:28px}
.stat-card{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:24px}
.stat-card .label{color:var(--text-2);font-size:13px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px}
.stat-card .value{font-size:36px;font-weight:700}
.info-card{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:24px}
.info-card h3{margin-bottom:12px;font-size:16px;font-weight:600}
.info-card p{color:var(--text-1);font-size:14px;line-height:2}
.info-card code{background:var(--bg-1);padding:2px 8px;border-radius:4px;font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-size:13px;color:var(--primary)}

/* Table */
.table-container{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:700px}
th{text-align:left;padding:12px 16px;background:var(--bg-3);font-size:12px;color:var(--text-2);font-weight:600;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
td{padding:12px 16px;border-top:1px solid var(--border);font-size:14px;vertical-align:middle}
tr:hover td{background:var(--bg-hover)}
.cell-truncate{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Badge */
.badge{display:inline-block;padding:3px 10px;border-radius:9999px;font-size:12px;font-weight:500}
.badge-on{background:rgba(34,197,94,.12);color:var(--success)}
.badge-off{background:rgba(239,68,68,.12);color:var(--danger)}

/* Buttons */
.btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all .15s;display:inline-flex;align-items:center;gap:6px;line-height:1.4}
.btn:active{transform:scale(.97)}
.btn-primary{background:var(--primary);color:#fff}
.btn-primary:hover{background:var(--primary-hover)}
.btn-danger{background:transparent;color:var(--danger);border:1px solid rgba(239,68,68,.3)}
.btn-danger:hover{background:var(--danger);color:#fff}
.btn-ghost{background:transparent;color:var(--text-1);border:1px solid var(--border)}
.btn-ghost:hover{background:var(--bg-hover);color:var(--text-0)}
.btn-sm{padding:5px 10px;font-size:12px}
.btn-full{width:100%;justify-content:center}

/* Forms */
input,textarea,select{width:100%;padding:10px 14px;background:var(--bg-0);border:1px solid var(--border);border-radius:6px;color:var(--text-0);font-size:14px;font-family:inherit;outline:none;transition:border-color .15s}
input:focus,textarea:focus,select:focus{border-color:var(--primary)}
input::placeholder,textarea::placeholder{color:var(--text-2)}
textarea{resize:vertical;min-height:100px}
label{display:block;margin-bottom:6px;font-size:13px;color:var(--text-1);font-weight:500}
.form-group{margin-bottom:16px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.form-help{font-size:12px;color:var(--text-2);margin-top:4px}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;backdrop-filter:blur(2px)}
.modal{background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:28px;width:560px;max-height:85vh;overflow-y:auto}
.modal h3{font-size:18px;margin-bottom:20px;font-weight:600}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}

/* Toast */
.toast-container{position:fixed;top:20px;right:20px;z-index:200}
.toast{background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius);padding:12px 20px;margin-bottom:8px;font-size:14px;animation:slideIn .3s ease;min-width:240px}
.toast.success{border-left:3px solid var(--success)}
.toast.error{border-left:3px solid var(--danger)}
@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}

/* Key display */
.key-mono{font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-size:13px;background:var(--bg-0);padding:3px 8px;border-radius:4px;display:inline-block}

/* Empty state */
.empty{text-align:center;color:var(--text-2);padding:48px 20px;font-size:14px}
</style>
</head>
<body>
<div id="app">

<!-- ====== Login ====== -->
<div id="login-view" class="login-view">
  <div class="login-card">
    <div class="login-logo">AI Gateway</div>
    <p class="login-sub">Enter admin password or API key to continue</p>
    <input type="password" id="login-pwd" placeholder="Password or API Key" autofocus>
    <button class="btn btn-primary btn-full" onclick="doLogin()">Sign In</button>
  </div>
</div>

<!-- ====== Main ====== -->
<div id="main-view" class="main-view" style="display:none">
  <aside class="sidebar">
    <div class="sidebar-header"><div class="logo">AI Gateway</div></div>
    <nav class="sidebar-nav">
      <a class="nav-item active" data-section="dashboard" onclick="navigate('dashboard')">Dashboard</a>
      <a class="nav-item" data-section="channels" onclick="navigate('channels')">Channels</a>
      <a class="nav-item" data-section="apikeys" onclick="navigate('apikeys')">API Keys</a>
    </nav>
    <div class="sidebar-footer">
      <button class="btn btn-ghost btn-full" onclick="doLogout()">Sign Out</button>
    </div>
  </aside>

  <main class="content">
    <!-- Dashboard -->
    <section id="section-dashboard" class="section">
      <div class="section-header"><h2>Dashboard</h2></div>
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Total Channels</div><div class="value" id="s-ch">0</div></div>
        <div class="stat-card"><div class="label">Enabled</div><div class="value" id="s-en">0</div></div>
        <div class="stat-card"><div class="label">Upstream Keys</div><div class="value" id="s-uk">0</div></div>
        <div class="stat-card"><div class="label">Client API Keys</div><div class="value" id="s-ak">0</div></div>
      </div>
      <div class="info-card">
        <h3>Quick Start</h3>
        <p>1. Go to <strong>Channels</strong> and add an upstream API service with keys</p>
        <p>2. Go to <strong>API Keys</strong> and generate a client key</p>
        <p>3. Point your AI client to one of the endpoints below:</p>
        <p style="margin-top:8px"><strong>OpenAI format:</strong> <code id="proxy-url"></code></p>
        <p><strong>Claude format:</strong> <code id="proxy-url-claude"></code></p>
        <div class="form-help" style="margin-top:8px">Claude endpoint accepts <code>x-api-key</code> or <code>Authorization: Bearer</code> header for authentication.</div>
      </div>
    </section>

    <!-- Channels -->
    <section id="section-channels" class="section" style="display:none">
      <div class="section-header">
        <h2>Channels</h2>
        <button class="btn btn-primary" onclick="showChModal()">Add Channel</button>
      </div>
      <div class="table-container">
        <table>
          <thead><tr><th>Name</th><th>Base URL</th><th>Keys</th><th>Models</th><th>Priority</th><th>Weight</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="ch-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- API Keys -->
    <section id="section-apikeys" class="section" style="display:none">
      <div class="section-header">
        <h2>API Keys</h2>
        <button class="btn btn-primary" onclick="showAkModal()">Generate Key</button>
      </div>
      <div class="table-container">
        <table>
          <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="ak-tbody"></tbody>
        </table>
      </div>
    </section>
  </main>
</div>

<!-- Modal -->
<div id="modal-overlay" class="modal-overlay" style="display:none">
  <div class="modal" id="modal-box"></div>
</div>

<!-- Toast -->
<div id="toast-container" class="toast-container"></div>

</div>
<script>
// ============ State ============
let token = localStorage.getItem('ag_token');
let channels = [];
let apiKeys = [];
let curSection = 'dashboard';

// ============ API ============
async function api(path, opts = {}) {
  try {
    const res = await fetch('/admin/api' + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) { doLogout(); toast('Session expired', 'error'); return null; }
    return await res.json();
  } catch (e) {
    toast('Network error: ' + e.message, 'error');
    return null;
  }
}

async function loadData() {
  const [ch, ak] = await Promise.all([api('/channels'), api('/apikeys')]);
  channels = ch || [];
  apiKeys = ak || [];
}

// ============ Auth ============
async function doLogin() {
  const pwd = document.getElementById('login-pwd').value;
  if (!pwd) { toast('Please enter password', 'error'); return; }
  try {
    const res = await fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    });
    const data = await res.json();
    if (res.ok && data.token) {
      token = data.token;
      localStorage.setItem('ag_token', token);
      showMain();
      await loadData();
      render();
    } else {
      toast(data.error || 'Login failed', 'error');
    }
  } catch (e) {
    toast('Network error', 'error');
  }
}

function doLogout() {
  token = null;
  localStorage.removeItem('ag_token');
  showLogin();
}

// ============ Views ============
function showLogin() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('main-view').style.display = 'none';
}

function showMain() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('main-view').style.display = 'flex';
}

function navigate(section) {
  curSection = section;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === section);
  });
  document.querySelectorAll('.section').forEach(el => {
    el.style.display = el.id === 'section-' + section ? 'block' : 'none';
  });
  render();
}

function render() {
  renderDashboard();
  if (curSection === 'channels') renderChannels();
  if (curSection === 'apikeys') renderApiKeys();
}

// ============ Dashboard ============
function renderDashboard() {
  const en = channels.filter(c => c.enabled).length;
  const uk = channels.reduce((s, c) => s + (c.keys?.length || 0), 0);
  document.getElementById('s-ch').textContent = channels.length;
  document.getElementById('s-en').textContent = en;
  document.getElementById('s-uk').textContent = uk;
  document.getElementById('s-ak').textContent = apiKeys.length;
  document.getElementById('proxy-url').textContent = location.origin + '/v1';
  document.getElementById('proxy-url-claude').textContent = location.origin + '/v1/messages';
}

// ============ Channels ============
function renderChannels() {
  const tb = document.getElementById('ch-tbody');
  if (!channels.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty">No channels yet. Click "Add Channel" to get started.</td></tr>';
    return;
  }
  tb.innerHTML = channels.map(c => \`
    <tr>
      <td><strong>\${esc(c.name)}</strong></td>
      <td class="cell-truncate" title="\${esc(c.base_url)}">\${esc(c.base_url)}</td>
      <td>\${c.keys?.length || 0}</td>
      <td>\${c.models?.length || '<span style="color:var(--text-2)">All</span>'}</td>
      <td>\${c.priority}</td>
      <td>\${c.weight}</td>
      <td><span class="badge \${c.enabled ? 'badge-on' : 'badge-off'}">\${c.enabled ? 'On' : 'Off'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-ghost" onclick="showChModal('\${c.id}')">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleCh('\${c.id}')">\${c.enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-sm btn-danger" onclick="confirmDel('channel','\${c.id}','\${esc(c.name)}')">Delete</button>
      </td>
    </tr>
  \`).join('');
}

function showChModal(id) {
  const ch = id ? channels.find(c => c.id === id) : null;
  const t = ch ? 'Edit Channel' : 'Add Channel';
  const html = \`
    <h3>\${t}</h3>
    <div class="form-group">
      <label>Name</label>
      <input id="f-name" value="\${ch ? esc(ch.name) : ''}" placeholder="e.g. NVIDIA NIM">
    </div>
    <div class="form-group">
      <label>Base URL</label>
      <input id="f-url" value="\${ch ? esc(ch.base_url) : ''}" placeholder="e.g. https://integrate.api.nvidia.com/v1">
      <div class="form-help">Include the version path, e.g. /v1</div>
    </div>
    <div class="form-group">
      <label>API Keys (one per line)</label>
      <textarea id="f-keys" placeholder="sk-xxx\\nsk-yyy">\${ch ? (ch.keys||[]).join('\\n') : ''}</textarea>
    </div>
    <div class="form-group">
      <label>Models (one per line, empty = accept all)</label>
      <textarea id="f-models" style="min-height:80px" placeholder="gpt-4o\\nclaude-3-opus">\${ch ? (ch.models||[]).join('\\n') : ''}</textarea>
      <div class="form-help">Only requests for these models will route to this channel. Leave empty to accept any model.</div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Priority</label>
        <input type="number" id="f-pri" value="\${ch ? ch.priority : 0}" min="0">
        <div class="form-help">Lower = higher priority. Tried first.</div>
      </div>
      <div class="form-group">
        <label>Weight</label>
        <input type="number" id="f-wt" value="\${ch ? ch.weight : 10}" min="1">
        <div class="form-help">Relative weight within same priority group.</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCh('\${id||''}')">Save</button>
    </div>
  \`;
  openModal(html);
}

async function saveCh(id) {
  const name = document.getElementById('f-name').value.trim();
  const base_url = document.getElementById('f-url').value.trim();
  const keys = document.getElementById('f-keys').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  const models = document.getElementById('f-models').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  const priority = parseInt(document.getElementById('f-pri').value) || 0;
  const weight = parseInt(document.getElementById('f-wt').value) || 1;

  if (!name || !base_url) { toast('Name and Base URL are required', 'error'); return; }

  const body = JSON.stringify({ name, base_url, keys, models, priority, weight });
  const r = id
    ? await api('/channels/' + id, { method: 'PUT', body })
    : await api('/channels', { method: 'POST', body });

  if (r && !r.error) {
    toast(id ? 'Channel updated' : 'Channel created', 'success');
    closeModal();
    await loadData();
    render();
  } else {
    toast(r?.error || 'Save failed', 'error');
  }
}

async function toggleCh(id) {
  const r = await api('/channels/' + id + '/toggle', { method: 'PATCH' });
  if (r && !r.error) { await loadData(); render(); }
}

// ============ API Keys ============
function renderApiKeys() {
  const tb = document.getElementById('ak-tbody');
  if (!apiKeys.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty">No API keys. Click "Generate Key" to create one.</td></tr>';
    return;
  }
  tb.innerHTML = apiKeys.map(k => \`
    <tr>
      <td>\${esc(k.name)}</td>
      <td><span class="key-mono">\${maskKey(k.key)}</span>
        <button class="btn btn-sm btn-ghost" style="margin-left:8px" data-key="\${esc(k.key)}" onclick="copyKey(this)">Copy</button>
      </td>
      <td>\${fmtDate(k.created_at)}</td>
      <td><span class="badge \${k.enabled?'badge-on':'badge-off'}">\${k.enabled?'On':'Off'}</span></td>
      <td>
        <button class="btn btn-sm btn-ghost" onclick="toggleAk('\${k.id}')">\${k.enabled?'Disable':'Enable'}</button>
        <button class="btn btn-sm btn-danger" onclick="confirmDel('apikey','\${k.id}','\${esc(k.name)}')">Delete</button>
      </td>
    </tr>
  \`).join('');
}

function showAkModal() {
  openModal(\`
    <h3>Generate API Key</h3>
    <div class="form-group">
      <label>Name (optional)</label>
      <input id="f-akname" placeholder="e.g. My App">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="genAk()">Generate</button>
    </div>
  \`);
}

async function genAk() {
  const name = document.getElementById('f-akname').value.trim() || 'Unnamed';
  const r = await api('/apikeys', { method: 'POST', body: JSON.stringify({ name }) });
  if (r && !r.error) {
    closeModal();
    openModal(\`
      <h3>API Key Created</h3>
      <p style="color:var(--text-1);margin-bottom:16px">Copy this key now. It will be masked after you close this dialog.</p>
      <div class="form-group">
        <input type="text" value="\${r.key}" readonly onclick="this.select()" style="font-family:monospace;font-size:13px">
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="copyText('\${r.key}');closeModal()">Copy & Close</button>
      </div>
    \`);
    await loadData();
    render();
  } else {
    toast(r?.error || 'Failed', 'error');
  }
}

async function toggleAk(id) {
  const k = apiKeys.find(x => x.id === id);
  if (!k) return;
  const r = await api('/apikeys/' + id, { method: 'PATCH', body: JSON.stringify({ enabled: !k.enabled }) });
  if (r && !r.error) { await loadData(); render(); }
}

// ============ Shared ============
function confirmDel(type, id, name) {
  openModal(\`
    <h3>Confirm Delete</h3>
    <p style="color:var(--text-1);margin-bottom:24px">Are you sure you want to delete <strong>\${name}</strong>? This cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="del-btn">Delete</button>
    </div>
  \`);
  document.getElementById('del-btn').onclick = async () => {
    closeModal();
    const path = type === 'channel' ? '/channels/' : '/apikeys/';
    const r = await api(path + id, { method: 'DELETE' });
    if (r && !r.error) {
      toast('Deleted', 'success');
      await loadData();
      render();
    }
  };
}

// ============ Modal ============
function openModal(html) {
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// ============ Toast ============
function toast(msg, type) {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ============ Util ============
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function maskKey(k) { return k && k.length > 12 ? k.slice(0,7) + '...' + k.slice(-4) : k; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '-'; }
function copyKey(btn) { copyText(btn.dataset.key); }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied!', 'success'); }
  catch { toast('Copy failed', 'error'); }
}

// ============ Events ============
document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('login-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ============ Init ============
(async () => {
  if (token) {
    showMain();
    await loadData();
    render();
  } else {
    showLogin();
  }
  document.getElementById('proxy-url').textContent = location.origin + '/v1';
  document.getElementById('proxy-url-claude').textContent = location.origin + '/v1/messages';
})();
</script>
</body>
</html>`;
}
