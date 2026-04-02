// app.js — logica principal de la app

// URL del proxy Cloudflare Workers — actualizá esto despues de desplegar el worker
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

// ─── Storage ───────────────────────────────────────────────────────────────

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

// ─── Sync helpers ──────────────────────────────────────────────────────────

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
  if (!useSheets || !isAuthorized) { alert('Conectá Google Sheets primero'); return; }
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

// ─── Auth / init ───────────────────────────────────────────────────────────

function initApp() {
  const clientId = document.getElementById('cfg-client-id').value.trim() || cfg.clientId;
  const apiKey   = document.getElementById('cfg-api-key').value.trim()   || cfg.apiKey;
  const sheetId  = document.getElementById('cfg-sheet-id').value.trim()  || cfg.sheetId;
  if (!clientId || !apiKey || !sheetId) { alert('Completá todos los campos'); return; }
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

// ─── Navigation ────────────────────────────────────────────────────────────

let currentSection = 'dashboard';
function nav(btn, sec) {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + sec).classList.add('active');
  currentSection = sec;
  if (sec === 'dashboard')    renderDashboard();
  if (sec === 'tarjetas')     renderCards();
  if (sec === 'extensiones') { renderExtHolders(); renderExtSummary(); }
  if (sec === 'gastos')      { populateGastoCats(); populateGastoTerceroSelects(); renderGastos(); renderGastosTerceros(); }
  if (sec === 'categorias')  { renderCats(); renderCatSummary(); }
  if (sec === 'config')       updateConfigFields();
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

// ─── Formatters ────────────────────────────────────────────────────────────

function fmt(n) { return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtDate(d) { if (!d) return '—'; const dt = new Date(d + (d.length === 10 ? 'T00:00:00' : '')); return dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }); }
function getPrevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
}

// ─── Dashboard ────────────────────────────────────────────────────────────

function renderDashboard() {
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('dash-month-label').textContent = new Date(ym + '-01').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
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
  document.getElementById('d-venc').textContent = nextVenc ? nextVenc.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : '—';

  // Cards
  const dc = document.getElementById('dash-cards');
  if (!ms.length) { dc.innerHTML = '<div class="empty">Sin datos para este mes</div>'; }
  else {
    dc.innerHTML = ms.map(s => {
      const card = db.cards.find(c => c.id === s.cardId) || { name: s.cardName || 'Tarjeta', autoDebit: 'no' };
      const extra = Number(s.total || 0) - Number(s.minimo || 0);
      return `<div class="card-summary-item">
        <div>
          <div style="font-weight:500;font-size:13px;margin-bottom:3px">${card.name}</div>
          <div style="font-size:11px;color:var(--text2)">Vence: ${fmtDate(s.vencimiento)} &nbsp;·&nbsp; Mín: $${fmt(s.minimo || 0)}</div>
          ${card.autoDebit === 'yes' && extra > 0 ? `<div style="font-size:11px;color:var(--amber);margin-top:2px">Extra sobre mínimo: $${fmt(extra)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--mono);font-size:14px;font-weight:500">$${fmt(s.total || 0)}</div>
          ${s.totalUSD > 0 ? `<div style="font-size:11px;color:var(--text2)">U$S ${fmt(s.totalUSD)}</div>` : ''}
          <span class="badge ${card.autoDebit === 'yes' ? 'amber' : 'blue'}" style="margin-top:4px;display:inline-block">${card.autoDebit === 'yes' ? 'débito auto' : 'manual'}</span>
        </div>
      </div>`;
    }).join('');
  }

  // Extensions
  const de = document.getElementById('dash-ext');
  let extData = {};
  ms.forEach(s => (s.extensions || []).forEach(e => {
    if (!extData[e.holder]) extData[e.holder] = 0;
    extData[e.holder] += Number(e.total || 0);
  }));
  const extKeys = Object.keys(extData);
  if (!extKeys.length) { de.innerHTML = '<div class="empty">Sin extensiones este mes</div>'; }
  else {
    de.innerHTML = extKeys.map(k => `<div class="ext-row"><span style="font-weight:500">${k}</span><span class="badge blue" style="font-family:var(--mono)">$${fmt(extData[k])}</span></div>`).join('');
  }

  // New expenses
  const dn = document.getElementById('dash-new');
  const prevYM = getPrevMonth(ym);
  const prevDescs = new Set();
  db.summaries.filter(s => s.month === prevYM).forEach(s => (s.ownExpenses || []).forEach(e => prevDescs.add(e.desc.toLowerCase().trim())));
  const newItems = [];
  ms.forEach(s => (s.ownExpenses || []).forEach(e => { if (!prevDescs.has(e.desc.toLowerCase().trim())) newItems.push({ desc: e.desc, amount: e.amount, card: s.cardName || '' }); }));
  if (!newItems.length) { dn.innerHTML = '<div class="empty">Sin gastos nuevos vs mes anterior</div>'; }
  else {
    dn.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Descripción</th><th>Tarjeta</th><th>Monto</th></tr></thead><tbody>
    ${newItems.slice(0, 10).map(i => `<tr><td>${i.desc} <span class="badge new">nuevo</span></td><td style="color:var(--text2)">${i.card}</td><td class="num">$${fmt(i.amount)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
}

// ─── Cards ────────────────────────────────────────────────────────────────

function addCard() {
  const name = document.getElementById('tc-name').value.trim();
  if (!name) return;
  db.cards.push({ id: 'c' + Date.now(), name, bank: document.getElementById('tc-bank').value.trim(), autoDebit: document.getElementById('tc-auto').value });
  saveAndSync(); renderCards(); populateCardSelects();
  document.getElementById('tc-name').value = ''; document.getElementById('tc-bank').value = '';
}

function renderCards() {
  const el = document.getElementById('cards-list');
  if (!db.cards.length) { el.innerHTML = '<div class="empty">Sin tarjetas</div>'; return; }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Banco</th><th>Déb. auto</th><th></th></tr></thead><tbody>
  ${db.cards.map(c => `<tr><td><b>${c.name}</b></td><td>${c.bank || '—'}</td><td><span class="badge ${c.autoDebit === 'yes' ? 'amber' : 'green'}">${c.autoDebit === 'yes' ? 'sí' : 'no'}</span></td><td><button class="btn danger sm" onclick="delCard('${c.id}')">×</button></td></tr>`).join('')}
  </tbody></table></div>`;
}

function delCard(id) { if (!confirm('¿Eliminar tarjeta?')) return; db.cards = db.cards.filter(c => c.id !== id); saveAndSync(); renderCards(); populateCardSelects(); }

function populateCardSelects() {
  const opts = '<option value="">Seleccionar...</option>' + db.cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  ['upload-card','m-card','gt-card'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = opts; });
}

// ─── Extension holders ────────────────────────────────────────────────────

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
  el.innerHTML = db.extHolders.map(h => `<div class="ext-row"><span style="font-weight:500">${h.name}</span><button class="btn danger sm" onclick="delHolder('${h.id}')">×</button></div>`).join('');
}

function delHolder(id) { db.extHolders = db.extHolders.filter(h => h.id !== id); saveAndSync(); renderExtHolders(); }

function renderExtSummary() {
  const ym = document.getElementById('ext-filter-month').value;
  const el = document.getElementById('ext-summary');
  if (!ym) { el.innerHTML = '<div class="empty">Seleccioná un mes</div>'; return; }
  const ms = db.summaries.filter(s => s.month === ym);
  let extData = {};
  ms.forEach(s => (s.extensions || []).forEach(e => {
    if (!extData[e.holder]) extData[e.holder] = { items: [], total: 0 };
    extData[e.holder].total += Number(e.total || 0);
    (e.items || []).forEach(i => extData[e.holder].items.push({ ...i, card: s.cardName }));
  }));
  const keys = Object.keys(extData);
  if (!keys.length) { el.innerHTML = '<div class="empty">Sin extensiones para este mes</div>'; return; }
  el.innerHTML = keys.map(k => {
    const rows = extData[k].items.length ? extData[k].items.map(i => `<tr><td>${i.desc || '—'}</td><td style="color:var(--text2)">${i.card || '—'}</td><td class="num">$${fmt(i.amount || 0)}</td></tr>`).join('')
      : `<tr><td colspan="3" style="color:var(--text2)">Total: $${fmt(extData[k].total)}</td></tr>`;
    return `<div style="margin-bottom:16px"><div style="font-weight:500;margin-bottom:8px">${k}</div>
    <div class="table-wrap"><table><thead><tr><th>Descripción</th><th>Tarjeta</th><th>Monto</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');
}

// ─── Gastos extra ─────────────────────────────────────────────────────────

function populateGastoCats() {
  const opts = db.categories.map(c => `<option>${c}</option>`).join('');
  const filterOpts = '<option value="">Todas las categorías</option>' + opts;
  const ge = document.getElementById('ge-cat'); if (ge) ge.innerHTML = opts;
  const gf = document.getElementById('gf-cat'); if (gf) gf.innerHTML = filterOpts;
}

function addGasto() {
  const desc = document.getElementById('ge-desc').value.trim();
  const amount = document.getElementById('ge-amount').value;
  if (!desc || !amount) return;
  db.gastos.push({ id: 'g' + Date.now(), desc, amount: Number(amount), cat: document.getElementById('ge-cat').value, date: document.getElementById('ge-date').value, currency: document.getElementById('ge-curr').value, month: document.getElementById('ge-month').value });
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
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Descripción</th><th>Categoría</th><th>Fecha</th><th>Monto</th><th></th></tr></thead><tbody>
  ${items.map(g => `<tr><td>${g.desc}</td><td><span class="tag">${g.cat || '—'}</span></td><td style="color:var(--text2)">${g.date || '—'}</td><td class="num">${g.currency === 'USD' ? 'U$S' : '$'}${fmt(g.amount)}</td><td><button class="btn danger sm" onclick="delGasto('${g.id}')">×</button></td></tr>`).join('')}
  </tbody></table></div>
  <div style="text-align:right;padding:10px 0 0;font-family:var(--mono);font-size:13px;font-weight:500">Total: $${fmt(total)}</div>`;
}

function delGasto(id) { db.gastos = db.gastos.filter(g => g.id !== id); saveAndSync(); renderGastos(); }

function populateGastoTerceroSelects() {
  const o = db.extHolders.map(h => `<option value="${h.name}">${h.name}</option>`).join('');
  const h = document.getElementById('gt-holder'); if (h) h.innerHTML = '<option value="">Seleccionar...</option>' + o;
  const hf = document.getElementById('gtf-holder'); if (hf) hf.innerHTML = '<option value="">Todos</option>' + o;
}

function addGastoTercero() {
  const holder = document.getElementById('gt-holder').value;
  const amount = document.getElementById('gt-amount').value;
  if (!holder || !amount) return;
  const cardId = document.getElementById('gt-card').value;
  const card = db.cards.find(c => c.id === cardId);
  db.gastosTerceros.push({ id: 't' + Date.now(), holder, desc: document.getElementById('gt-desc').value.trim(), amount: Number(amount), cardId, cardName: card ? card.name : '', date: document.getElementById('gt-date').value, month: document.getElementById('gt-month').value });
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
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Titular</th><th>Descripción</th><th>Tarjeta</th><th>Fecha</th><th>Monto</th><th></th></tr></thead><tbody>
  ${items.map(g => `<tr><td><b>${g.holder}</b></td><td>${g.desc || '—'}</td><td style="color:var(--text2)">${g.cardName || '—'}</td><td style="color:var(--text2)">${g.date || '—'}</td><td class="num">$${fmt(g.amount)}</td><td><button class="btn danger sm" onclick="delGastoT('${g.id}')">×</button></td></tr>`).join('')}
  </tbody></table></div>`;
}

function delGastoT(id) { db.gastosTerceros = db.gastosTerceros.filter(g => g.id !== id); saveAndSync(); renderGastosTerceros(); }

// ─── Categories ───────────────────────────────────────────────────────────

function addCategory() {
  const n = document.getElementById('cat-new').value.trim();
  if (!n || db.categories.includes(n)) return;
  db.categories.push(n); saveAndSync(); renderCats(); document.getElementById('cat-new').value = '';
}

function renderCats() {
  document.getElementById('cats-list').innerHTML = db.categories.map(c =>
    `<span class="tag" style="margin:4px;display:inline-flex;align-items:center;gap:4px">${c} <button style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:14px;padding:0;line-height:1" onclick="delCat('${c}')">×</button></span>`
  ).join('');
}

function delCat(c) { db.categories = db.categories.filter(x => x !== c); saveAndSync(); renderCats(); }

function renderCatSummary() {
  const ym = document.getElementById('cat-month-filter').value;
  const el = document.getElementById('cat-summary');
  if (!ym) { el.innerHTML = '<div class="empty">Seleccioná un mes</div>'; return; }
  const items = db.gastos.filter(g => g.month === ym);
  const bycat = {};
  items.forEach(g => { const k = g.cat || 'Sin categoría'; if (!bycat[k]) bycat[k] = 0; bycat[k] += Number(g.amount); });
  const keys = Object.keys(bycat);
  if (!keys.length) { el.innerHTML = '<div class="empty">Sin gastos para este mes</div>'; return; }
  const total = Object.values(bycat).reduce((a, b) => a + b, 0);
  el.innerHTML = keys.sort((a, b) => bycat[b] - bycat[a]).map(k => {
    const pct = Math.round((bycat[k] / total) * 100);
    return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:13px">${k}</span><span style="font-family:var(--mono);font-size:13px">$${fmt(bycat[k])} <span style="color:var(--text2)">(${pct}%)</span></span></div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
}

// ─── AI Extraction ────────────────────────────────────────────────────────

let uploadedFileData = null, uploadedFileType = null;

function handleFile(inp) {
  const f = inp.files[0]; if (!f) return;
  uploadedFileType = f.type;
  document.getElementById('drop-zone').innerHTML = `<div class="icon">✓</div><div>${f.name}</div><div class="hint">Listo para extraer</div>`;
  const r = new FileReader();
  r.onload = e => { uploadedFileData = e.target.result.split(',')[1]; };
  r.readAsDataURL(f);
}

async function extractWithAI() {
  if (!uploadedFileData) { alert('Primero subí un archivo'); return; }
  const out = document.getElementById('ai-output');
  const btn = document.getElementById('extract-btn');
  out.textContent = 'Extrayendo datos con IA...';
  btn.disabled = true;
  document.getElementById('confirm-btn').style.display = 'none';

  const userContent = [];
  if (uploadedFileType.startsWith('image/')) {
    userContent.push({ type: 'image', source: { type: 'base64', media_type: uploadedFileType, data: uploadedFileData } });
  } else if (uploadedFileType === 'application/pdf') {
    userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: uploadedFileData } });
  }
  userContent.push({ type: 'text', text: `Analizá este resumen de tarjeta de crédito argentina. Extraé los datos y respondé SOLO con JSON válido, sin markdown ni backticks:
{
  "cardName": "nombre de la tarjeta",
  "vencimiento": "YYYY-MM-DD",
  "minimo": número en pesos,
  "total": número en pesos,
  "totalUSD": número en dólares (0 si no hay),
  "ownExpenses": [{"desc":"descripción del comercio","amount":número,"category":"una de: Supermercado/Restaurantes / Comida/Nafta / Transporte/Servicios/Salud/Ropa / Indumentaria/Entretenimiento/Viajes/Otros","date":"YYYY-MM-DD"}],
  "extensions": [{"holder":"nombre del titular de extensión","total":número,"items":[{"desc":"comercio","amount":número}]}]
}
Los gastos propios (ownExpenses) son del titular principal. Las extensiones tienen su propia sección en el resumen con el nombre del titular. Si hay gastos en cuotas, incluí el monto de la cuota del mes.` });

  try {
    const resp = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: userContent }] })
    });
    const data = await resp.json();
    if (data.error || !data.content) { out.textContent = 'Error de API:
' + JSON.stringify(data, null, 2); btn.disabled = false; return; }
    const text = data.content.map(i => i.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    try {
      pendingExtraction = JSON.parse(clean);
      out.textContent = JSON.stringify(pendingExtraction, null, 2);
      document.getElementById('confirm-btn').style.display = 'inline-block';
    } catch { out.textContent = 'No se pudo parsear:\n' + text; }
  } catch (e) { out.textContent = 'Error: ' + e.message; }
  btn.disabled = false;
}

function confirmExtraction() {
  if (!pendingExtraction) return;
  const cardId = document.getElementById('upload-card').value;
  const month  = document.getElementById('upload-month').value;
  const card   = db.cards.find(c => c.id === cardId) || null;
  const p = pendingExtraction;
  db.summaries.push({
    id: 's' + Date.now(), cardId, cardName: card ? card.name : p.cardName || 'Tarjeta',
    month, vencimiento: p.vencimiento || '', minimo: Number(p.minimo || 0),
    total: Number(p.total || 0), totalUSD: Number(p.totalUSD || 0),
    ownExpenses: p.ownExpenses || [], extensions: p.extensions || []
  });
  saveAndSync();
  pendingExtraction = null;
  document.getElementById('ai-output').textContent = '✓ Guardado correctamente.';
  document.getElementById('confirm-btn').style.display = 'none';
  renderDashboard();
}

function addManualExt() {
  const list = document.getElementById('manual-ext-list');
  const id = 'mext' + manualExtCount++;
  const div = document.createElement('div');
  div.id = id;
  div.style = 'display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap';
  div.innerHTML = `<input placeholder="Nombre titular" id="${id}-name" style="flex:1;min-width:120px"><input type="number" placeholder="Total $" id="${id}-total" style="flex:1;min-width:100px"><button class="btn danger sm" onclick="document.getElementById('${id}').remove()">×</button>`;
  list.appendChild(div);
}

function saveManual() {
  const cardId = document.getElementById('m-card').value;
  const month  = document.getElementById('m-month').value;
  if (!cardId || !month) { alert('Seleccioná tarjeta y mes'); return; }
  const card = db.cards.find(c => c.id === cardId) || { name: 'Tarjeta' };
  const exts = [];
  document.querySelectorAll('[id^="mext"][id$="-name"]').forEach(inp => {
    const base = inp.id.replace('-name', '');
    const tot = document.getElementById(base + '-total');
    if (inp.value.trim()) exts.push({ holder: inp.value.trim(), total: Number(tot ? tot.value : 0), items: [] });
  });
  db.summaries.push({ id: 's' + Date.now(), cardId, cardName: card.name, month, vencimiento: document.getElementById('m-venc').value, minimo: Number(document.getElementById('m-min').value || 0), total: Number(document.getElementById('m-total').value || 0), totalUSD: Number(document.getElementById('m-usd').value || 0), ownExpenses: [], extensions: exts });
  saveAndSync();
  alert('Guardado correctamente');
  renderDashboard();
}

// ─── Config ───────────────────────────────────────────────────────────────

function updateConfigFields() {
  document.getElementById('cfg-client-id2').value = cfg.clientId || '';
  document.getElementById('cfg-api-key2').value   = cfg.apiKey   || '';
  document.getElementById('cfg-sheet-id2').value  = cfg.sheetId  || '';
  document.getElementById('fx-rate').value = db.fxRate || 1200;
  document.getElementById('sheets-status').textContent = isAuthorized ? 'conectado' : 'desconectado';
  document.getElementById('sheets-status').className = 'sheet-status ' + (isAuthorized ? 'ok' : 'err');
}

function saveConfig() {
  cfg.clientId = document.getElementById('cfg-client-id2').value.trim();
  cfg.apiKey   = document.getElementById('cfg-api-key2').value.trim();
  cfg.sheetId  = document.getElementById('cfg-sheet-id2').value.trim();
  saveCfg();
  alert('Configuración guardada. Recargá la página para reconectar.');
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
  if (!confirm('¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) return;
  db = { cards: [], extHolders: [], summaries: [], gastos: [], gastosTerceros: [], categories: ['Supermercado','Restaurantes / Comida','Nafta / Transporte','Servicios','Salud','Ropa / Indumentaria','Entretenimiento','Viajes','Otros'], fxRate: 1200 };
  saveAndSync(); renderDashboard();
}

// ─── Boot ─────────────────────────────────────────────────────────────────

(function boot() {
  loadCfg();
  if (cfg.clientId && cfg.apiKey && cfg.sheetId) {
    // Pre-fill auth screen
    document.getElementById('cfg-client-id').value = cfg.clientId;
    document.getElementById('cfg-api-key').value   = cfg.apiKey;
    document.getElementById('cfg-sheet-id').value  = cfg.sheetId;
  }
})();

// Auto-launch if config already saved
document.addEventListener('DOMContentLoaded', () => {
  loadCfg();
  if (cfg.clientId && cfg.apiKey && cfg.sheetId) {
    // Config exists — skip auth screen and launch directly
    useSheets = true;
    launchApp();
  }
});
