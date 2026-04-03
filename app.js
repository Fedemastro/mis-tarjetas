// app.js - logica principal de la app

const PROXY_URL = 'https://claudeworker.fedemusic2008.workers.dev';
// Token secreto — tiene que coincidir con AUTH_TOKEN en Cloudflare
const AUTH_TOKEN = 'REEMPLAZA_CON_TU_TOKEN_SECRETO';

let db = {
  cards: [], extHolders: [], summaries: [],
  gastos: [], gastosTerceros: [],
  categories: ['Supermercado','Restaurantes / Comida','Nafta / Transporte','Servicios','Salud','Ropa / Indumentaria','Entretenimiento','Viajes','Otros'],
  fxRate: 1200,
  payments: {}
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
  if (!db.payments) db.payments = {};
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

function cardLogo(type) {
  if (!type) return '<div style="width:44px;height:28px;background:var(--bg);border-radius:4px;border:1px solid var(--border)"></div>';
  var t = (type || '').toLowerCase();
  if (t === 'visa') return '<svg width="44" height="28" viewBox="0 0 44 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:4px"><rect width="44" height="28" fill="#1A1F71"/><text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-size="11" font-family="Arial" font-weight="700" font-style="italic" letter-spacing="1">VISA</text></svg>';
  if (t === 'mastercard') return '<svg width="44" height="28" viewBox="0 0 44 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:4px"><rect width="44" height="28" fill="#252525"/><circle cx="17" cy="14" r="8" fill="#EB001B"/><circle cx="27" cy="14" r="8" fill="#F79E1B"/><path d="M22 7.5a8 8 0 0 1 0 13 8 8 0 0 1 0-13z" fill="#FF5F00"/></svg>';
  if (t === 'american express' || t === 'amex') return '<svg width="44" height="28" viewBox="0 0 44 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:4px"><rect width="44" height="28" fill="#2E77BC"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-size="7" font-family="Arial" font-weight="700" letter-spacing=".5">AMERICAN</text><text x="50%" y="76%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-size="7" font-family="Arial" font-weight="700" letter-spacing=".5">EXPRESS</text></svg>';
  if (t === 'naranja') return '<svg width="44" height="28" viewBox="0 0 44 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:4px"><rect width="44" height="28" fill="#FF6B00"/><text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-size="8" font-family="Arial" font-weight="700">NARANJA</text></svg>';
  return '<div style="width:44px;height:28px;background:var(--purple-light);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--purple)">' + (type||'').substring(0,3).toUpperCase() + '</div>';
}


function daysUntil(dateStr) {
  if (!dateStr) return null;
  var today = new Date(); today.setHours(0,0,0,0);
  var target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

function vencColor(days) {
  if (days === null) return '';
  if (days < 0)  return 'background:var(--red-bg);border-radius:var(--radius-sm);border-left:3px solid var(--red);padding:8px 12px';
  if (days <= 3) return 'background:var(--red-bg);border-radius:var(--radius-sm);border-left:3px solid var(--red);padding:8px 12px';
  if (days <= 7) return 'background:#fef3cd;border-left:3px solid var(--amber)';
  return 'background:var(--green-bg);border-radius:var(--radius-sm);border-left:3px solid var(--green);padding:8px 12px';
}

function vencLabel(days) {
  if (days === null) return '';
  if (days < 0)  return '<span style="color:var(--red);font-size:11px;font-weight:500">Vencido hace ' + Math.abs(days) + ' día' + (Math.abs(days)!==1?'s':'') + '</span>';
  if (days === 0) return '<span style="color:var(--red);font-size:11px;font-weight:500">Vence HOY</span>';
  if (days === 1) return '<span style="color:var(--red);font-size:11px;font-weight:500">Vence mañana</span>';
  if (days <= 7)  return '<span style="color:var(--amber);font-size:11px;font-weight:500">Vence en ' + days + ' días</span>';
  return '<span style="color:var(--green);font-size:11px">Vence en ' + days + ' días</span>';
}

var _newItems = [];

function renderDashboard() {
  var now = new Date();
  var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var lbl = document.getElementById('dash-month-label');
  if (lbl) lbl.textContent = new Date(ym + '-01').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  var ms = db.summaries.filter(function(s){ return s.month === ym; });
  var totalARS = 0, totalMin = 0, totalUSD = 0, nextVenc = null, nextDays = null;
  ms.forEach(function(s) {
    totalARS += Number(s.total || 0);
    totalMin += Number(s.minimo || 0);
    totalUSD += Number(s.totalUSD || 0);
    if (s.vencimiento) {
      var d = new Date(s.vencimiento + 'T00:00:00');
      if (!nextVenc || d < nextVenc) { nextVenc = d; nextDays = daysUntil(s.vencimiento); }
    }
  });
  document.getElementById('d-total').textContent = '$' + fmt(totalARS);
  document.getElementById('d-min').textContent = '$' + fmt(totalMin);
  document.getElementById('d-usd').textContent = 'U$S ' + fmt(totalUSD);
  var vencEl = document.getElementById('d-venc');
  if (nextVenc) {
    vencEl.innerHTML = nextVenc.toLocaleDateString('es-AR', { day:'2-digit', month:'short' }) +
      '<div style="font-size:10px;margin-top:2px">' + (nextDays !== null ? vencLabel(nextDays).replace(/<[^>]+>/g,'') : '') + '</div>';
    vencEl.style.color = nextDays !== null && nextDays <= 3 ? 'var(--red)' : nextDays <= 7 ? 'var(--amber)' : '';
  } else {
    vencEl.textContent = '-';
  }

  // Cards with payment input
  var dc = document.getElementById('dash-cards');
  if (!ms.length) {
    dc.innerHTML = '<div class="empty">Sin datos para este mes</div>';
  }

  // Extensions — from summaries + from manual gastosTerceros
  var de = document.getElementById('dash-ext');
  var extData = {};
  // From card summaries (extension sections)
  ms.forEach(function(s) {
    (s.extensions||[]).forEach(function(e) {
      if (!extData[e.holder]) extData[e.holder] = { fromSummary: 0, fromManual: 0 };
      extData[e.holder].fromSummary += Number(e.total||0);
    });
  });
  // From manual gastosTerceros for this month
  var ym2 = ym;
  (db.gastosTerceros||[]).filter(function(g){ return g.month === ym2; }).forEach(function(g) {
    if (!extData[g.holder]) extData[g.holder] = { fromSummary: 0, fromManual: 0 };
    extData[g.holder].fromManual += Number(g.amount||0);
  });
  var extKeys = Object.keys(extData);
  var extBtn = document.getElementById('dash-ext-btn');
  if (extBtn) extBtn.textContent = extKeys.length ? ('Mostrar (' + extKeys.length + ')') : 'Mostrar';
  if (!extKeys.length) {
    de.innerHTML = '<div class="empty">Sin extensiones este mes</div>';
  } else {
    de.innerHTML = extKeys.map(function(k) {
      var d = extData[k];
      var total = d.fromSummary + d.fromManual;
      var detail = [];
      if (d.fromSummary > 0) detail.push('Resumen: $' + fmt(d.fromSummary));
      if (d.fromManual > 0) detail.push('Manual: $' + fmt(d.fromManual));
      return '<div class="ext-row"><div><span style="font-weight:500">' + k + '</span>' +
        (detail.length > 1 ? '<div style="font-size:10px;color:var(--text2);margin-top:1px">' + detail.join(' &nbsp;+&nbsp; ') + '</div>' : '') +
        '</div><span class="badge blue" style="font-family:var(--mono)">$' + fmt(total) + '</span></div>';
    }).join('');
  }

  // New expenses — build list, keep collapsed
  var prevYM = getPrevMonth(ym);
  var prevDescs = {};
  db.summaries.filter(function(s){ return s.month === prevYM; }).forEach(function(s) {
    (s.ownExpenses||[]).forEach(function(e){ prevDescs[e.desc.toLowerCase().trim()] = true; });
  });
  _newItems = [];
  ms.forEach(function(s) {
    (s.ownExpenses||[]).forEach(function(e) {
      if (!prevDescs[e.desc.toLowerCase().trim()]) {
        _newItems.push({ desc: e.desc, amount: e.amount, currency: e.currency, card: s.cardName||'', cardId: s.cardId });
      }
    });
  });

  // Populate card filter for new expenses
  var nfc = document.getElementById('new-filter-card');
  if (nfc) {
    var cardOpts = '<option value="">Todas las tarjetas</option>';
    var seenCards = {};
    _newItems.forEach(function(i){ if (!seenCards[i.cardId]) { seenCards[i.cardId]=true; cardOpts += '<option value="'+i.cardId+'">'+i.card+'</option>'; } });
    nfc.innerHTML = cardOpts;
  }

  renderNewExpenses(_newItems);
  updateNewToggleBtn();
}

function toggleDashExt() {
  var el = document.getElementById('dash-ext');
  var btn = document.getElementById('dash-ext-btn');
  var col = document.getElementById('dash-two-col');
  if (!el) return;
  var visible = el.style.display !== 'none';
  el.style.display = visible ? 'none' : 'block';
  if (btn) btn.textContent = visible ? btn.textContent.replace('Ocultar','Mostrar') : 'Ocultar';
  // Expand to two columns when extensions visible, single when hidden
  if (col) col.style.gridTemplateColumns = visible ? '1fr' : '1fr 1fr';
}

function updateNewToggleBtn() {
  var btn = document.getElementById('new-toggle-btn');
  var el = document.getElementById('dash-new');
  if (!btn || !el) return;
  var visible = el.style.display !== 'none';
  btn.textContent = visible ? 'Ocultar' : 'Mostrar (' + _newItems.length + ')';
}

function toggleNewExpenses() {
  var el = document.getElementById('dash-new');
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  updateNewToggleBtn();
}

function filterNewExpenses() {
  var cardFilter = (document.getElementById('new-filter-card')||{}).value || '';
  var filtered = cardFilter ? _newItems.filter(function(i){ return i.cardId === cardFilter; }) : _newItems;
  renderNewExpenses(filtered);
}

function renderNewExpenses(items) {
  var el = document.getElementById('dash-new');
  if (!items.length) {
    el.innerHTML = '<div class="empty">Sin gastos nuevos vs mes anterior</div>';
    return;
  }
  el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Descripción</th><th>Tarjeta</th><th>Monto</th></tr></thead><tbody>' +
    items.slice(0, 20).map(function(i) {
      var sym = i.currency === 'USD' ? 'U$S ' : '$';
      return '<tr><td>' + i.desc + ' <span class="badge new" style="font-size:10px">nuevo</span></td>' +
        '<td style="color:var(--text2)">' + i.card + '</td>' +
        '<td class="num">' + sym + fmt(i.amount) + '</td></tr>';
    }).join('') +
    '</tbody></table></div>';
}

// --- Payments ---

function savePayment(summaryId) {
  if (!db.payments) db.payments = {};
  var ars = document.getElementById('pay-ars-' + summaryId);
  var usd = document.getElementById('pay-usd-' + summaryId);
  var full = document.getElementById('pay-full-' + summaryId);
  db.payments[summaryId] = {
    ars: ars ? ars.value : '',
    usd: usd ? usd.value : '',
    full: full ? full.checked : false
  };
  saveAndSync();
}

function toggleFullPayment(summaryId, totalARS, totalUSD) {
  var full = document.getElementById('pay-full-' + summaryId);
  var arsEl = document.getElementById('pay-ars-' + summaryId);
  var usdEl = document.getElementById('pay-usd-' + summaryId);
  if (full && full.checked) {
    if (arsEl) arsEl.value = totalARS;
    if (usdEl) usdEl.value = Number(totalUSD) > 0 ? totalUSD : '';
  } else {
    if (arsEl) arsEl.value = '';
    if (usdEl) usdEl.value = '';
  }
  savePayment(summaryId);
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
      '<div class="pb"><div class="pf" style="width:' + pct + '%"></div></div>' +
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

function toBase64(bytes) {
  var binary = '';
  var chunkSize = 8192;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function decryptPDF(arrayBuf, password) {
  var bytes = new Uint8Array(arrayBuf);
  var binary = '';
  var chunkSize = 8192;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  var b64 = btoa(binary);

  var resp = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Action': 'decrypt-pdf', 'X-Auth-Token': AUTH_TOKEN },
    body: JSON.stringify({ pdfBase64: b64, password: password })
  });

  var data = await resp.json();

  if (data.error === 'wrong_password') {
    throw new Error('wrong_password');
  }
  if (data.error) {
    throw new Error(data.message || data.error);
  }

  // Return decrypted PDF as base64 to send to Claude as PDF document
  return { type: 'pdf', pdfBase64: data.pdfBase64 };
}

async function handleFile(inp) {
  var f = inp.files[0]; if (!f) return;
  inp.value = '';
  uploadedFileType = f.type;
  var zone = document.getElementById('drop-zone');
  zone.innerHTML = '<div class="icon">v</div><div>' + f.name + '</div><div class="hint">Procesando...</div>';

  if (f.type !== 'application/pdf') {
    var r = new FileReader();
    r.onload = function(e) {
      uploadedFileData = e.target.result.split(',')[1];
      zone.innerHTML = '<div class="icon">v</div><div>' + f.name + '</div><div class="hint">Listo para extraer</div>';
    };
    r.readAsDataURL(f);
    return;
  }

  var arrayBuf = await f.arrayBuffer();
  var bytes = new Uint8Array(arrayBuf);

  // Check encryption: scan first 8KB for /Encrypt keyword
  var header = '';
  for (var i = 0; i < Math.min(bytes.length, 8192); i++) {
    header += String.fromCharCode(bytes[i]);
  }
  var isEncrypted = header.indexOf('/Encrypt') !== -1;

  if (!isEncrypted) {
    uploadedFileData = toBase64(bytes);
    uploadedFileType = 'application/pdf';
    zone.innerHTML = '<div class="icon">v</div><div>' + f.name + '</div><div class="hint">Listo para extraer</div>';
    return;
  }

  // Encrypted PDF
  zone.innerHTML = '<div class="icon">v</div><div>' + f.name + '</div><div class="hint">PDF protegido con contraseña</div>';
  var pwd = prompt('Este PDF tiene contraseña. Ingresala para continuar:');
  if (pwd === null) { resetDropZone('Cancelado'); return; }

  zone.innerHTML = '<div class="icon">v</div><div>' + f.name + '</div><div class="hint">Desencriptando...</div>';

  try {
    var result = await decryptPDF(arrayBuf, pwd);
    uploadedFileData = result.pdfBase64;
    uploadedFileType = 'application/pdf';
    window._decryptedPages = null;
    zone.innerHTML = '<div class="icon">v</div><div>' + f.name + ' (desencriptado)</div><div class="hint">Listo para extraer</div>';
  } catch(e) {
    var errMsg = e.message || '';
    if (errMsg === 'wrong_password' || errMsg.toLowerCase().indexOf('password') !== -1) {
      resetDropZone('Contraseña incorrecta. Tocá para intentar de nuevo.');
    } else {
      resetDropZone('Error al desencriptar: ' + errMsg);
    }
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
    var pages = (window._allPageImages && window._allPageImages.length > 0)
      ? window._allPageImages.slice(0, 5)
      : [uploadedFileData];
    for (var pi = 0; pi < pages.length; pi++) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: pages[pi] } });
    }
    window._allPageImages = null;
  } else {
    userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: uploadedFileData } });
  }

  const prompt = 'Analiza este resumen de tarjeta de credito argentina. Responde SOLO con JSON minificado (sin espacios, sin markdown, sin backticks). Formato exacto:\n' +
    '{"cardName":"...","vencimiento":"YYYY-MM-DD","minimo":0,"total":0,"totalUSD":0,"ownExpenses":[{"d":"desc","a":0,"c":false,"cu":"ARS","cat":"categoria","dt":"YYYY-MM-DD","q":null,"qi":null}],"extensions":[{"holder":"...","total":0,"totalUSD":0,"items":[{"d":"desc","a":0,"cu":"ARS","q":null,"qi":null}]}]}\n' +
    'Campos: d=descripcion(max25chars), a=amount(numero), c=isCredit(true/false), cu=currency(ARS/USD), cat=categoria, dt=fecha, q=cuotas totales(null si no), qi=cuota actual(null si no).\n' +
    'REGLAS:\n' +
    '1. Incluir TODOS los movimientos sin excepcion.\n' +
    '2. c=true para pagos/devoluciones (montos negativos en el resumen). c=false para consumos.\n' +
    '3. a siempre positivo.\n' +
    '4. cu=USD si figura en columna DOLARES, sino ARS.\n' +
    '5. Para cuotas buscar patron C.03/12: q=12, qi=3.\n' +
    '6. cat debe ser una de: Supermercado/Restaurantes/Transporte/Servicios/Salud/Ropa/Entretenimiento/Viajes/Otros.\n' +
    '7. minimo y total son PAGO MINIMO y SALDO ACTUAL del resumen.\n' +
    '8. Extensions tienen su propia seccion con nombre del titular.\n' +
    '9. JSON minificado, sin saltos de linea, sin espacios innecesarios.';

  userContent.push({ type: 'text', text: prompt });

  try {
    const resp = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': AUTH_TOKEN },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 8000, messages: [{ role: 'user', content: userContent }] })
    });
    const data = await resp.json();
    if (data.error || !data.content) {
      out.textContent = 'Error de API:\n' + JSON.stringify(data, null, 2);
      btn.disabled = false;
      return;
    }
    const text = data.content.map(i => i.text || '').join('');
    // Strip markdown code fences, leading/trailing whitespace, find first { to last }
    var clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    var firstBrace = clean.indexOf('{');
    var lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) clean = clean.slice(firstBrace, lastBrace + 1);
    // Fix Argentine number format: replace "105.923,00" with "105923.00"
    // Only inside JSON number values (after : and in arrays)
    clean = clean.replace(/:\s*(-?)(\d{1,3}(?:\.\d{3})*),(\d{2})(?=[,\}\]])/g, function(m, sign, int, dec) {
      return ': ' + sign + int.replace(/\./g, '') + '.' + dec;
    });
    // Also fix numbers without thousands separator but with comma decimal
    clean = clean.replace(/:\s*(-?\d+),(\d{2})(?=[,\}\]])/g, ': $1.$2');
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
  // Map compact keys to full keys if needed
  function mapExpense(e) {
    return {
      desc: e.desc || e.d || '',
      amount: Number(e.amount || e.a || 0),
      isCredit: e.isCredit !== undefined ? e.isCredit : (e.c || false),
      currency: e.currency || e.cu || 'ARS',
      category: e.category || e.cat || 'Otros',
      date: e.date || e.dt || '',
      cuotas: e.cuotas !== undefined ? e.cuotas : (e.q !== undefined ? e.q : null),
      cuotaActual: e.cuotaActual !== undefined ? e.cuotaActual : (e.qi !== undefined ? e.qi : null)
    };
  }
  function mapExtension(ext) {
    return {
      holder: ext.holder || '',
      total: Number(ext.total || 0),
      totalUSD: Number(ext.totalUSD || 0),
      items: (ext.items || []).map(mapExpense)
    };
  }
  db.summaries.push({
    id: 's' + Date.now(), cardId, uploadedAt: new Date().toISOString(),
    cardName: card ? card.name : (p.cardName || 'Tarjeta'),
    month, vencimiento: p.vencimiento || '',
    minimo: Number(p.minimo || 0),
    total: Number(p.total || 0),
    totalUSD: Number(p.totalUSD || 0),
    ownExpenses: (p.ownExpenses || []).map(mapExpense),
    extensions: (p.extensions || []).map(mapExtension)
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
            var eiStyle = ei.isCredit ? 'color:var(--green)' : '';
            var eiSign = ei.isCredit ? '-' : '';
            extHtml += '<tr><td>' + (ei.desc || '-') + eiCuotas + '</td><td class="num" style="text-align:right;' + eiStyle + '">' + eiSign + eiCurr + fmt(ei.amount || 0) + '</td></tr>';
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
