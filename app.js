// app.js - logica principal de la app

const PROXY_URL = 'https://claudeworker.fedemusic2008.workers.dev';

let db = {
  cards: [], extHolders: [], summaries: [],
  gastos: [], gastosTerceros: [],
  categories: ['Supermercado','Restaurantes / Comida','Nafta / Transporte','Servicios','Salud','Ropa / Indumentaria','Entretenimiento','Viajes','Otros'],
  fxRate: 1200
};

let cfg = { clientId: '', apiKey: '', sheetId: '' };
let useSheets = false;
let pendingExtraction = null;
let manualExtCount = 0;
let syncTimeout = null;

// --- Storage ---

function saveLocal() { localStorage.setItem('tarjetas_db', JSON.stringify(db)); }
function loadLocal() {
  const d = localStorage.getItem('tarjetas_db');
  if (d) { try { const p = JSON.parse(d); db = { ...db, ...p }; } catch {} }
}
function saveCfg() { localStorage.setItem('tarjetas_cfg', JSON.stringify(cfg)); }
function loadCfg() {
  const d = localStorage.getItem('tarjetas_cfg');
  if (d) { try { cfg = { ...cfg, ...JSON.parse(d) }; } catch {} }
}

// --- Sync ---

function setSyncStatus(state, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  dot.className = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
  lbl.textContent = label;
}

async function saveAndSync() {
  saveLocal();
  if (!useSheets || !isAuthorized) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    setSyncStatus('syncing', 'sincronizando...');
    const ok = await pushToSheets(cfg.sheetId, db);
    setSyncStatus(ok ? 'ok' : 'error', ok ? 'sincronizado' : 'error de sync');
  }, 800);
}

async function manualSync() {
  if (!useSheets || !isAuthorized) { alert('Conecta Google Sheets primero'); return; }
  setSyncStatus('syncing', 'sincronizando...');
  document.getElementById('sync-btn').disabled = true;
  const remote = await pullFromSheets(cfg.sheetId);
  if (remote) {
    db = { ...db, ...remote };
    saveLocal();
    renderCurrentSection();
    setSyncStatus('ok', 'sincronizado');
  } else {
    const ok = await pushToSheets(cfg.sheetId, db);
    setSyncStatus(ok ? 'ok' : 'error', ok ? 'sincronizado' : 'error');
  }
  document.getElementById('sync-btn').disabled = false;
}

// --- Auth / init ---

function initApp() {
  const clientId = (document.getElementById('cfg-client-id').value.trim()) || cfg.clientId;
  const apiKey   = (document.getElementById('cfg-api-key').value.trim())   || cfg.apiKey;
  const sheetId  = (document.getElementById('cfg-sheet-id').value.trim())  || cfg.sheetId;
  if (!clientId || !apiKey || !sheetId) { alert('Completa todos los campos'); return; }
  cfg = { clientId, apiKey, sheetId };
  saveCfg();
  useSheets = true;
  launchApp();
}

function useLocalOnly() {
  useSheets = false;
  launchApp();
}

function launchApp() {
  loadLocal();
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  if (useSheets) {
    setSyncStatus('syncing', 'conectando...');
    sheetsInit(cfg.clientId, cfg.apiKey, (ok) => {
      if (!ok) { setSyncStatus('error', 'error de config'); return; }
      window._sheetsOnAuth = async () => {
        setSyncStatus('syncing', 'cargando...');
        const remote = await pullFromSheets(cfg.sheetId);
        if (remote) { db = { ...db, ...remote }; saveLocal(); }
        renderCurrentSection();
        setSyncStatus('ok', 'sincronizado');
      };
      sheetsSignIn();
    });
  } else {
    setSyncStatus('error', 'solo local');
  }

  initDefaults();
  renderCurrentSection();
  populateCardSelects();
  populateGastoCats();
  populateGastoTerceroSelects();
  renderCats();
  renderDashboard();
  updateConfigFields();
}

function initDefaults() {
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const today = now.toISOString().slice(0, 10);
  ['m-month','ge-month','gt-month','upload-month','ext-filter-month','gf-month','gtf-month','cat-month-filter'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.type === 'month' && !el.value) el.value = ym;
  });
  ['ge-date','gt-date'].forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = today; });
  document.getElementById('fx-rate').value = db.fxRate || 1200;
}

// --- Navigation ---

let currentSection = 'dashboard';
function nav(btn, sec) {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + sec).classList.add('active');
  currentSection = sec;
  if (sec === 'dashboard')   renderDashboard();
  if (sec === 'tarjetas')    renderCards();
  if (sec === 'extensiones') { renderExtHolders(); renderExtSummary(); }
  if (sec === 'gastos')      { populateGastoCats(); populateGastoTerceroSelects(); renderGastos(); renderGastosTerceros(); }
  if (sec === 'categorias')  { renderCats(); renderCatSummary(); }
  if (sec === 'historico')   { populateHistoricoFilters(); renderHistorico(); }
  if (sec === 'config')      updateConfigFields();
}

function renderCurrentSection() {
  if (currentSection === 'dashboard') renderDashboard();
}

function gastosTab(btn, id) {
  document.querySelectorAll('.tabs2 button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('ge-propio').style.display  = id === 'ge-propio'   ? 'block' : 'none';
  document.getElementById('ge-terceros').style.display = id === 'ge-terceros' ? 'block' : 'none';
}

// --- Formatters ---

function fmt(n) { return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
  return dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}
function getPrevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
}

// --- Dashboard ---

function renderDashboard() {
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const lbl = document.getElementById('dash-month-label');
  if (lbl) lbl.textContent = new Date(ym + '-01').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const ms = db.summaries.filter(s => s.month === ym);
  let totalARS = 0, totalMin = 0, totalUSD = 0, nextVenc = null;
  ms.forEach(s => {
    totalARS += Number(s.total || 0);
    totalMin += Number(s.minimo || 0);
    totalUSD += Number(s.totalUSD || 0);
    if (s.vencimiento) { const d = new Date(s.vencimiento); if (!nextVenc || d < nextVenc) nextVenc = d; }
  });
  document.getElementById('d-total').textContent = '$' + fmt(totalARS);
  document.getElementById('d-min').textContent = '$' + fmt(totalMin);
  document.getElementById('d-usd').textContent = 'U$S ' + fmt(totalUSD);
  document.getElementById('d-venc').textContent = nextVenc ? nextVenc.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : '-';

  const dc = document.getElementById('dash-cards');
  if (!ms.length) { dc.innerHTML = '<div class="empty">Sin datos para este mes</div>'; }
  else {
    dc.innerHTML = ms.map(s => {
      const card = db.cards.find(c => c.id === s.cardId) || { name: s.cardName || 'Tarjeta', autoDebit: 'no' };
      const extra = Number(s.total || 0) - Number(s.minimo || 0);
      return '<div class="card-summary-item">' +
        '<div>' +
          '<div style="font-weight:500;font-size:13px;margin-bottom:3px">' + card.name + '</div>' +
          '<div style="font-size:11px;color:var(--text2)">Vence: ' + fmtDate(s.vencimiento) + ' &nbsp;·&nbsp; Min: $' + fmt(s.minimo || 0) + '</div>' +
          (card.autoDebit === 'yes' && extra > 0 ? '<div style="font-size:11px;color:var(--amber);margin-top:2px">Extra sobre minimo: $' + fmt(extra) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-family:var(--mono);font-size:14px;font-weight:500">$' + fmt(s.total || 0) + '</div>' +
          (s.totalUSD > 0 ? '<div style="font-size:11px;color:var(--text2)">U$S ' + fmt(s.totalUSD) + '</div>' : '') +
          '<span class="badge ' + (card.autoDebit === 'yes' ? 'amber' : 'blue') + '" style="margin-top:4px;display:inline-block">' + (card.autoDebit === 'yes' ? 'debito auto' : 'manual') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  const de = document.getElementById('dash-ext');
  let extData = {};
  ms.forEach(s => (s.extensions || []).forEach(e => {
    if (!extData[e.holder]) extData[e.holder] = 0;
    extData[e.holder] += Number(e.total || 0);
  }));
  const extKeys = Object.keys(extData);
  if (!extKeys.length) { de.innerHTML = '<div class="empty">Sin extensiones este mes</div>'; }
  else {
    de.innerHTML = extKeys.map(k =>
      '<div class="ext-row"><span style="font-weight:500">' + k + '</span><span class="badge blue" style="font-family:var(--mono)">$' + fmt(extData[k]) + '</span></div>'
    ).join('');
  }

  const dn = document.getElementById('dash-new');
  const prevYM = getPrevMonth(ym);
  const prevDescs = new Set();
  db.summaries.filter(s => s.month === prevYM).forEach(s => (s.ownExpenses || []).forEach(e => prevDescs.add(e.desc.toLowerCase().trim())));
  const newItems = [];
  ms.forEach(s => (s.ownExpenses || []).forEach(e => {
    if (!prevDescs.has(e.desc.toLowerCase().trim())) newItems.push({ desc: e.desc, amount: e.amount, card: s.cardName || '' });
  }));
  if (!newItems.length) { dn.innerHTML = '<div class="empty">Sin gastos nuevos vs mes anterior</div>'; }
  else {
    dn.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Descripcion</th><th>Tarjeta</th><th>Monto</th></tr></thead><tbody>' +
      newItems.slice(0, 10).map(i =>
        '<tr><td>' + i.desc + ' <span class="badge new">nuevo</span></td><td style="color:var(--text2)">' + i.card + '</td><td class="num">$' + fmt(i.amount) + '</td></tr>'
      ).join('') +
      '</tbody></table></div>';
  }
}

// --- Cards ---

function saveCard() {
  const name = document.getElementById('tc-name').value.trim();
  const bank = document.getElementById('tc-bank').value.trim();
  const type = document.getElementById('tc-type').value;
  const auto = document.getElementById('tc-auto').value;
  const editId = document.getElementById('tc-edit-id').value;
  if (!name) return;
  if (editId) {
    const c = db.cards.find(c => c.id === editId);
    if (c) { c.name = name; c.bank = bank; c.type = type; c.autoDebit = auto; }
  } else {
    db.cards.push({ id: 'c' + Date.now(), name, bank, type, autoDebit: auto });
  }
  saveAndSync(); renderCards(); populateCardSelects(); cancelEditCard();
}

function editCard(id) {
  const c = db.cards.find(c => c.id === id);
  if (!c) return;
  document.getElementById('tc-name').value = c.name || '';
  document.getElementById('tc-bank').value = c.bank || '';
  document.getElementById('tc-type').value = c.type || 'VISA';
  document.getElementById('tc-auto').value = c.autoDebit || 'no';
  document.getElementById('tc-edit-id').value = id;
  document.getElementById('card-form-title').textContent = 'Editar tarjeta';
  document.getElementById('card-save-btn').textContent = 'Guardar cambios';
  document.getElementById('card-cancel-btn').style.display = 'inline-block';
  document.getElementById('card-form-section').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditCard() {
  document.getElementById('tc-name').value = '';
  document.getElementById('tc-bank').value = '';
  document.getElementById('tc-type').value = 'VISA';
  document.getElementById('tc-auto').value = 'no';
  document.getElementById('tc-edit-id').value = '';
  document.getElementById('card-form-title').textContent = 'Nueva tarjeta';
  document.getElementById('card-save-btn').textContent = 'Agregar tarjeta';
  document.getElementById('card-cancel-btn').style.display = 'none';
}

function renderCards() {
  const el = document.getElementById('cards-list');
  const filter = (document.getElementById('cards-filter') || {}).value || '';
  let cards = [...db.cards].sort((a, b) => {
    const ka = (a.bank || '') + '|' + (a.name || '');
    const kb = (b.bank || '') + '|' + (b.name || '');
    return ka.localeCompare(kb, 'es');
  });
  if (filter) {
    const f = filter.toLowerCase();
    cards = cards.filter(c => (c.name || '').toLowerCase().includes(f) || (c.bank || '').toLowerCase().includes(f));
  }
  if (!cards.length) { el.innerHTML = '<div class="empty">Sin tarjetas</div>'; return; }
  el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Banco</th><th>Nombre</th><th>Tipo</th><th>Deb. auto</th><th></th></tr></thead><tbody>' +
    cards.map(c =>
      '<tr><td>' + (c.bank || '-') + '</td><td><b>' + c.name + '</b></td>' +
      '<td><span class="tag">' + (c.type || '-') + '</span></td>' +
      '<td><span class="badge ' + (c.autoDebit === 'yes' ? 'amber' : 'green') + '">' + (c.autoDebit === 'yes' ? 'si' : 'no') + '</span></td>' +
      '<td style="display:flex;gap:4px">' +
        '<button class="btn sm" onclick="editCard(\'' + c.id + '\')">editar</button>' +
        '<button class="btn danger sm" onclick="delCard(\'' + c.id + '\')">x</button>' +
      '</td></tr>'
    ).join('') +
    '</tbody></table></div>';
}

function delCard(id) {
  if (!confirm('Eliminar tarjeta?')) return;
  db.cards = db.cards.filter(c => c.id !== id);
  saveAndSync(); renderCards(); populateCardSelects();
}

function populateCardSelects() {
  const sorted = [...db.cards].sort((a, b) => ((a.bank||'')+'|'+(a.name||'')).localeCompare((b.bank||'')+'|'+(b.name||''), 'es'));
  const opts = '<option value="">Seleccionar...</option>' + sorted.map(c => '<option value="' + c.id + '">' + (c.bank ? c.bank + ' - ' : '') + c.name + '</option>').join('');
  ['upload-card','m-card','gt-card'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = opts; });
}

// --- Extension holders ---

function addExtHolder() {
  const n = document.getElementById('ext-name').value.trim();
  if (!n) return;
  db.extHolders.push({ id: 'h' + Date.now(), name: n });
  saveAndSync(); renderExtHolders(); populateGastoTerceroSelects();
  document.getElementById('ext-name').value = '';
}

function renderExtHolders() {
  const el = document.getElementById('ext-holders-list');
  if (!db.extHolders.length) { el.innerHTML = '<div class="empty">Sin titulares</div>'; return; }
  el.innerHTML = db.extHolders.map(h =>
    '<div class="ext-row"><span style="font-weight:500">' + h.name + '</span><button class="btn danger sm" onclick="delHolder(\'' + h.id + '\')">x</button></div>'
  ).join('');
}

function delHolder(id) { db.extHolders = db.extHolders.filter(h => h.id !== id); saveAndSync(); renderExtHolders(); }

function renderExtSummary() {
  const ym = document.getElementById('ext-filter-month').value;
  const el = document.getElementById('ext-summary');
  if (!ym) { el.innerHTML = '<div class="empty">Selecciona un mes</div>'; return; }
  const ms = db.summaries.filter(s => s.month === ym);
  let extData = {};
  ms.forEach(s => (s.extensions || []).forEach(e => {
    if (!extData[e.holder]) extData[e.holder] = { items: [], total: 0 };
    extData[e.holder].total += Number(e.total || 0);
    (e.items || []).forEach(i => extData[e.holder].items.push({ desc: i.desc, amount: i.amount, card: s.cardName }));
  }));
  const keys = Object.keys(extData);
  if (!keys.length) { el.innerHTML = '<div class="empty">Sin extensiones para este mes</div>'; return; }
  el.innerHTML = keys.map(k => {
    const rows = extData[k].items.length
      ? extData[k].items.map(i => '<tr><td>' + (i.desc || '-') + '</td><td style="color:var(--text2)">' + (i.card || '-') + '</td><td class="num">$' + fmt(i.amount || 0) + '</td></tr>').join('')
      : '<tr><td colspan="3" style="color:var(--text2)">Total: $' + fmt(extData[k].total) + '</td></tr>';
    return '<div style="margin-bottom:16px"><div style="font-weight:500;margin-bottom:8px">' + k + '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Descripcion</th><th>Tarjeta</th><th>Monto</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }).join('');
}

// --- Gastos extra ---

function populateGastoCats() {
  const opts = db.categories.map(c => '<option>' + c + '</option>').join('');
  const filterOpts = '<option value="">Todas las categorias</option>' + opts;
  const ge = document.getElementById('ge-cat'); if (ge) ge.innerHTML = opts;
  const gf = document.getElementById('gf-cat'); if (gf) gf.innerHTML = filterOpts;
}

function addGasto() {
  const desc = document.getElementById('ge-desc').value.trim();
  const amount = document.getElementById('ge-amount').value;
  if (!desc || !amount) return;
  db.gastos.push({
    id: 'g' + Date.now(), desc, amount: Number(amount),
    cat: document.getElementById('ge-cat').value,
    date: document.getElementById('ge-date').value,
    currency: document.getElementById('ge-curr').value,
    month: document.getElementById('ge-month').value
  });
  saveAndSync(); renderGastos();
  document.getElementById('ge-desc').value = ''; document.getElementById('ge-amount').value = '';
}

function renderGastos() {
  const ym = document.getElementById('gf-month').value;
  const cat = document.getElementById('gf-cat').value;
  let items = db.gastos;
  if (ym) items = items.filter(g => g.month === ym);
  if (cat) items = items.filter(g => g.cat === cat);
  const el = document.getElementById('gastos-list');
  if (!items.length) { el.innerHTML = '<div class="empty">Sin gastos</div>'; return; }
  const total = items.reduce((a, g) => a + Number(g.amount), 0);
  el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Descripcion</th><th>Categoria</th><th>Fecha</th><th>Monto</th><th></th></tr></thead><tbody>' +
    items.map(g =>
      '<tr><td>' + g.desc + '</td><td><span class="tag">' + (g.cat || '-') + '</span></td>' +
      '<td style="color:var(--text2)">' + (g.date || '-') + '</td>' +
      '<td class="num">' + (g.currency === 'USD' ? 'U$S' : '$') + fmt(g.amount) + '</td>' +
      '<td><button class="btn danger sm" onclick="delGasto(\'' + g.id + '\')">x</button></td></tr>'
    ).join('') +
    '</tbody></table></div>' +
    '<div style="text-align:right;padding:10px 0 0;font-family:var(--mono);font-size:13px;font-weight:500">Total: $' + fmt(total) + '</div>';
}

function delGasto(id) { db.gastos = db.gastos.filter(g => g.id !== id); saveAndSync(); renderGastos(); }

function populateGastoTerceroSelects() {
  const o = db.extHolders.map(h => '<option value="' + h.name + '">' + h.name + '</option>').join('');
  const h = document.getElementById('gt-holder'); if (h) h.innerHTML = '<option value="">Seleccionar...</option>' + o;
  const hf = document.getElementById('gtf-holder'); if (hf) hf.innerHTML = '<option value="">Todos</option>' + o;
}

function addGastoTercero() {
  const holder = document.getElementById('gt-holder').value;
  const amount = document.getElementById('gt-amount').value;
  if (!holder || !amount) return;
  const cardId = document.getElementById('gt-card').value;
  const card = db.cards.find(c => c.id === cardId);
  db.gastosTerceros.push({
    id: 't' + Date.now(), holder,
    desc: document.getElementById('gt-desc').value.trim(),
    amount: Number(amount), cardId,
    cardName: card ? card.name : '',
    date: document.getElementById('gt-date').value,
    month: document.getElementById('gt-month').value
  });
  saveAndSync(); renderGastosTerceros();
  document.getElementById('gt-desc').value = ''; document.getElementById('gt-amount').value = '';
}

function renderGastosTerceros() {
  const ym = document.getElementById('gtf-month').value;
  const holder = document.getElementById('gtf-holder').value;
  let items = db.gastosTerceros;
  if (ym) items = items.filter(g => g.month === ym);
  if (holder) items = items.filter(g => g.holder === holder);
  const el = document.getElementById('gastos-terceros-list');
  if (!items.length) { el.innerHTML = '<div class="empty">Sin gastos a terceros</div>'; return; }
  el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Titular</th><th>Descripcion</th><th>Tarjeta</th><th>Fecha</th><th>Monto</th><th></th></tr></thead><tbody>' +
    items.map(g =>
      '<tr><td><b>' + g.holder + '</b></td><td>' + (g.desc || '-') + '</td>' +
      '<td style="color:var(--text2)">' + (g.cardName || '-') + '</td>' +
      '<td style="color:var(--text2)">' + (g.date || '-') + '</td>' +
      '<td class="num">$' + fmt(g.amount) + '</td>' +
      '<td><button class="btn danger sm" onclick="delGastoT(\'' + g.id + '\')">x</button></td></tr>'
    ).join('') +
    '</tbody></table></div>';
}

function delGastoT(id) { db.gastosTerceros = db.gastosTerceros.filter(g => g.id !== id); saveAndSync(); renderGastosTerceros(); }

// --- Categories ---

function addCategory() {
  const n = document.getElementById('cat-new').value.trim();
  if (!n || db.categories.includes(n)) return;
  db.categories.push(n); saveAndSync(); renderCats();
  document.getElementById('cat-new').value = '';
}

function renderCats() {
  document.getElementById('cats-list').innerHTML = db.categories.map(c =>
    '<span class="tag" style="margin:4px;display:inline-flex;align-items:center;gap:4px">' + c +
    ' <button style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:14px;padding:0;line-height:1" onclick="delCat(\'' + c + '\')">x</button></span>'
  ).join('');
}

function delCat(c) { db.categories = db.categories.filter(x => x !== c); saveAndSync(); renderCats(); }

function renderCatSummary() {
  const ym = document.getElementById('cat-month-filter').value;
  const el = document.getElementById('cat-summary');
  if (!ym) { el.innerHTML = '<div class="empty">Selecciona un mes</div>'; return; }
  const items = db.gastos.filter(g => g.month === ym);
  const bycat = {};
  items.forEach(g => { const k = g.cat || 'Sin categoria'; if (!bycat[k]) bycat[k] = 0; bycat[k] += Number(g.amount); });
  const keys = Object.keys(bycat);
  if (!keys.length) { el.innerHTML = '<div class="empty">Sin gastos para este mes</div>'; return; }
  const total = Object.values(bycat).reduce((a, b) => a + b, 0);
  el.innerHTML = keys.sort((a, b) => bycat[b] - bycat[a]).map(k => {
    const pct = Math.round((bycat[k] / total) * 100);
    return '<div style="margin-bottom:12px">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
        '<span style="font-size:13px">' + k + '</span>' +
        '<span style="font-family:var(--mono);font-size:13px">$' + fmt(bycat[k]) + ' <span style="color:var(--text2)">(' + pct + '%)</span></span>' +
      '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
    '</div>';
  }).join('');
}

// --- AI Extraction ---

let uploadedFileData = null;
let uploadedFileType = null;

function resetDropZone(msg) {
  uploadedFileData = null;
  uploadedFileType = null;
  var zone = document.getElementById('drop-zone');
  zone.innerHTML = msg
    ? '<div class="icon" style="font-size:20px">!</div><div style="color:var(--text2)">' + msg + '</div><div class="hint">Toca para intentar con otro archivo</div>'
    : '<div class="icon">&#8593;</div><div>Toca para subir imagen o PDF del resumen</div><div class="hint">JPG &middot; PNG &middot; PDF</div>';
}

async function handleFile(inp) {
  var f = inp.files[0]; if (!f) return;
  // Reset input so same file can be re-selected
  inp.value = '';
  uploadedFileType = f.type;
  var zone = document.getElementById('drop-zone');
  zone.innerHTML = '<div class="icon">v</div><div>' + f.name + '</div><div class="hint">Listo para extraer</div>';

  if (f.type !== 'application/pdf') {
    // Image — just read as base64
    var r = new FileReader();
    r.onload = function(e) { uploadedFileData = e.target.result.split(',')[1]; };
    r.readAsDataURL(f);
    return;
  }

  // PDF — check if encrypted using pdfjs
  var arrayBuf = await f.arrayBuffer();
  var bytes = new Uint8Array(arrayBuf);
  var text = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
  var isEncrypted = text.includes('/Encrypt');

  if (!isEncrypted) {
    // Normal PDF
    var base64 = btoa(bytes.reduce(function(d, b){ return d + String.fromCharCode(b); }, ''));
    uploadedFileData = base64;
    return;
  }

  // Encrypted — use pdfjs to render pages to canvas then rebuild PDF
  zone.innerHTML = '<div class="icon">v</div><div>' + f.name + '</div><div class="hint">PDF protegido, solicitando contraseña...</div>';
  var pwd = prompt('Este PDF tiene contraseña. Ingresala para continuar:');
  if (pwd === null) { resetDropZone('Cancelado'); return; }

  try {
    var pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) { throw new Error('pdf.js no cargado'); }
    // Disable worker for CDN usage
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    var loadingTask = pdfjsLib.getDocument({ data: arrayBuf, password: pwd, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true });
    var pdfDoc = await loadingTask.promise;

    // Render each page to canvas and collect image data
    var pageImages = [];
    for (var p = 1; p <= pdfDoc.numPages; p++) {
      var page = await pdfDoc.getPage(p);
      var viewport = page.getViewport({ scale: 2.0 });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      pageImages.push(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
    }

    // If single page, send as image; if multi-page, send first page as image
    // and note in extraction
    uploadedFileData = pageImages[0];
    uploadedFileType = 'image/jpeg';
    // If multi-page, combine all images by sending them together
    if (pageImages.length > 1) {
      window._allPageImages = pageImages;
    }
    zone.innerHTML = '<div class="icon">v</div><div>' + f.name + ' (' + pdfDoc.numPages + ' pag, desencriptado)</div><div class="hint">Listo para extraer</div>';
  } catch(e) {
    var msg = e.message && e.message.toLowerCase().includes('password') ? 'Contrasena incorrecta. Intentalo de nuevo.' : 'No se pudo abrir el PDF: ' + e.message;
    resetDropZone(msg);
  }
}

async function extractWithAI() {
  if (!uploadedFileData) { alert('Primero subi un archivo'); return; }
  const out = document.getElementById('ai-output');
  const btn = document.getElementById('extract-btn');
  out.textContent = 'Extrayendo datos con IA...';
  btn.disabled = true;
  document.getElementById('confirm-btn').style.display = 'none';

  var userContent = [];
  if (uploadedFileType && uploadedFileType.startsWith('image/')) {
    // If multi-page PDF was converted to images, send all pages
    var pages = (window._allPageImages && window._allPageImages.length > 1) ? window._allPageImages : [uploadedFileData];
    for (var pi = 0; pi < pages.length; pi++) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: pages[pi] } });
    }
    window._allPageImages = null;
  } else {
    userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: uploadedFileData } });
  }

  const prompt = 'Analiza este resumen de tarjeta de credito argentina. Extrae TODOS los gastos y responde SOLO con JSON valido, sin markdown ni backticks:\n' +
    '{\n' +
    '  "cardName": "nombre de la tarjeta",\n' +
    '  "vencimiento": "YYYY-MM-DD",\n' +
    '  "minimo": numero en pesos,\n' +
    '  "total": numero en pesos,\n' +
    '  "totalUSD": numero en dolares (0 si no hay),\n' +
    '  "ownExpenses": [{"desc":"nombre del comercio","amount":numero del monto,"currency":"ARS o USD segun como aparece en el resumen","category":"una de: Supermercado/Restaurantes / Comida/Nafta / Transporte/Servicios/Salud/Ropa / Indumentaria/Entretenimiento/Viajes/Otros","date":"YYYY-MM-DD","cuotas":numero total de cuotas o null,"cuotaActual":numero de cuota actual o null}],\n' +
    '  "extensions": [{"holder":"nombre del titular","total":numero en pesos,"totalUSD":numero en dolares o 0,"items":[{"desc":"comercio","amount":numero,"currency":"ARS o USD","cuotas":numero o null,"cuotaActual":numero o null}]}]\n' +
    '}\n' +
    'REGLAS CRITICAS:\n' +
    '1. Incluir TODOS los gastos sin excepcion.\n' +
    '2. El campo currency debe ser USD si el monto figura en dolares en el resumen (columna DOLARES o dice USD), ARS si figura en pesos.\n' +
    '3. Para consumos en cuotas el amount es el monto de la cuota de este mes. Ejemplo: "cuotaActual":3,"cuotas":12.\n' +
    '4. Las extensiones tienen su propia seccion separada identificada con el nombre del titular.\n' +
    '5. Los intereses, impuestos y percepciones tambien deben incluirse como gastos con categoria Otros.';

  userContent.push({ type: 'text', text: prompt });

  try {
    const resp = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, messages: [{ role: 'user', content: userContent }] })
    });
    const data = await resp.json();
    if (data.error || !data.content) {
      out.textContent = 'Error de API:\n' + JSON.stringify(data, null, 2);
      btn.disabled = false;
      return;
    }
    const text = data.content.map(i => i.text || '').join('');
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
      pendingExtraction = JSON.parse(clean);
      out.textContent = JSON.stringify(pendingExtraction, null, 2);
      document.getElementById('confirm-btn').style.display = 'inline-block';
    } catch(e) {
      out.textContent = 'No se pudo parsear la respuesta:\n' + text;
    }
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false;
}

function confirmExtraction() {
  if (!pendingExtraction) return;
  const cardId = document.getElementById('upload-card').value;
  const month  = document.getElementById('upload-month').value;
  const card   = db.cards.find(c => c.id === cardId) || null;
  const p = pendingExtraction;
  db.summaries.push({
    id: 's' + Date.now(), cardId, uploadedAt: new Date().toISOString(),
    cardName: card ? card.name : (p.cardName || 'Tarjeta'),
    month, vencimiento: p.vencimiento || '',
    minimo: Number(p.minimo || 0),
    total: Number(p.total || 0),
    totalUSD: Number(p.totalUSD || 0),
    ownExpenses: p.ownExpenses || [],
    extensions: p.extensions || []
  });
  saveAndSync();
  pendingExtraction = null;
  document.getElementById('ai-output').textContent = 'Guardado correctamente.';
  document.getElementById('confirm-btn').style.display = 'none';
  resetDropZone();
  renderDashboard();
}

function addManualExt() {
  const list = document.getElementById('manual-ext-list');
  const id = 'mext' + manualExtCount++;
  const div = document.createElement('div');
  div.id = id;
  div.style = 'display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap';
  div.innerHTML = '<input placeholder="Nombre titular" id="' + id + '-name" style="flex:1;min-width:120px">' +
    '<input type="number" placeholder="Total $" id="' + id + '-total" style="flex:1;min-width:100px">' +
    '<button class="btn danger sm" onclick="document.getElementById(\'' + id + '\').remove()">x</button>';
  list.appendChild(div);
}

function saveManual() {
  const cardId = document.getElementById('m-card').value;
  const month  = document.getElementById('m-month').value;
  if (!cardId || !month) { alert('Selecciona tarjeta y mes'); return; }
  const card = db.cards.find(c => c.id === cardId) || { name: 'Tarjeta' };
  const exts = [];
  document.querySelectorAll('[id^="mext"][id$="-name"]').forEach(inp => {
    const base = inp.id.replace('-name', '');
    const tot = document.getElementById(base + '-total');
    if (inp.value.trim()) exts.push({ holder: inp.value.trim(), total: Number(tot ? tot.value : 0), items: [] });
  });
  db.summaries.push({
    id: 's' + Date.now(), cardId, cardName: card.name, uploadedAt: new Date().toISOString(), month,
    vencimiento: document.getElementById('m-venc').value,
    minimo: Number(document.getElementById('m-min').value || 0),
    total: Number(document.getElementById('m-total').value || 0),
    totalUSD: Number(document.getElementById('m-usd').value || 0),
    ownExpenses: [], extensions: exts
  });
  saveAndSync();
  alert('Guardado correctamente');
  renderDashboard();
}


// --- Historico ---

function populateHistoricoFilters() {
  const el = document.getElementById('hf-card');
  if (!el) return;
  el.innerHTML = '<option value="">Todas las tarjetas</option>' +
    db.cards.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
}

function renderHistorico() {
  var cardFilter = (document.getElementById('hf-card') || {}).value || '';
  var fromFilter = (document.getElementById('hf-from') || {}).value || '';
  var toFilter   = (document.getElementById('hf-to')   || {}).value || '';
  var items = db.summaries.slice().sort(function(a, b) {
    var da = a.uploadedAt || a.id || '';
    var db2 = b.uploadedAt || b.id || '';
    return db2 < da ? -1 : db2 > da ? 1 : 0;
  });
  if (cardFilter) items = items.filter(function(s){ return s.cardId === cardFilter; });
  if (fromFilter) items = items.filter(function(s){ return s.month >= fromFilter; });
  if (toFilter)   items = items.filter(function(s){ return s.month <= toFilter; });
  var el = document.getElementById('historico-list');
  if (!items.length) { el.innerHTML = '<div class="empty">Sin resumenes</div>'; return; }

  var rows = '';
  for (var i = 0; i < items.length; i++) {
    var s = items[i];
    var card = db.cards.find(function(c){ return c.id === s.cardId; }) || { name: s.cardName || 'Tarjeta' };
    var dt = s.uploadedAt ? new Date(s.uploadedAt) : null;
    var dateStr = dt ? dt.toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric' }) : '-';
    var timeStr = dt ? dt.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }) : '';
    var expenses = s.ownExpenses || [];
    var extensions = s.extensions || [];
    var sid = s.id;

    var expRows = '';
    for (var j = 0; j < expenses.length; j++) {
      var e = expenses[j];
      var cuotasTag = (e.cuotas && e.cuotas > 1)
        ? ' <span class="badge blue" style="font-size:10px">' + (e.cuotaActual || '?') + '/' + e.cuotas + ' cuotas</span>'
        : '';
      expRows += '<tr><td>' + (e.desc || '-') + cuotasTag + '</td>' +
        '<td><span class="tag">' + (e.category || '-') + '</span></td>' +
        '<td class="num" style="text-align:right">$' + fmt(e.amount || 0) + '</td></tr>';
    }

    var extHtml = '';
    if (extensions.length) {
      extHtml = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">' +
        '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px">Extensiones</div>';
      for (var k = 0; k < extensions.length; k++) {
        var ext = extensions[k];
        extHtml += '<div style="margin-bottom:8px"><b>' + ext.holder + '</b> &mdash; $' + fmt(ext.total || 0);
        var extItems = ext.items || [];
        if (extItems.length) {
          extHtml += '<table style="width:100%;font-size:12px;margin-top:4px"><tbody>';
          for (var m = 0; m < extItems.length; m++) {
            var ei = extItems[m];
            var eiCuotas = (ei.cuotas && ei.cuotas > 1)
              ? ' <span class="badge blue" style="font-size:10px">' + (ei.cuotaActual || '?') + '/' + ei.cuotas + '</span>' : '';
            var eiCurr = (ei.currency === 'USD') ? 'U$S ' : '$';
            extHtml += '<tr><td>' + (ei.desc || '-') + eiCuotas + '</td><td class="num" style="text-align:right">' + eiCurr + fmt(ei.amount || 0) + '</td></tr>';
          }
          extHtml += '</tbody></table>';
        }
        extHtml += '</div>';
      }
      extHtml += '</div>';
    }

    var detailContent = expenses.length
      ? '<table style="width:100%;font-size:12px"><thead><tr><th>Descripcion</th><th>Categoria</th><th style="text-align:right">Monto</th></tr></thead><tbody>' + expRows + '</tbody></table>' + extHtml
      : '<div style="font-size:12px;color:var(--text2)">Sin detalle guardado</div>' + extHtml;

    rows += '<tr style="cursor:pointer" onclick="toggleHistoricoRow(\'' + sid + '\', this)">' +
      '<td style="color:var(--text2);font-size:12px" id="arr-' + sid + '">&#9654;</td>' +
      '<td><b>' + card.name + '</b></td>' +
      '<td><span class="tag">' + s.month + '</span></td>' +
      '<td style="color:var(--text2);font-size:12px">' + dateStr + (timeStr ? ' ' + timeStr : '') + '</td>' +
      '<td class="num" style="text-align:right">$' + fmt(s.total || 0) + '</td>' +
      '<td class="num" style="text-align:right">' + (Number(s.totalUSD) > 0 ? 'U$S ' + fmt(s.totalUSD) : '-') + '</td>' +
      '<td><button class="btn danger sm" onclick="event.stopPropagation();delSummary(\'' + sid + '\')">x</button></td>' +
    '</tr>' +
    '<tr id="det-' + sid + '" style="display:none"><td colspan="7" style="padding:0">' +
      '<div style="background:var(--surface2);padding:12px 16px;border-bottom:1px solid var(--border)">' +
        detailContent +
      '</div>' +
    '</td></tr>';
  }

  el.innerHTML = '<div class="table-wrap"><table style="width:100%">' +
    '<thead><tr>' +
      '<th style="width:24px"></th>' +
      '<th>Tarjeta</th><th>Mes</th><th>Subido</th>' +
      '<th style="text-align:right">Total $</th>' +
      '<th style="text-align:right">Total U$S</th>' +
      '<th></th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}
function toggleHistoricoRow(id, tr) {
  const det = document.getElementById('det-' + id);
  const arr = document.getElementById('arr-' + id);
  if (!det) return;
  const open = det.style.display !== 'none';
  det.style.display = open ? 'none' : 'table-row';
  if (arr) arr.textContent = open ? '▶' : '▼';
}

function delSummary(id) {
  if (!confirm('Eliminar este resumen? Esta accion no se puede deshacer.')) return;
  db.summaries = db.summaries.filter(s => s.id !== id);
  saveAndSync(); renderHistorico();
}

// --- Config ---

function updateConfigFields() {
  const el1 = document.getElementById('cfg-client-id2');
  const el2 = document.getElementById('cfg-api-key2');
  const el3 = document.getElementById('cfg-sheet-id2');
  const el4 = document.getElementById('fx-rate');
  const el5 = document.getElementById('sheets-status');
  if (el1) el1.value = cfg.clientId || '';
  if (el2) el2.value = cfg.apiKey   || '';
  if (el3) el3.value = cfg.sheetId  || '';
  if (el4) el4.value = db.fxRate || 1200;
  if (el5) {
    el5.textContent = isAuthorized ? 'conectado' : 'desconectado';
    el5.className = 'sheet-status ' + (isAuthorized ? 'ok' : 'err');
  }
}

function saveConfig() {
  cfg.clientId = document.getElementById('cfg-client-id2').value.trim();
  cfg.apiKey   = document.getElementById('cfg-api-key2').value.trim();
  cfg.sheetId  = document.getElementById('cfg-sheet-id2').value.trim();
  saveCfg();
  alert('Configuracion guardada. Recarga la pagina para reconectar.');
}

function saveFX() { db.fxRate = Number(document.getElementById('fx-rate').value) || 1200; saveAndSync(); }

function exportToJSON() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tarjetas_backup_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
}

function loadJSON(inp) {
  const f = inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try { db = JSON.parse(e.target.result); saveAndSync(); renderDashboard(); alert('Importado correctamente'); }
    catch { alert('Error al leer el archivo'); }
  };
  r.readAsText(f);
}

function clearAll() {
  if (!confirm('Borrar TODOS los datos? Esta accion no se puede deshacer.')) return;
  db = {
    cards: [], extHolders: [], summaries: [], gastos: [], gastosTerceros: [],
    categories: ['Supermercado','Restaurantes / Comida','Nafta / Transporte','Servicios','Salud','Ropa / Indumentaria','Entretenimiento','Viajes','Otros'],
    fxRate: 1200
  };
  saveAndSync(); renderDashboard();
}

// --- Boot ---

loadCfg();
if (cfg.clientId && cfg.apiKey && cfg.sheetId) {
  // Config guardada: lanzar app directamente sin mostrar pantalla de login
  useSheets = true;
  document.addEventListener('DOMContentLoaded', function() {
    launchApp();
  });
} else {
  // Sin config: mostrar pantalla de login con campos vacios
  document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('cfg-client-id').value = '';
    document.getElementById('cfg-api-key').value   = '';
    document.getElementById('cfg-sheet-id').value  = '';
  });
}
