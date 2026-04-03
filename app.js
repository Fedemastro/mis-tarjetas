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
  // Pull first to get remote data
  const remote = await pullFromSheets(cfg.sheetId);
  if (remote) {
    // Merge remote into local (remote wins)
    db = { ...db, ...remote };
    saveLocal();
    // Push back to update headers and any missing columns
    await pushToSheets(cfg.sheetId, db);
    // Repopulate all selects with updated data
    populateCardSelects();
    populateGastoCats();
    populateGastoTerceroSelects();
    renderCurrentSection();
    renderDashboard();
    setSyncStatus('ok', 'sincronizado');
  } else {
    // Nothing in Sheets yet — push everything
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
        populateCardSelects();
        populateGastoCats();
        populateGastoTerceroSelects();
        renderCats();
        renderCurrentSection();
        renderDashboard();
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
  ['m-month','ge-month','gt-month','upload-month','ext-filter-month','gf-month','gtf-month','cat-month-filter','dash-month-sel'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.type === 'month' && !el.value) el.value = ym;
  });
  ['ge-date','gt-date'].forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = today; });
  document.getElementById('fx-rate').value = db.fxRate || 1200;
}


function cfgTab(btn, tabId) {
  document.querySelectorAll('.cfg-tab').forEach(function(b) {
    b.style.borderBottomColor = 'transparent';
    b.style.color = 'var(--text2)';
    b.style.fontWeight = '400';
  });
  btn.style.borderBottomColor = 'var(--purple)';
  btn.style.color = 'var(--purple)';
  btn.style.fontWeight = '500';
  ['cfg-general','cfg-tarjetas','cfg-extensiones','cfg-categorias'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = id === tabId ? 'block' : 'none';
  });
  // Render relevant content
  if (tabId === 'cfg-tarjetas') renderCards();
  if (tabId === 'cfg-extensiones') { renderExtHolders(); renderExtSummary(); }
  if (tabId === 'cfg-categorias') { renderCats(); renderCatSummary(); }
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
  if (sec === 'gastos')      { populateGastoCats(); populateGastoTerceroSelects(); renderGastos(); renderGastosTerceros(); }
  if (sec === 'historico')   { populateHistoricoFilters(); renderHistorico(); }
  if (sec === 'reportes')    { initReportes(); }
  if (sec === 'config') {
    updateConfigFields();
    // Reset to General tab
    var firstTab = document.querySelector('.cfg-tab');
    if (firstTab) cfgTab(firstTab, 'cfg-general');
  }
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

var CARD_LOGOS = {
  'visa':             'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTI0IDQ4QzM3LjI1NDggNDggNDggMzcuMjU0OCA0OCAyNEM0OCAxMC43NDUyIDM3LjI1NDggMCAyNCAwQzEwLjc0NTIgMCAwIDEwLjc0NTIgMCAyNEMwIDM3LjI1NDggMTAuNzQ1MiA0OCAyNCA0OFoiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMjQuNTA1MyAyMy4wNzQxQzI0LjQ4ODkgMjQuMzc3NSAyNS42NTc1IDI1LjEwNDggMjYuNTM3OSAyNS41MzczQzI3LjQ0MjQgMjUuOTgxIDI3Ljc0NjIgMjYuMjY1NSAyNy43NDI3IDI2LjY2MjJDMjcuNzM1OCAyNy4yNjk1IDI3LjAyMTIgMjcuNTM3NSAyNi4zNTIzIDI3LjU0OEMyNS4yMTY5IDI3LjU2NTcgMjQuNTQ0IDI3LjI0ODMgMjQuMDExNiAyNi45OTcxTDIzLjk2NzYgMjYuOTc2M0wyMy41NDczIDI4Ljk1OTJDMjQuMDg4NCAyOS4yMTA2IDI1LjA5MDUgMjkuNDI5OSAyNi4xMjk2IDI5LjQzOTVDMjguNTY4NyAyOS40Mzk1IDMwLjE2NDUgMjguMjI1NyAzMC4xNzMyIDI2LjM0MzhDMzAuMTc4OCAyNC45MTUgMjkuMDA0OSAyNC4yOTM3IDI4LjA2NTUgMjMuNzk2NUMyNy40MzQ2IDIzLjQ2MjUgMjYuOTA5NSAyMy4xODQ2IDI2LjkxODUgMjIuNzU1N0MyNi45MjYzIDIyLjQzMiAyNy4yMzI2IDIyLjA4NjYgMjcuOTA0MSAyMS45OTg3QzI4LjIzNjQgMjEuOTU0NCAyOS4xNTM5IDIxLjkyMDQgMzAuMTkzOSAyMi40MDMzTDMwLjYwMjEgMjAuNDg0OUMzMC4wNDI4IDIwLjI3OTUgMjkuMzIzOSAyMC4wODI5IDI4LjQyODkgMjAuMDgyOUMyNi4xMzMxIDIwLjA4MjkgMjQuNTE4MyAyMS4zMTMxIDI0LjUwNTMgMjMuMDc0MVpNMzQuNTI0OCAyMC4yNDgyQzM0LjA3OTUgMjAuMjQ4MiAzMy43MDQgMjAuNTEwMSAzMy41MzY2IDIwLjkxMjFMMzAuMDUyMyAyOS4yOTg1SDMyLjQ4OTdMMzIuOTc0NyAyNy45NDczSDM1Ljk1MzJMMzYuMjM0NiAyOS4yOTg1SDM4LjM4MjhMMzYuNTA4MiAyMC4yNDgySDM0LjUyNDhaTTM1LjU2OTEgMjYuMDkxNUwzNC44NjU3IDIyLjY5MzFMMzMuNjQyNyAyNi4wOTE1SDM1LjU2OTFaTTIxLjU1MDEgMjAuMjQ4MkwxOS42Mjg5IDI5LjI5ODVIMjEuOTUxNUwyMy44NzE4IDIwLjI0ODJIMjEuNTUwMVpNMTUuNjk2NyAyNi40MDgyTDE4LjExNDIgMjAuMjQ4MkgyMC41NTMzTDE2Ljc5MDIgMjkuMjk4NUgxNC4zMzU2TDEyLjQ4MzUgMjIuMDc2MkMxMi4zNzEzIDIxLjYzMTYgMTIuMjczNyAyMS40NjggMTEuOTMyIDIxLjI4MUMxMS4zNzM2IDIwLjk3NDcgMTAuNDUxOCAyMC42ODg0IDkuNjQwNDkgMjAuNTExTDkuNjk1NzMgMjAuMjQ4MkgxMy42NDc4QzE0LjE1MDkgMjAuMjQ4MiAxNC42MDQxIDIwLjU4NTggMTQuNzE4OSAyMS4xNzA1TDE1LjY5NjcgMjYuNDA4MloiIGZpbGw9InVybCgjcGFpbnQwX2xpbmVhcikiLz4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhciIgeDE9IjkuNjkwNTkiIHkxPSIyMi45NjA3IiB4Mj0iMTcuODE0OCIgeTI9IjExLjUxODgiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzIyMjM1NyIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyNTRBQTUiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K',
  'mastercard':       'data:image/svg+xml;base64,PHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0ODIuNTEiIGhlaWdodD0iMzc0IiB2aWV3Qm94PSIwIDAgNDgyLjUxIDM3NCI+CiAgPHRpdGxlPm1hc3RlcmNhcmQ8L3RpdGxlPgogIDxnPgogICAgPHBhdGggZD0iTTIyMC4xMyw0MjEuNjdWMzk2LjgyYzAtOS41My01LjgtMTUuNzQtMTUuMzItMTUuNzQtNSwwLTEwLjM1LDEuNjYtMTQuMDgsNy0yLjktNC41Ni03LTctMTMuMjUtN2ExNC4wNywxNC4wNywwLDAsMC0xMiw1Ljh2LTVoLTcuODd2MzkuNzZoNy44N1YzOTguODljMC03LDQuMTQtMTAuMzUsOS45NC0xMC4zNXM5LjExLDMuNzMsOS4xMSwxMC4zNXYyMi43OGg3Ljg3VjM5OC44OWMwLTcsNC4xNC0xMC4zNSw5Ljk0LTEwLjM1czkuMTEsMy43Myw5LjExLDEwLjM1djIyLjc4Wm0xMjkuMjItMzkuMzVoLTE0LjV2LTEySDMyN3YxMmgtOC4yOHY3SDMyN1Y0MDhjMCw5LjExLDMuMzEsMTQuNSwxMy4yNSwxNC41QTIzLjE3LDIzLjE3LDAsMCwwLDM1MSw0MTkuNmwtMi40OS03YTEzLjYzLDEzLjYzLDAsMCwxLTcuNDYsMi4wN2MtNC4xNCwwLTYuMjEtMi40OS02LjIxLTYuNjNWMzg5aDE0LjV2LTYuNjNabTczLjcyLTEuMjRhMTIuMzksMTIuMzksMCwwLDAtMTAuNzcsNS44di01aC03Ljg3djM5Ljc2aDcuODdWMzk5LjMxYzAtNi42MywzLjMxLTEwLjc3LDguNy0xMC43N2EyNC4yNCwyNC4yNCwwLDAsMSw1LjM4LjgzbDIuNDktNy40NmEyOCwyOCwwLDAsMC01LjgtLjgzWm0tMTExLjQxLDQuMTRjLTQuMTQtMi45LTkuOTQtNC4xNC0xNi4xNS00LjE0LTkuOTQsMC0xNi4xNSw0LjU2LTE2LjE1LDEyLjQzLDAsNi42Myw0LjU2LDEwLjM1LDEzLjI1LDExLjZsNC4xNC40MWM0LjU2LjgzLDcuNDYsMi40OSw3LjQ2LDQuNTYsMCwyLjktMy4zMSw1LTkuNTMsNWEyMS44NCwyMS44NCwwLDAsMS0xMy4yNS00LjE0bC00LjE0LDYuMjFjNS44LDQuMTQsMTIuODQsNSwxNyw1LDExLjYsMCwxNy44MS01LjM4LDE3LjgxLTEyLjg0LDAtNy01LTEwLjM1LTEzLjY3LTExLjZsLTQuMTQtLjQxYy0zLjczLS40MS03LTEuNjYtNy00LjE0LDAtMi45LDMuMzEtNSw3Ljg3LTUsNSwwLDkuOTQsMi4wNywxMi40MywzLjMxWm0xMjAuMTEsMTYuNTdjMCwxMiw3Ljg3LDIwLjcxLDIwLjcxLDIwLjcxLDUuOCwwLDkuOTQtMS4yNCwxNC4wOC00LjU2bC00LjE0LTYuMjFhMTYuNzQsMTYuNzQsMCwwLDEtMTAuMzUsMy43M2MtNywwLTEyLjQzLTUuMzgtMTIuNDMtMTMuMjVTNDQ1LDM4OSw0NTIuMDcsMzg5YTE2Ljc0LDE2Ljc0LDAsMCwxLDEwLjM1LDMuNzNsNC4xNC02LjIxYy00LjE0LTMuMzEtOC4yOC00LjU2LTE0LjA4LTQuNTYtMTIuNDMtLjgzLTIwLjcxLDcuODctMjAuNzEsMTkuODhoMFptLTU1LjUtMjAuNzFjLTExLjYsMC0xOS40Nyw4LjI4LTE5LjQ3LDIwLjcxczguMjgsMjAuNzEsMjAuMjksMjAuNzFhMjUuMzMsMjUuMzMsMCwwLDAsMTYuMTUtNS4zOGwtNC4xNC01LjhhMTkuNzksMTkuNzksMCwwLDEtMTEuNiw0LjE0Yy01LjM4LDAtMTEuMTgtMy4zMS0xMi0xMC4zNWgyOS40MXYtMy4zMWMwLTEyLjQzLTcuNDYtMjAuNzEtMTguNjQtMjAuNzFoMFptLS40MSw3LjQ2YzUuOCwwLDkuOTQsMy43MywxMC4zNSw5Ljk0SDM2NC42OGMxLjI0LTUuOCw1LTkuOTQsMTEuMTgtOS45NFpNMjY4LjU5LDQwMS43OVYzODEuOTFoLTcuODd2NWMtMi45LTMuNzMtNy01LjgtMTIuODQtNS44LTExLjE4LDAtMTkuNDcsOC43LTE5LjQ3LDIwLjcxczguMjgsMjAuNzEsMTkuNDcsMjAuNzFjNS44LDAsOS45NC0yLjA3LDEyLjg0LTUuOHY1aDcuODdWNDAxLjc5Wm0tMzEuODksMGMwLTcuNDYsNC41Ni0xMy4yNSwxMi40My0xMy4yNSw3LjQ2LDAsMTIsNS44LDEyLDEzLjI1LDAsNy44Ny01LDEzLjI1LTEyLDEzLjI1LTcuODcuNDEtMTIuNDMtNS44LTEyLjQzLTEzLjI1Wm0zMDYuMDgtMjAuNzFhMTIuMzksMTIuMzksMCwwLDAtMTAuNzcsNS44di01aC03Ljg3djM5Ljc2SDUzMlYzOTkuMzFjMC02LjYzLDMuMzEtMTAuNzcsOC43LTEwLjc3YTI0LjI0LDI0LjI0LDAsMCwxLDUuMzguODNsMi40OS03LjQ2YTI4LDI4LDAsMCwwLTUuOC0uODNabS0zMC42NSwyMC43MVYzODEuOTFoLTcuODd2NWMtMi45LTMuNzMtNy01LjgtMTIuODQtNS44LTExLjE4LDAtMTkuNDcsOC43LTE5LjQ3LDIwLjcxczguMjgsMjAuNzEsMTkuNDcsMjAuNzFjNS44LDAsOS45NC0yLjA3LDEyLjg0LTUuOHY1aDcuODdWNDAxLjc5Wm0tMzEuODksMGMwLTcuNDYsNC41Ni0xMy4yNSwxMi40My0xMy4yNSw3LjQ2LDAsMTIsNS44LDEyLDEzLjI1LDAsNy44Ny01LDEzLjI1LTEyLDEzLjI1LTcuODcuNDEtMTIuNDMtNS44LTEyLjQzLTEzLjI1Wm0xMTEuODMsMFYzNjYuMTdoLTcuODd2MjAuNzFjLTIuOS0zLjczLTctNS44LTEyLjg0LTUuOC0xMS4xOCwwLTE5LjQ3LDguNy0xOS40NywyMC43MXM4LjI4LDIwLjcxLDE5LjQ3LDIwLjcxYzUuOCwwLDkuOTQtMi4wNywxMi44NC01Ljh2NWg3Ljg3VjQwMS43OVptLTMxLjg5LDBjMC03LjQ2LDQuNTYtMTMuMjUsMTIuNDMtMTMuMjUsNy40NiwwLDEyLDUuOCwxMiwxMy4yNSwwLDcuODctNSwxMy4yNS0xMiwxMy4yNUM1NjQuNzMsNDE1LjQ2LDU2MC4xNyw0MDkuMjUsNTYwLjE3LDQwMS43OVoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0xMzIuNzQgLTQ4LjUpIi8+CiAgICA8Zz4KICAgICAgPHJlY3QgeD0iMTY5LjgxIiB5PSIzMS44OSIgd2lkdGg9IjE0My43MiIgaGVpZ2h0PSIyMzQuNDIiIGZpbGw9IiNmZjVmMDAiLz4KICAgICAgPHBhdGggZD0iTTMxNy4wNSwxOTcuNkExNDkuNSwxNDkuNSwwLDAsMSwzNzMuNzksODAuMzlhMTQ5LjEsMTQ5LjEsMCwxLDAsMCwyMzQuNDJBMTQ5LjUsMTQ5LjUsMCwwLDEsMzE3LjA1LDE5Ny42WiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTEzMi43NCAtNDguNSkiIGZpbGw9IiNlYjAwMWIiLz4KICAgICAgPHBhdGggZD0iTTYxNS4yNiwxOTcuNmExNDguOTUsMTQ4Ljk1LDAsMCwxLTI0MSwxMTcuMjEsMTQ5LjQzLDE0OS40MywwLDAsMCwwLTIzNC40MiwxNDguOTUsMTQ4Ljk1LDAsMCwxLDI0MSwxMTcuMjFaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtMTMyLjc0IC00OC41KSIgZmlsbD0iI2Y3OWUxYiIvPgogICAgPC9nPgogIDwvZz4KPC9zdmc+Cg==',
  'american express': 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiA/PjwhRE9DVFlQRSBzdmcgIFBVQkxJQyAnLS8vVzNDLy9EVEQgU1ZHIDEuMS8vRU4nICAnaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkJz48c3ZnIGVuYWJsZS1iYWNrZ3JvdW5kPSJuZXcgMCAwIDY0IDY0IiBoZWlnaHQ9IjY0cHgiIGlkPSJMYXllcl8xIiB2ZXJzaW9uPSIxLjEiIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0cHgiIHhtbDpzcGFjZT0icHJlc2VydmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiPjxnPjxnPjxnPjxnPjxwb2x5Z29uIGZpbGw9IiMyRkFCRjciIHBvaW50cz0iNS45LDI2LjUgOC4xLDI2LjUgNywyMy43ICAgICAiLz48L2c+PGc+PHBhdGggZD0iTTMzLjIsMjQuMUMzMywyNCwzMi43LDI0LDMyLjQsMjRoLTJ2MS42aDJjMC4zLDAsMC42LDAsMC44LTAuMWMwLjItMC4xLDAuMy0wLjQsMC4zLTAuNyAgICAgIEMzMy42LDI0LjQsMzMuNCwyNC4yLDMzLjIsMjQuMXoiIGZpbGw9IiMyMjhGRTAiLz48L2c+PGc+PHBhdGggZD0iTTU0LjYsMjEuMXYxLjJMNTQsMjEuMWgtNC43djEuMmwtMC42LTEuMmgtNi40Yy0xLjEsMC0yLDAuMi0yLjgsMC42di0wLjZIMzV2MC42ICAgICAgYy0wLjUtMC40LTEuMS0wLjYtMS45LTAuNkgxN2wtMS4xLDIuNWwtMS4xLTIuNUg5Ljd2MS4ybC0wLjYtMS4ySDQuOGwtMiw0LjdsLTIuMyw1LjJoMi4zaDIuOGwwLjYtMS42aDEuNGwwLjYsMS42SDE0di0xLjIgICAgICBsMC41LDEuMmgyLjlsMC41LTEuMnYxLjJoMTMuOWwwLTIuNkgzMmMwLjIsMCwwLjIsMCwwLjIsMC4zdjIuMmg3LjJ2LTAuNmMwLjYsMC4zLDEuNSwwLjYsMi43LDAuNmgzbDAuNi0xLjZoMS40bDAuNiwxLjZoNS44ICAgICAgdi0xLjVsMC45LDEuNWg0Ljd2LTkuOEg1NC42eiBNMjAuOCwyOS41aC0xLjdsMC01LjVsLTIuNCw1LjVoLTEuNUwxMi44LDI0djUuNUg5LjRMOC43LDI4SDUuM2wtMC42LDEuNkgyLjhsMy03LjFoMi41bDIuOCw2LjcgICAgICB2LTYuN2gyLjdsMi4yLDQuOGwyLTQuOGgyLjhWMjkuNXogTTI3LjYsMjRoLTMuOXYxLjNoMy44djEuNGgtMy44djEuNGgzLjl2MS41SDIydi03LjFoNS42VjI0eiBNMzUuMSwyNi45ICAgICAgYzAuMiwwLjQsMC4zLDAuNywwLjMsMS4zdjEuNGgtMS43bDAtMC45YzAtMC40LDAtMS0wLjMtMS40QzMzLjEsMjcsMzIuOCwyNywzMi4yLDI3aC0xLjh2Mi42aC0xLjd2LTcuMWgzLjhjMC45LDAsMS41LDAsMiwwLjMgICAgICBjMC41LDAuMywwLjgsMC44LDAuOCwxLjZjMCwxLjEtMC43LDEuNy0xLjIsMS45QzM0LjYsMjYuNCwzNC45LDI2LjcsMzUuMSwyNi45eiBNMzguMSwyOS41aC0xLjd2LTcuMWgxLjdWMjkuNXogTTU3LjgsMjkuNSAgICAgIGgtMi40bC0zLjItNS4zdjUuM2gtMy40TDQ4LjIsMjhoLTMuNWwtMC42LDEuNmgtMS45Yy0wLjgsMC0xLjgtMC4yLTIuNC0wLjhjLTAuNi0wLjYtMC45LTEuNC0wLjktMi43YzAtMSwwLjItMiwwLjktMi44ICAgICAgYzAuNS0wLjYsMS40LTAuOCwyLjUtMC44aDEuNlYyNGgtMS42Yy0wLjYsMC0wLjksMC4xLTEuMywwLjRjLTAuMywwLjMtMC41LDAuOS0wLjUsMS42YzAsMC44LDAuMSwxLjMsMC41LDEuNyAgICAgIGMwLjMsMC4zLDAuNywwLjQsMS4yLDAuNGgwLjdsMi4zLTUuNWgyLjVsMi44LDYuN3YtNi43aDIuNWwyLjksNC45di00LjloMS43VjI5LjV6IiBmaWxsPSIjMDU3MUMxIi8+PC9nPjxnPjxwb2x5Z29uIGZpbGw9IiMyMjhGRTAiIHBvaW50cz0iNDUuMywyNi41IDQ3LjYsMjYuNSA0Ni41LDIzLjcgICAgICIvPjwvZz48L2c+PGc+PGc+PHBvbHlnb24gZmlsbD0iIzIyOEZFMCIgcG9pbnRzPSIyOC4zLDQwLjkgMjguMywzNS4yIDI1LjcsMzggICAgICIvPjwvZz48Zz48cG9seWdvbiBmaWxsPSIjMkZBQkY3IiBwb2ludHM9IjE3LjYsMzUuOSAxNy42LDM3LjIgMjEuMywzNy4yIDIxLjMsMzguNiAxNy42LDM4LjYgMTcuNiw0MC4xIDIxLjcsNDAuMSAyMy42LDM4IDIxLjgsMzUuOSAgICAgICAgICAgIi8+PC9nPjxnPjxwYXRoIGQ9Ik0zMi4xLDM1LjlIMzB2MS44aDIuMmMwLjYsMCwxLTAuMywxLTAuOUMzMy4xLDM2LjIsMzIuNywzNS45LDMyLjEsMzUuOXoiIGZpbGw9IiMyMjhGRTAiLz48L2c+PGc+PHBhdGggZD0iTTYzLDM3LjZ2LTQuNWgtMS4yaC0zYy0wLjksMC0xLjYsMC4yLTIuMSwwLjZ2LTAuNmgtNC42Yy0wLjcsMC0xLjYsMC4yLTIsMC42di0wLjZINDJ2MC42ICAgICAgYy0wLjYtMC41LTEuNy0wLjYtMi4yLTAuNmgtNS40djAuNmMtMC41LTAuNS0xLjctMC42LTIuMy0wLjZoLTZsLTEuNCwxLjVsLTEuMy0xLjVoLTl2OS44aDguOGwxLjQtMS41bDEuMywxLjVsNS40LDB2LTIuM0gzMiAgICAgIGMwLjcsMCwxLjYsMCwyLjMtMC4zdjIuN2g0LjV2LTIuNkgzOWMwLjMsMCwwLjMsMCwwLjMsMC4zdjIuM2gxMy42YzAuOSwwLDEuOC0wLjIsMi4zLTAuNnYwLjZoNC4zYzAuOSwwLDEuOC0wLjEsMi40LTAuNXYwICAgICAgYzEtMC42LDEuNi0xLjcsMS42LTNDNjMuNSwzOC44LDYzLjMsMzguMSw2MywzNy42eiBNMzIsMzkuMkgzMHYyLjRoLTMuMmwtMi0yLjNsLTIuMSwyLjNoLTYuNnYtNy4xaDYuN2wyLDIuM2wyLjEtMi4zaDUuMyAgICAgIGMxLjMsMCwyLjgsMC40LDIuOCwyLjNDMzQuOSwzOC44LDMzLjUsMzkuMiwzMiwzOS4yeiBNNDIsMzguOGMwLjIsMC4zLDAuMywwLjcsMC4zLDEuM3YxLjRoLTEuN3YtMC45YzAtMC40LDAtMS4xLTAuMy0xLjQgICAgICBjLTAuMi0wLjMtMC42LTAuMy0xLjItMC4zaC0xLjh2Mi42aC0xLjd2LTcuMWgzLjhjMC44LDAsMS41LDAsMiwwLjNjMC41LDAuMywwLjksMC44LDAuOSwxLjZjMCwxLjEtMC43LDEuNy0xLjIsMS45ICAgICAgQzQxLjYsMzguNCw0MS45LDM4LjYsNDIsMzguOHogTTQ4LjksMzUuOUg0NXYxLjNoMy44djEuNEg0NXYxLjRsMy45LDB2MS41aC01LjZ2LTcuMWg1LjZWMzUuOXogTTUzLjEsNDEuNWgtMy4yVjQwaDMuMiAgICAgIGMwLjMsMCwwLjUsMCwwLjctMC4yYzAuMS0wLjEsMC4yLTAuMywwLjItMC41YzAtMC4yLTAuMS0wLjQtMC4yLTAuNWMtMC4xLTAuMS0wLjMtMC4yLTAuNi0wLjJjLTEuNi0wLjEtMy41LDAtMy41LTIuMiAgICAgIGMwLTEsMC42LTIuMSwyLjQtMi4xaDMuM1YzNmgtMy4xYy0wLjMsMC0wLjUsMC0wLjcsMC4xYy0wLjIsMC4xLTAuMiwwLjMtMC4yLDAuNWMwLDAuMywwLjIsMC40LDAuNCwwLjUgICAgICBjMC4yLDAuMSwwLjQsMC4xLDAuNiwwLjFsMC45LDBjMC45LDAsMS41LDAuMiwxLjksMC42YzAuMywwLjMsMC41LDAuOCwwLjUsMS41QzU1LjcsNDAuOCw1NC44LDQxLjUsNTMuMSw0MS41eiBNNjEuNyw0MC44ICAgICAgYy0wLjQsMC40LTEuMSwwLjctMi4xLDAuN2gtMy4yVjQwaDMuMmMwLjMsMCwwLjUsMCwwLjctMC4yYzAuMS0wLjEsMC4yLTAuMywwLjItMC41YzAtMC4yLTAuMS0wLjQtMC4yLTAuNSAgICAgIGMtMC4xLTAuMS0wLjMtMC4yLTAuNi0wLjJjLTEuNi0wLjEtMy41LDAtMy41LTIuMmMwLTEsMC42LTIuMSwyLjQtMi4xaDMuM1YzNmgtM2MtMC4zLDAtMC41LDAtMC43LDAuMSAgICAgIGMtMC4yLDAuMS0wLjIsMC4zLTAuMiwwLjVjMCwwLjMsMC4xLDAuNCwwLjQsMC41YzAuMiwwLjEsMC40LDAuMSwwLjYsMC4xbDAuOSwwYzAuOSwwLDEuNSwwLjIsMS45LDAuNmMwLjEsMCwwLjEsMC4xLDAuMSwwLjEgICAgICBjMC4zLDAuNCwwLjQsMC45LDAuNCwxLjRDNjIuMywzOS45LDYyLjEsNDAuNCw2MS43LDQwLjh6IiBmaWxsPSIjMDU3MUMxIi8+PC9nPjxnPjxwYXRoIGQ9Ik00MC4yLDM2LjFjLTAuMi0wLjEtMC41LTAuMS0wLjgtMC4xaC0ydjEuNmgyYzAuMywwLDAuNiwwLDAuOC0wLjFjMC4yLTAuMSwwLjMtMC40LDAuMy0wLjcgICAgICBDNDAuNiwzNi40LDQwLjQsMzYuMiw0MC4yLDM2LjF6IiBmaWxsPSIjMjI4RkUwIi8+PC9nPjwvZz48L2c+PGc+PGc+PGc+PHBhdGggZD0iTTMzLjIsMjQuMUMzMywyNCwzMi43LDI0LDMyLjQsMjRoLTJ2MS42aDJjMC4zLDAsMC42LDAsMC44LTAuMWMwLjItMC4xLDAuMy0wLjQsMC4zLTAuNyAgICAgIEMzMy42LDI0LjQsMzMuNCwyNC4yLDMzLjIsMjQuMXoiIGZpbGw9IiMyMjhGRTAiLz48L2c+PGc+PHBvbHlnb24gZmlsbD0iIzIyOEZFMCIgcG9pbnRzPSI0NS4zLDI2LjUgNDcuNiwyNi41IDQ2LjUsMjMuNyAgICAgIi8+PC9nPjwvZz48Zz48Zz48cG9seWdvbiBmaWxsPSIjMjI4RkUwIiBwb2ludHM9IjI4LjMsNDAuOSAyOC4zLDM1LjIgMjUuNywzOCAgICAgIi8+PC9nPjxnPjxwYXRoIGQ9Ik0zMi4xLDM1LjlIMzB2MS44aDIuMmMwLjYsMCwxLTAuMywxLTAuOUMzMy4xLDM2LjIsMzIuNywzNS45LDMyLjEsMzUuOXoiIGZpbGw9IiMyMjhGRTAiLz48L2c+PGc+PHBhdGggZD0iTTQwLjIsMzYuMWMtMC4yLTAuMS0wLjUtMC4xLTAuOC0wLjFoLTJ2MS42aDJjMC4zLDAsMC42LDAsMC44LTAuMWMwLjItMC4xLDAuMy0wLjQsMC4zLTAuNyAgICAgIEM0MC42LDM2LjQsNDAuNCwzNi4yLDQwLjIsMzYuMXoiIGZpbGw9IiMyMjhGRTAiLz48L2c+PC9nPjwvZz48Zz48cG9seWdvbiBmaWxsPSIjMkZBQkY3IiBwb2ludHM9IjMxLjQsNDEuMyAzMCwzOS44IDMwLDQxLjUgMjYuNyw0MS41IDI0LjcsMzkuMiAyMi41LDQxLjUgMTUuOSw0MS41IDE1LjksMzQuNSAyMi42LDM0LjUgICAgIDI0LjcsMzYuOCAyNS43LDM1LjYgMjMuMiwzMy4xIDE0LjQsMzMuMSAxNC40LDQyLjkgMjMuMiw0Mi45IDI0LjcsNDEuNCAyNiw0Mi45IDMxLjQsNDIuOSAgICIvPjwvZz48Zz48Zz48cG9seWdvbiBmaWxsPSIjMkZBQkY3IiBwb2ludHM9IjIxLDMwLjkgMTkuNywyOS41IDE5LjEsMjkuNSAxOS4xLDI4LjkgMTcuNiwyNy40IDE2LjYsMjkuNSAxNS4yLDI5LjUgMTIuOCwyNCAxMi44LDI5LjUgICAgICA5LjQsMjkuNSA4LjcsMjggNS4zLDI4IDQuNiwyOS41IDIuOCwyOS41IDUuOCwyMi41IDguMywyMi41IDExLjEsMjkuMiAxMS4xLDIyLjUgMTIuNiwyMi41IDExLjIsMjEuMSA5LjcsMjEuMSA5LjcsMjIuMyAgICAgIDkuMiwyMS4xIDQuOCwyMS4xIDIuOCwyNS44IDAuNSwzMC45IDIuOCwzMC45IDUuNywzMC45IDYuMywyOS40IDcuNywyOS40IDguNCwzMC45IDE0LDMwLjkgMTQsMjkuNyAxNC41LDMwLjkgMTcuNCwzMC45ICAgICAgMTcuOSwyOS43IDE3LjksMzAuOSAgICAiLz48L2c+PGc+PHBvbHlnb24gZmlsbD0iIzJGQUJGNyIgcG9pbnRzPSIxNi40LDI2LjMgMTQuOCwyNC43IDE2LDI3LjMgICAgIi8+PC9nPjwvZz48Zz48Zz48cGF0aCBkPSJNNjEuOSw0Mi40YzAuOS0wLjYsMS41LTEuNiwxLjYtMi43bC0xLjQtMS40YzAuMSwwLjMsMC4yLDAuNiwwLjIsMWMwLDAuNi0wLjIsMS4xLTAuNiwxLjUgICAgIGMtMC40LDAuNC0xLjEsMC43LTIuMSwwLjdoLTMuMlY0MGgzLjJjMC4zLDAsMC41LDAsMC43LTAuMmMwLjEtMC4xLDAuMi0wLjMsMC4yLTAuNWMwLTAuMi0wLjEtMC40LTAuMi0wLjUgICAgIGMtMC4xLTAuMS0wLjMtMC4yLTAuNi0wLjJjLTEuNi0wLjEtMy41LDAtMy41LTIuMmMwLTEsMC42LTEuOSwyLjEtMi4xbC0xLjEtMS4xYy0wLjIsMC4xLTAuMywwLjItMC40LDAuMnYtMC42aC00LjYgICAgIGMtMC43LDAtMS42LDAuMi0yLDAuNnYtMC42SDQydjAuNmMtMC42LTAuNS0xLjctMC42LTIuMi0wLjZoLTUuNHYwLjZjLTAuNS0wLjUtMS43LTAuNi0yLjMtMC42aC02bC0xLjQsMS41bC0xLjMtMS41aC0xLjFsMywzICAgICBsMS41LTEuNmg1LjNjMS4zLDAsMi44LDAuNCwyLjgsMi4zYzAsMi0xLjQsMi40LTIuOSwyLjRIMzB2MS41bDEuNSwxLjV2LTEuNUgzMmMwLjcsMCwxLjYsMCwyLjMtMC4zdjIuN2g0LjV2LTIuNkgzOSAgICAgYzAuMywwLDAuMywwLDAuMywwLjN2Mi4zaDEzLjZjMC45LDAsMS44LTAuMiwyLjMtMC42djAuNmg0LjNDNjAuMyw0Mi45LDYxLjIsNDIuOCw2MS45LDQyLjRMNjEuOSw0Mi40eiBNNDIsMzguOCAgICAgYzAuMiwwLjMsMC4zLDAuNywwLjMsMS4zdjEuNGgtMS43di0wLjljMC0wLjQsMC0xLjEtMC4zLTEuNGMtMC4yLTAuMy0wLjYtMC4zLTEuMi0wLjNoLTEuOHYyLjZoLTEuN3YtNy4xaDMuOGMwLjgsMCwxLjUsMCwyLDAuMyAgICAgYzAuNSwwLjMsMC45LDAuOCwwLjksMS42YzAsMS4xLTAuNywxLjctMS4yLDEuOUM0MS42LDM4LjQsNDEuOSwzOC42LDQyLDM4Ljh6IE00OC45LDM1LjlINDV2MS4zaDMuOHYxLjRINDV2MS40bDMuOSwwdjEuNWgtNS42ICAgICB2LTcuMWg1LjZWMzUuOXogTTUzLjEsNDEuNWgtMy4yVjQwaDMuMmMwLjMsMCwwLjUsMCwwLjctMC4yYzAuMS0wLjEsMC4yLTAuMywwLjItMC41YzAtMC4yLTAuMS0wLjQtMC4yLTAuNSAgICAgYy0wLjEtMC4xLTAuMy0wLjItMC42LTAuMmMtMS42LTAuMS0zLjUsMC0zLjUtMi4yYzAtMSwwLjYtMi4xLDIuNC0yLjFoMy4zVjM2aC0zLjFjLTAuMywwLTAuNSwwLTAuNywwLjEgICAgIGMtMC4yLDAuMS0wLjIsMC4zLTAuMiwwLjVjMCwwLjMsMC4yLDAuNCwwLjQsMC41YzAuMiwwLjEsMC40LDAuMSwwLjYsMC4xbDAuOSwwYzAuOSwwLDEuNSwwLjIsMS45LDAuNmMwLjMsMC4zLDAuNSwwLjgsMC41LDEuNSAgICAgQzU1LjcsNDAuOCw1NC44LDQxLjUsNTMuMSw0MS41eiIgZmlsbD0iIzIyOEZFMCIvPjwvZz48Zz48cGF0aCBkPSJNNTcuOSwzNi42YzAsMC4zLDAuMSwwLjQsMC40LDAuNWMwLjIsMC4xLDAuNCwwLjEsMC42LDAuMWwwLjksMGMwLjYsMCwxLDAuMSwxLjQsMC4zTDU5LjcsMzZoLTAuOSAgICAgYy0wLjMsMC0wLjUsMC0wLjcsMC4xQzU4LDM2LjIsNTcuOSwzNi40LDU3LjksMzYuNnoiIGZpbGw9IiMyMjhGRTAiLz48L2c+PC9nPjxnPjxnPjxwb2x5Z29uIGZpbGw9IiMyMjhGRTAiIHBvaW50cz0iNTQuNCwzMC42IDU0LjYsMzAuOSA1NC43LDMwLjkgICAgIi8+PC9nPjxnPjxwb2x5Z29uIGZpbGw9IiMyMjhGRTAiIHBvaW50cz0iNDguOSwyNS4xIDUwLjYsMjkuMiA1MC42LDI2LjggICAgIi8+PC9nPjxnPjxwYXRoIGQ9Ik0zMS44LDI4LjRIMzJjMC4yLDAsMC4yLDAsMC4yLDAuM3YyLjJoNy4ydi0wLjZjMC42LDAuMywxLjUsMC42LDIuNywwLjZoM2wwLjYtMS42aDEuNGwwLjYsMS42aDUuOHYtMSAgICAgbC0xLjQtMS40djEuMWgtMy40TDQ4LjIsMjhoLTMuNWwtMC42LDEuNmgtMS45Yy0wLjgsMC0xLjgtMC4yLTIuNC0wLjhjLTAuNi0wLjYtMC45LTEuNC0wLjktMi43YzAtMSwwLjItMiwwLjktMi44ICAgICBjMC41LTAuNiwxLjQtMC44LDIuNS0wLjhoMS42VjI0aC0xLjZjLTAuNiwwLTAuOSwwLjEtMS4zLDAuNGMtMC4zLDAuMy0wLjUsMC45LTAuNSwxLjZjMCwwLjgsMC4xLDEuMywwLjUsMS43ICAgICBjMC4zLDAuMywwLjcsMC40LDEuMiwwLjRoMC43bDIuMy01LjVoMWwtMS40LTEuNGgtMi42Yy0xLjEsMC0yLDAuMi0yLjgsMC42di0wLjZIMzV2MC42Yy0wLjUtMC40LTEuMS0wLjYtMS45LTAuNkgxN2wtMS4xLDIuNSAgICAgbC0xLjEtMi41aC00LjRsMS40LDEuNGgybDEuNywzLjdsMC42LDAuNmwxLjgtNC40aDIuOHY3LjFoLTEuN2wwLTUuNWwtMS43LDRsMi45LDIuOWgxMS41TDMxLjgsMjguNHogTTM2LjQsMjIuNWgxLjd2Ny4xaC0xLjcgICAgIFYyMi41eiBNMjcuNiwyNGgtMy45djEuM2gzLjh2MS40aC0zLjh2MS40aDMuOXYxLjVIMjJ2LTcuMWg1LjZWMjR6IE0zMC40LDI5LjVoLTEuN3YtNy4xaDMuOGMwLjksMCwxLjUsMCwyLDAuMyAgICAgYzAuNSwwLjMsMC44LDAuOCwwLjgsMS42YzAsMS4xLTAuNywxLjctMS4yLDEuOWMwLjQsMC4xLDAuNywwLjQsMC44LDAuNmMwLjIsMC40LDAuMywwLjcsMC4zLDEuM3YxLjRoLTEuN2wwLTAuOSAgICAgYzAtMC40LDAtMS0wLjMtMS40QzMzLjEsMjcsMzIuOCwyNywzMi4yLDI3aC0xLjhWMjkuNXoiIGZpbGw9IiMyMjhGRTAiLz48L2c+PC9nPjwvZz48L3N2Zz4=',
  'naranja':          null,
  'otro':             'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE2LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iQ2FwYV8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgd2lkdGg9IjYxMnB4IiBoZWlnaHQ9IjYxMnB4IiB2aWV3Qm94PSIwIDAgNjEyIDYxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNjEyIDYxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGcgaWQ9IlNoYXBlXzFfMl8iPg0KCQk8Zz4NCgkJCTxwYXRoIGQ9Ik01NDcuOTUzLDkyLjUxMkg2NC4wNDZDMjguNzM1LDkyLjUxMiwwLDEyMS4yNDcsMCwxNTYuNTU4djI5OC44ODNjMCwzNS4zMTIsMjguNzM1LDY0LjA0Nyw2NC4wNDYsNjQuMDQ3aDQ4My45MDcNCgkJCQljMzUuMzEyLDAsNjQuMDQ3LTI4LjczNSw2NC4wNDctNjQuMDQ3VjE1Ni41NThDNjEyLDEyMS4yNDcsNTgzLjI2NSw5Mi41MTIsNTQ3Ljk1Myw5Mi41MTJ6IE01OTcuNzY4LDQ1NS40NDENCgkJCQljMCwyNy40Ny0yMi4zNDYsNDkuODE0LTQ5LjgxNCw0OS44MTRINjQuMDQ2Yy0yNy40NjksMC00OS44MTQtMjIuMzQ1LTQ5LjgxNC00OS44MTRWMjkxLjc2OGg1ODMuNTM1VjQ1NS40NDF6IE01OTcuNzY4LDI3Ny41MzUNCgkJCQlIMTQuMjMydi03MS4xNjNoNTgzLjUzNVYyNzcuNTM1eiBNNTk3Ljc2OCwxOTIuMTRIMTQuMjMydi0zNS41ODJjMC0yNy40NjksMjIuMzQ1LTQ5LjgxNCw0OS44MTQtNDkuODE0aDQ4My45MDcNCgkJCQljMjcuNDY5LDAsNDkuODE0LDIyLjM0NSw0OS44MTQsNDkuODE0VjE5Mi4xNHogTTg1LjM5NiwzOTEuMzk2SDcxLjE2M3Y0Mi42OTdoMTQuMjMzVjM5MS4zOTZ6IE0xMjguMDkzLDM5MS4zOTZIMTEzLjg2djQyLjY5Nw0KCQkJCWgxNC4yMzJWMzkxLjM5NnogTTE3MC43OTEsMzkxLjM5NmgtMTQuMjMydjQyLjY5N2gxNC4yMzJWMzkxLjM5NnogTTQ1NS40NDEsMzkxLjM5NmgtMTQuMjMydjQyLjY5N2gxNC4yMzJWMzkxLjM5NnoNCgkJCQkgTTQ5OC4xNCwzOTEuMzk2aC0xNC4yMzJ2NDIuNjk3aDE0LjIzMlYzOTEuMzk2eiBNNTQwLjgzNywzOTEuMzk2aC0xNC4yMzJ2NDIuNjk3aDE0LjIzMlYzOTEuMzk2eiBNMjcwLjQxOCwzOTEuMzk2aC0xNC4yMzINCgkJCQl2NDIuNjk3aDE0LjIzMlYzOTEuMzk2eiBNMzEzLjExNiwzOTEuMzk2aC0xNC4yMzJ2NDIuNjk3aDE0LjIzMlYzOTEuMzk2eiBNMzU1LjgxNCwzOTEuMzk2aC0xNC4yMzN2NDIuNjk3aDE0LjIzM1YzOTEuMzk2eiIvPg0KCQk8L2c+DQoJPC9nPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo='
};

function cardLogo(type) {
  var t = (type || '').toLowerCase();
  var src = CARD_LOGOS[t] || CARD_LOGOS['otro'];
  if (t === 'naranja') {
    return '<div style="width:44px;height:28px;background:#FF6B00;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:#fff;letter-spacing:.5px">NARANJA</div>';
  }
  return '<img src="' + src + '" style="width:44px;height:28px;object-fit:contain;border-radius:4px;border:1px solid var(--border);background:#fff;padding:2px" alt="' + (type||'') + '">';
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
  var defaultYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var sel = document.getElementById('dash-month-sel');
  if (sel && !sel.value) sel.value = defaultYm;
  var ym = (sel && sel.value) ? sel.value : defaultYm;
  var lbl = document.getElementById('dash-month-label');
  if (lbl) lbl.textContent = new Date(ym + '-01').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  var ms = db.summaries.filter(function(s){ return s.month === ym; })
    .sort(function(a, b) {
      if (!a.vencimiento) return 1;
      if (!b.vencimiento) return -1;
      return a.vencimiento < b.vencimiento ? -1 : a.vencimiento > b.vencimiento ? 1 : 0;
    });
  var totalARS = 0, totalMin = 0, totalUSD = 0, nextVenc = null, nextDays = null;
  ms.forEach(function(s) {
    totalARS += Number(s.total || 0);
    totalMin += Number(s.minimo || 0);
    totalUSD += Number(s.totalUSD || 0);
    // Only consider pending cards for próx vencimiento
    var payment = (db.payments && db.payments[s.id]) ? db.payments[s.id] : {};
    var paidARS = Number(payment.ars || 0);
    var paidUSD = Number(payment.usd || 0);
    var sTotal = Number(s.total || 0);
    var sTotalUSD = Number(s.totalUSD || 0);
    var sIsPaid = payment.full || (paidARS >= sTotal && (sTotalUSD === 0 || paidUSD >= sTotalUSD));
    if (!sIsPaid && s.vencimiento) {
      var d = new Date(s.vencimiento + 'T00:00:00');
      if (!nextVenc || d < nextVenc) { nextVenc = d; nextDays = daysUntil(s.vencimiento); }
    }
  });
  document.getElementById('d-total').textContent = '$' + fmt(totalARS);
  document.getElementById('d-min').textContent = '$' + fmt(totalMin);
  document.getElementById('d-usd').textContent = 'U$S ' + fmt(totalUSD);

  // Calculate total pending (sum of restantes)
  var totalPending = 0;
  ms.forEach(function(s) {
    var payment = (db.payments && db.payments[s.id]) ? db.payments[s.id] : {};
    var paidARS = Number(payment.ars || 0);
    var sTotal = Number(s.total || 0);
    var isPaidFull = payment.full || paidARS >= sTotal;
    if (!isPaidFull) totalPending += Math.max(0, sTotal - paidARS);
  });
  var pendEl = document.getElementById('d-pending');
  if (pendEl) pendEl.textContent = '$' + fmt(totalPending);

  // Calculate total pending (sum of restantes)
  var totalPendiente = 0;
  ms.forEach(function(s) {
    var payment = (db.payments && db.payments[s.id]) ? db.payments[s.id] : {};
    var paidARS = Number(payment.ars || 0);
    var sTotal = Number(s.total || 0);
    var sTotalUSD = Number(s.totalUSD || 0);
    var sPaidUSD = Number(payment.usd || 0);
    var sIsPaid = payment.full || (paidARS >= sTotal && (sTotalUSD === 0 || sPaidUSD >= sTotalUSD));
    if (!sIsPaid) totalPendiente += Math.max(0, sTotal - paidARS);
  });
  var pendEl = document.getElementById('d-pendiente');
  if (pendEl) pendEl.textContent = '$' + fmt(totalPendiente);
  var vencEl = document.getElementById('d-venc');
  if (nextVenc) {
    vencEl.innerHTML = nextVenc.toLocaleDateString('es-AR', { day:'2-digit', month:'short' }) +
      '<div style="font-size:10px;margin-top:2px">' + (nextDays !== null ? vencLabel(nextDays).replace(/<[^>]+>/g,'') : '') + '</div>';
    vencEl.style.color = nextDays !== null && nextDays <= 3 ? 'var(--red)' : nextDays <= 7 ? 'var(--amber)' : '';
  } else {
    vencEl.textContent = '-';
  }

  // Cards table
  var dc = document.getElementById('dash-cards');
  if (!ms.length) {
    dc.innerHTML = '<div class="empty">Sin datos para este mes</div>';
  } else {
    var rows = ms.map(function(s) {
      var card = db.cards.find(function(c){ return c.id === s.cardId; }) || { name: s.cardName || 'Tarjeta', autoDebit: 'no' };
      var extra = Number(s.total||0) - Number(s.minimo||0);
      var days = daysUntil(s.vencimiento);
      var payment = (db.payments && db.payments[s.id]) ? db.payments[s.id] : {};
      var paidARS = Number(payment.ars || 0);
      var paidUSD = Number(payment.usd || 0);
      var totalARS = Number(s.total || 0);
      var totalUSD2 = Number(s.totalUSD || 0);
      var isPaid = payment.full ||
        (paidARS >= totalARS && (totalUSD2 === 0 || paidUSD >= totalUSD2));
      var isPartial = !isPaid && (paidARS > 0 || paidUSD > 0);
      var restanteARS = Math.max(0, totalARS - paidARS);
      var restanteUSD = Math.max(0, totalUSD2 - paidUSD);
      var vencBadge = days === null ? '' :
        days < 0  ? '<span class="badge red"   style="font-size:10px;margin-left:4px">vencida</span>' :
        days === 0 ? '<span class="badge red"   style="font-size:10px;margin-left:4px">hoy</span>' :
        days <= 3  ? '<span class="badge red"   style="font-size:10px;margin-left:4px">' + days + 'd</span>' :
        days <= 7  ? '<span class="badge amber" style="font-size:10px;margin-left:4px">' + days + 'd</span>' :
                     '<span class="badge green" style="font-size:10px;margin-left:4px">' + days + 'd</span>';
      return '<tr>' +
        '<td style="width:52px">' + cardLogo(card.type) + '</td>' +
        '<td><div style="font-weight:500;font-size:13px">' + card.name + '</div>' +
            '<div style="font-size:11px;color:var(--text2)">' + (card.bank||'') + '</div></td>' +
        '<td>' + fmtDate(s.vencimiento) + vencBadge + '</td>' +
        '<td style="text-align:right"><div class="num">$' + fmt(s.total||0) + '</div>' +
          (Number(s.totalUSD)>0 ? '<div style="font-size:11px;color:var(--text2)">U$S ' + fmt(s.totalUSD) + '</div>' : '') + '</td>' +
        '<td style="text-align:right">' +
          '<div class="num" style="color:var(--amber)">$' + fmt(s.minimo||0) + (card.autoDebit==='yes' ? ' <span style="font-size:10px;color:var(--text2)">(auto)</span>' : '') + '</div>' +
          (card.autoDebit==='yes' && extra>0 ? '<div style="font-size:10px;color:var(--amber);margin-top:1px">+$' + fmt(extra) + ' sobre mín.</div>' : '') +
        '</td>' +
        '<td style="text-align:right">' +
          (isPaid
            ? '<span style="color:var(--green);font-size:13px;font-weight:500">—</span>'
            : '<div class="num" style="font-size:13px">' + (restanteARS > 0 ? '$' + fmt(restanteARS) : '—') + '</div>' +
              (restanteUSD > 0 ? '<div style="font-size:11px;color:var(--text2)">U$S ' + fmt(restanteUSD) + '</div>' : '')) +
        '</td>' +
        '<td>' +
          (isPaid ? '<span class="badge green" style="font-size:11px">pagada</span>' :
           isPartial ? '<span class="badge amber" style="font-size:11px">parcial</span>' :
           '<span class="badge gray" style="font-size:11px">pendiente</span>') +
        '</td>' +
        '<td><div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' +
          '<input type="number" placeholder="$" value="' + (payment.ars||'') + '" style="width:88px;font-size:12px;padding:4px 8px" id="pay-ars-' + s.id + '" data-sid="' + s.id + '" oninput="savePayment(this.dataset.sid)">' +
          (Number(s.totalUSD)>0 ? '<input type="number" placeholder="U$S" value="' + (payment.usd||'') + '" style="width:70px;font-size:12px;padding:4px 8px" id="pay-usd-' + s.id + '" data-sid="' + s.id + '" oninput="savePayment(this.dataset.sid)">' : '<input type="hidden" id="pay-usd-' + s.id + '" value="' + (payment.usd||'') + '">') +
          '<label style="display:flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;white-space:nowrap">' +
            '<input type="checkbox" id="pay-full-' + s.id + '" data-sid="' + s.id + '" data-total="' + (s.total||0) + '" data-usd="' + (s.totalUSD||0) + '" ' + (payment.full?'checked':'') + ' onchange="toggleFullPayment(this.dataset.sid,this.dataset.total,this.dataset.usd)">Total' +
          '</label>' +
        '</div></td>' +
      '</tr>';
    }).join('');
    dc.innerHTML = '<div class="table-wrap"><table>' +
      '<thead><tr><th style="width:52px"></th><th>Tarjeta</th><th>Vencimiento</th><th style="text-align:right">Total</th><th style="text-align:right">Mínimo</th><th style="text-align:right">Restante</th><th style="text-align:center">Estado</th><th>Pago</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
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
  // Show holders from: registered extHolders + gastosTerceros holders for this month
  var registeredHolders = db.extHolders.map(function(h){ return (h.name||'').toLowerCase().trim(); }).filter(Boolean);
  // Also include anyone who has manual gastosTerceros this month
  var manualHolders = (db.gastosTerceros||[])
    .filter(function(g){ return g.month === ym2; })
    .map(function(g){ return (g.holder||'').toLowerCase().trim(); })
    .filter(Boolean);
  var allHolders = registeredHolders.concat(manualHolders.filter(function(h){ return registeredHolders.indexOf(h) === -1; }));
  var extKeys = allHolders.length > 0
    ? Object.keys(extData).filter(function(k) {
        return allHolders.indexOf((k||'').toLowerCase().trim()) !== -1;
      })
    : Object.keys(extData);
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
    (s.ownExpenses||[]).forEach(function(e){ var d = (e.desc||e.d||'').toLowerCase().trim(); if(d) prevDescs[d] = true; });
  });
  _newItems = [];
  ms.forEach(function(s) {
    (s.ownExpenses||[]).forEach(function(e) {
      var ed = (e.desc||e.d||'').toLowerCase().trim();
      if (ed && !prevDescs[ed]) {
        _newItems.push({ desc: e.desc||e.d||'-', amount: e.amount||e.a||0, currency: e.currency||e.cu||'ARS', card: s.cardName||'', cardId: s.cardId });
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
  if (!el) return;
  var visible = el.style.display !== 'none';
  el.style.display = visible ? 'none' : 'block';
  if (btn) btn.textContent = visible ? 'Mostrar' : 'Ocultar';
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
  // Update restante and estado in the same row without full re-render
  updatePaymentRow(summaryId);
}

function updatePaymentRow(summaryId) {
  var s = db.summaries.find(function(x){ return x.id === summaryId; });
  if (!s) return;
  var payment = db.payments[summaryId] || {};
  var paidARS = Number(payment.ars || 0);
  var paidUSD = Number(payment.usd || 0);
  var totalARS = Number(s.total || 0);
  var totalUSD2 = Number(s.totalUSD || 0);
  var isPaid = payment.full || (paidARS >= totalARS && (totalUSD2 === 0 || paidUSD >= totalUSD2));
  var isPartial = !isPaid && (paidARS > 0 || paidUSD > 0);
  var restanteARS = Math.max(0, totalARS - paidARS);
  var restanteUSD = Math.max(0, totalUSD2 - paidUSD);

  // Update restante cell — find td by looking at the row
  var arsInput = document.getElementById('pay-ars-' + summaryId);
  if (!arsInput) return;
  var row = arsInput.closest('tr');
  if (!row) return;
  var tds = row.querySelectorAll('td');
  // Col order: logo, tarjeta, vencimiento, total, minimo, restante(5), estado(6), pago(7)
  var restanteTd = tds[5];
  var estadoTd = tds[6];

  if (restanteTd) {
    if (isPaid) {
      restanteTd.innerHTML = '<span style="color:var(--green);font-size:13px;font-weight:500">—</span>';
    } else {
      restanteTd.innerHTML = '<div class="num" style="font-size:13px">' + (restanteARS > 0 ? '$' + fmt(restanteARS) : '—') + '</div>' +
        (restanteUSD > 0 ? '<div style="font-size:11px;color:var(--text2)">U$S ' + fmt(restanteUSD) + '</div>' : '');
    }
  }
  if (estadoTd) {
    estadoTd.innerHTML = isPaid
      ? '<span class="badge green" style="font-size:11px">pagada</span>'
      : isPartial
        ? '<span class="badge amber" style="font-size:11px">parcial</span>'
        : '<span class="badge gray" style="font-size:11px">pendiente</span>';
  }

  // Update vencimiento metric card if needed
  var vencEl = document.getElementById('d-venc');
  if (vencEl) {
    var now = new Date();
    var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var sel = document.getElementById('dash-month-sel');
    if (sel && sel.value) ym = sel.value;
    var ms = db.summaries.filter(function(x){ return x.month === ym; });
    var nextVenc = null; var nextDays = null;
    ms.forEach(function(x) {
      var p = (db.payments && db.payments[x.id]) ? db.payments[x.id] : {};
      var pa = Number(p.ars||0); var pu = Number(p.usd||0);
      var tt = Number(x.total||0); var tu = Number(x.totalUSD||0);
      var paid = p.full || (pa >= tt && (tu===0||pu>=tu));
      if (!paid && x.vencimiento) {
        var d = new Date(x.vencimiento + 'T00:00:00');
        if (!nextVenc || d < nextVenc) { nextVenc = d; nextDays = daysUntil(x.vencimiento); }
      }
    });
    if (nextVenc) {
      vencEl.innerHTML = nextVenc.toLocaleDateString('es-AR', { day:'2-digit', month:'short' }) +
        '<div style="font-size:10px;margin-top:2px">' + vencLabel(nextDays).replace(/<[^>]+>/g,'') + '</div>';
      vencEl.style.color = nextDays !== null && nextDays <= 3 ? 'var(--red)' : nextDays <= 7 ? 'var(--amber)' : '';
    } else {
      vencEl.textContent = '—';
      vencEl.style.color = '';
    }
  }
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
  renderDashboard();
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
    '5b. Para fechas: el formato del resumen puede ser DD Mes AA (ej: 06 Abr 26 = 2026-04-06) o DD/MM/AAAA. El dia siempre va primero. Si dice 06 Abr 26 el vencimiento es 2026-04-06, NO 2026-04-30.\n' +
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
  var summaryId = 's' + Date.now();
  var summaryObj = {
    id: summaryId, cardId, uploadedAt: new Date().toISOString(),
    cardName: card ? card.name : (p.cardName || 'Tarjeta'),
    month, vencimiento: p.vencimiento || '',
    minimo: Number(p.minimo || 0),
    total: Number(p.total || 0),
    totalUSD: Number(p.totalUSD || 0),
    ownExpenses: (p.ownExpenses || []).map(mapExpense),
    extensions: (p.extensions || []).map(mapExtension),
    driveFileId: null,
    driveLink: null
  };
  db.summaries.push(summaryObj);
  saveAndSync();
  pendingExtraction = null;
  document.getElementById('ai-output').textContent = 'Guardado. Subiendo archivo a Drive...';
  document.getElementById('confirm-btn').style.display = 'none';

  // Upload original file to Drive in background
  if (useSheets && isAuthorized && uploadedFileData) {
    var cardNameSafe = (summaryObj.cardName || 'tarjeta').replace(/[^a-zA-Z0-9\s]/g, '').trim();
    var fileName = cardNameSafe + ' - ' + month + '.' + (uploadedFileType === 'application/pdf' ? 'pdf' : 'jpg');
    var folderPath = month;
    uploadToDrive(fileName, uploadedFileData, uploadedFileType || 'application/pdf', folderPath)
      .then(function(result) {
        if (result) {
          summaryObj.driveFileId = result.id;
          summaryObj.driveLink = result.link;
          // Update the summary in db
          var idx = db.summaries.findIndex(function(s){ return s.id === summaryId; });
          if (idx !== -1) db.summaries[idx] = summaryObj;
          saveAndSync();
          document.getElementById('ai-output').textContent = 'Guardado y subido a Drive correctamente.';
        } else {
          document.getElementById('ai-output').textContent = 'Guardado. No se pudo subir a Drive.';
        }
      });
  } else {
    document.getElementById('ai-output').textContent = 'Guardado correctamente.';
  }

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
  var cardFilter  = (document.getElementById('hf-card')   || {}).value || '';
  var fromFilter  = (document.getElementById('hf-from')   || {}).value || '';
  var toFilter    = (document.getElementById('hf-to')     || {}).value || '';
  var searchQuery = ((document.getElementById('hf-search') || {}).value || '').toLowerCase().trim();

  var items = db.summaries.slice().sort(function(a, b) {
    var da = a.uploadedAt || a.id || '';
    var db2 = b.uploadedAt || b.id || '';
    return db2 < da ? -1 : db2 > da ? 1 : 0;
  });
  if (cardFilter) items = items.filter(function(s){ return s.cardId === cardFilter; });
  if (fromFilter) items = items.filter(function(s){ return s.month >= fromFilter; });
  if (toFilter)   items = items.filter(function(s){ return s.month <= toFilter; });
  if (searchQuery) {
    items = items.filter(function(s) {
      // Search in ownExpenses descriptions
      var found = (s.ownExpenses || []).some(function(e) {
        return (e.desc || e.d || '').toLowerCase().indexOf(searchQuery) !== -1;
      });
      // Also search in extensions items
      if (!found) {
        found = (s.extensions || []).some(function(ext) {
          return (ext.items || []).some(function(i) {
            return (i.desc || i.d || '').toLowerCase().indexOf(searchQuery) !== -1;
          });
        });
      }
      // Also search in card name
      if (!found) found = (s.cardName || '').toLowerCase().indexOf(searchQuery) !== -1;
      return found;
    });
    // Auto-expand matching rows and highlight
    setTimeout(function() {
      items.forEach(function(s) {
        var det = document.getElementById('det-' + s.id);
        var arr = document.getElementById('arr-' + s.id);
        if (det && det.style.display === 'none') {
          det.style.display = 'table-row';
          if (arr) arr.textContent = '▼';
        }
      });
    }, 50);
  }
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
      var eDesc = e.desc || e.d || '-';
      var eAmount = Number(e.amount || e.a || 0);
      var eCurrency = e.currency || e.cu || 'ARS';
      var eCategory = e.category || e.cat || 'Otros';
      var eIsCredit = !!(e.isCredit || e.cr);
      var eCuotas = e.cuotas || e.q;
      var eCuotaActual = e.cuotaActual || e.qi;
      var cuotasTag = (eCuotas && eCuotas > 1)
        ? ' <span class="badge blue" style="font-size:10px">' + (eCuotaActual || '?') + '/' + eCuotas + ' cuotas</span>'
        : '';
      var currSymbol = (eCurrency === 'USD') ? 'U$S ' : '$';
      var creditStyle = eIsCredit ? 'color:var(--green)' : '';
      var creditSign = eIsCredit ? '-' : '';
      // Highlight if matches search
      var descHtml = eDesc;
      if (searchQuery && eDesc.toLowerCase().indexOf(searchQuery) !== -1) {
        var idx = eDesc.toLowerCase().indexOf(searchQuery);
        descHtml = eDesc.substring(0, idx) +
          '<mark style="background:#fff3cd;border-radius:2px;padding:0 2px">' + eDesc.substring(idx, idx + searchQuery.length) + '</mark>' +
          eDesc.substring(idx + searchQuery.length);
      }
      var catSel = eIsCredit
        ? '<span style="font-size:11px;color:var(--text3);font-style:italic">pago / crédito</span>'
        : '<select onchange="updateExpenseCategory(\'' + sid + '\', ' + j + ', this.value)" style="font-size:11px;padding:3px 6px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--surface);color:var(--text);max-width:160px">' +
          db.categories.map(function(c){ return '<option' + (c === eCategory ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
          '</select>';
      expRows += '<tr style="' + (eIsCredit ? 'opacity:0.6' : '') + '"><td>' + descHtml + cuotasTag + '</td>' +
        '<td>' + catSel + '</td>' +
        '<td class="num" style="text-align:right;' + creditStyle + '">' + creditSign + currSymbol + fmt(eAmount) + '</td></tr>';
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

    var driveCell = s.driveLink
      ? '<a href="' + s.driveLink + '" target="_blank" onclick="event.stopPropagation()" title="Ver en Drive" style="display:inline-flex;align-items:center;gap:4px;color:var(--purple);text-decoration:none;font-size:12px;font-weight:500"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Ver</a>'
      : '<span style="color:var(--text3);font-size:12px">-</span>';

    rows += '<tr style="cursor:pointer" onclick="toggleHistoricoRow(\'' + sid + '\', this)">' +
      '<td style="color:var(--text2);font-size:12px" id="arr-' + sid + '">&#9654;</td>' +
      '<td><b>' + card.name + '</b></td>' +
      '<td><span class="tag">' + s.month + '</span></td>' +
      '<td style="color:var(--text2);font-size:12px">' + dateStr + (timeStr ? ' ' + timeStr : '') + '</td>' +
      '<td class="num" style="text-align:right">$' + fmt(s.total || 0) + '</td>' +
      '<td class="num" style="text-align:right">' + (Number(s.totalUSD) > 0 ? 'U$S ' + fmt(s.totalUSD) : '-') + '</td>' +
      '<td>' + driveCell + '</td>' +
      '<td style="display:flex;gap:4px">' +
        '<button class="btn sm" onclick="event.stopPropagation();editSummary(\'' + sid + '\')">editar</button>' +
        '<button class="btn danger sm" onclick="event.stopPropagation();delSummary(\'' + sid + '\')">x</button>' +
      '</td>' +
    '</tr>' +
    '<tr id="det-' + sid + '" style="display:none"><td colspan="8" style="padding:0">' +
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
      '<th>Drive</th>' +
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



function updateExpenseCategory(summaryId, expenseIndex, newCategory) {
  var s = db.summaries.find(function(x){ return x.id === summaryId; });
  if (!s || !s.ownExpenses || !s.ownExpenses[expenseIndex]) return;
  s.ownExpenses[expenseIndex].category = newCategory;
  saveAndSync();
}

function editSummary(id) {
  var s = db.summaries.find(function(x){ return x.id === id; });
  if (!s) return;

  // Remove any existing edit panel
  var existing = document.getElementById('edit-panel-' + id);
  if (existing) { existing.remove(); return; }

  var card = db.cards.find(function(c){ return c.id === s.cardId; }) || { name: s.cardName || '' };
  var cardOpts = db.cards.map(function(c){
    return '<option value="' + c.id + '"' + (c.id === s.cardId ? ' selected' : '') + '>' + c.name + '</option>';
  }).join('');

  var panel = document.createElement('tr');
  panel.id = 'edit-panel-' + id;
  panel.innerHTML = '<td colspan="8" style="padding:0">' +
    '<div style="background:var(--purple-light);padding:16px;border-bottom:1px solid var(--border)">' +
      '<div style="font-size:12px;font-weight:600;color:var(--purple);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">Editar resumen</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">' +
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:160px">' +
          '<label style="font-size:11px;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.4px">Tarjeta</label>' +
          '<select id="ep-card-' + id + '" style="font-size:13px;padding:7px 10px">' + cardOpts + '</select>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:130px">' +
          '<label style="font-size:11px;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.4px">Mes</label>' +
          '<input type="month" id="ep-month-' + id + '" value="' + (s.month || '') + '" style="font-size:13px;padding:7px 10px">' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:130px">' +
          '<label style="font-size:11px;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.4px">Vencimiento</label>' +
          '<input type="date" id="ep-venc-' + id + '" value="' + (s.vencimiento || '') + '" style="font-size:13px;padding:7px 10px">' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:120px">' +
          '<label style="font-size:11px;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.4px">Total $</label>' +
          '<input type="number" id="ep-total-' + id + '" value="' + (s.total || 0) + '" style="font-size:13px;padding:7px 10px">' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:110px">' +
          '<label style="font-size:11px;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.4px">Mínimo $</label>' +
          '<input type="number" id="ep-min-' + id + '" value="' + (s.minimo || 0) + '" style="font-size:13px;padding:7px 10px">' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:100px">' +
          '<label style="font-size:11px;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.4px">Total U$S</label>' +
          '<input type="number" id="ep-usd-' + id + '" value="' + (s.totalUSD || 0) + '" style="font-size:13px;padding:7px 10px">' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn primary" onclick="saveSummaryEdit(\'' + id + '\')">Guardar</button>' +
        '<button class="btn" onclick="document.getElementById(\'' + 'edit-panel-' + id + '\').remove()">Cancelar</button>' +
      '</div>' +
    '</div>' +
  '</td>';

  // Insert after the main row
  var mainRow = document.querySelector('[onclick*="toggleHistoricoRow(\'' + id + '\'"]');
  if (mainRow && mainRow.parentNode) {
    mainRow.parentNode.insertBefore(panel, mainRow.nextSibling);
  }
}

function saveSummaryEdit(id) {
  var s = db.summaries.find(function(x){ return x.id === id; });
  if (!s) return;

  var cardId = document.getElementById('ep-card-' + id).value;
  var card = db.cards.find(function(c){ return c.id === cardId; });

  s.cardId   = cardId;
  s.cardName = card ? card.name : s.cardName;
  s.month      = document.getElementById('ep-month-' + id).value;
  s.vencimiento = document.getElementById('ep-venc-' + id).value;
  s.total    = Number(document.getElementById('ep-total-' + id).value) || 0;
  s.minimo   = Number(document.getElementById('ep-min-' + id).value) || 0;
  s.totalUSD = Number(document.getElementById('ep-usd-' + id).value) || 0;

  saveAndSync();
  var panel = document.getElementById('edit-panel-' + id);
  if (panel) panel.remove();
  renderHistorico();
  renderDashboard();
}

function delSummary(id) {
  if (!confirm('Eliminar este resumen? Esta accion no se puede deshacer.')) return;
  var summary = db.summaries.find(function(s){ return s.id === id; });
  db.summaries = db.summaries.filter(function(s){ return s.id !== id; });
  saveAndSync();
  // Move Drive file to trash if exists
  if (summary && summary.driveFileId && useSheets && isAuthorized) {
    moveToTrashDrive(summary.driveFileId).then(function(ok) {
      if (!ok) console.warn('No se pudo mover a la papelera de Drive el archivo:', summary.driveFileId);
    });
  }
  renderHistorico();
}


// --- Reportes ---

var _chartDonut = null;
var _chartBarsCard = null;
var _chartLine = null;
var _chartStacked = null;
var _chartCuotas = null;

var CAT_COLORS = {
  'Supermercado':        '#7367f0',
  'Restaurantes / Comida': '#28c76f',
  'Nafta / Transporte':  '#00cfe8',
  'Servicios':           '#ff9f43',
  'Salud':               '#ea5455',
  'Ropa / Indumentaria': '#9e95f5',
  'Entretenimiento':     '#ff6b9d',
  'Viajes':              '#1de9b6',
  'Otros':               '#a49fbf',
};

function destroyChart(c) { if (c) { try { c.destroy(); } catch(e) {} } return null; }

function initReportes() {
  var now = new Date();
  var defaultYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var sel = document.getElementById('rep-month-sel');
  if (sel && !sel.value) sel.value = defaultYm;
  renderReportes();
}

function renderReportes() {
  var sel = document.getElementById('rep-month-sel');
  var now = new Date();
  var ym = (sel && sel.value) ? sel.value : now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var ms = db.summaries.filter(function(s){ return s.month === ym; });

  renderDonut(ms, ym);
  renderBarsCard(ms);
  renderTop10(ms);
  renderLine();
  renderStacked();
  renderCuotas();
}

function getAllExpenses(ms) {
  var all = [];
  ms.forEach(function(s) {
    (s.ownExpenses || []).forEach(function(e) {
      var isCredit = !!(e.isCredit || e.cr || e.c);
      if (!isCredit) all.push(e);
    });
  });
  return all;
}

function renderDonut(ms, ym) {
  var expenses = getAllExpenses(ms);
  var bycat = {};
  expenses.forEach(function(e) {
    var cat = e.category || e.cat || 'Otros';
    if (!bycat[cat]) bycat[cat] = 0;
    bycat[cat] += Number(e.amount || e.a || 0);
  });
  var labels = Object.keys(bycat);
  var data = labels.map(function(k){ return Math.round(bycat[k]); });
  var colors = labels.map(function(k){ return CAT_COLORS[k] || '#c8c5d7'; });

  _chartDonut = destroyChart(_chartDonut);
  var ctx = document.getElementById('chart-donut');
  if (!ctx) return;
  if (!labels.length) { ctx.parentElement.innerHTML = '<div class="empty">Sin datos para este mes</div>'; return; }

  _chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11, family: "'Public Sans'" }, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: function(c) { return ' $' + c.raw.toLocaleString('es-AR'); } } }
      }
    }
  });
}

function renderBarsCard(ms) {
  var byCard = {};
  ms.forEach(function(s) {
    var name = s.cardName || 'Tarjeta';
    var card = db.cards.find(function(c){ return c.id === s.cardId; });
    if (card) name = card.name;
    if (!byCard[name]) byCard[name] = 0;
    byCard[name] += Number(s.total || 0);
  });
  var labels = Object.keys(byCard);
  var data = labels.map(function(k){ return Math.round(byCard[k]); });

  _chartBarsCard = destroyChart(_chartBarsCard);
  var ctx = document.getElementById('chart-bars-card');
  if (!ctx) return;
  if (!labels.length) { ctx.parentElement.innerHTML = '<div class="empty">Sin datos para este mes</div>'; return; }

  _chartBarsCard = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: '#7367f0', borderRadius: 6 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c){ return ' $' + c.raw.toLocaleString('es-AR'); } } } },
      scales: { x: { ticks: { callback: function(v){ return '$' + (v/1000).toFixed(0) + 'k'; }, font: { size: 11 } }, grid: { color: '#e9e7f0' } }, y: { ticks: { font: { size: 11, family: "'Public Sans'" } }, grid: { display: false } } }
    }
  });
}

function renderTop10(ms) {
  var expenses = getAllExpenses(ms);
  expenses.sort(function(a, b){ return Number(b.amount||b.a||0) - Number(a.amount||a.a||0); });
  var top = expenses.slice(0, 10);
  var el = document.getElementById('rep-top10');
  if (!top.length) { el.innerHTML = '<div class="empty">Sin datos</div>'; return; }
  var max = Number(top[0].amount || top[0].a || 0);
  el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>#</th><th>Descripción</th><th>Categoría</th><th style="text-align:right">Monto</th></tr></thead><tbody>' +
    top.map(function(e, i) {
      var amt = Number(e.amount || e.a || 0);
      var cat = e.category || e.cat || 'Otros';
      var pct = max > 0 ? Math.round((amt / max) * 100) : 0;
      return '<tr>' +
        '<td style="color:var(--text2);font-size:12px">' + (i+1) + '</td>' +
        '<td><div style="font-weight:500;font-size:13px">' + (e.desc || e.d || '-') + '</div>' +
          '<div class="pb" style="width:120px"><div class="pf" style="width:' + pct + '%;background:' + (CAT_COLORS[cat]||'#7367f0') + '"></div></div></td>' +
        '<td><span class="tag">' + cat + '</span></td>' +
        '<td class="num" style="text-align:right">$' + Math.round(amt).toLocaleString('es-AR') + '</td>' +
      '</tr>';
    }).join('') +
  '</tbody></table></div>';
}

function renderLine() {
  // Get all months with data, sorted
  var monthSet = {};
  db.summaries.forEach(function(s){ if (s.month) monthSet[s.month] = true; });
  var months = Object.keys(monthSet).sort();
  if (months.length < 2) {
    var ctx = document.getElementById('chart-line');
    if (ctx) ctx.parentElement.innerHTML = '<div class="empty">Se necesitan al menos 2 meses de datos</div>';
    return;
  }
  var totals = months.map(function(m) {
    return Math.round(db.summaries.filter(function(s){ return s.month === m; }).reduce(function(a, s){ return a + Number(s.total||0); }, 0));
  });
  var labels = months.map(function(m) {
    return new Date(m + '-01').toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
  });

  _chartLine = destroyChart(_chartLine);
  var ctx = document.getElementById('chart-line');
  if (!ctx) return;

  _chartLine = new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Total $', data: totals, borderColor: '#7367f0', backgroundColor: 'rgba(115,103,240,.1)', fill: true, tension: 0.4, pointBackgroundColor: '#7367f0', pointRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c){ return ' $' + c.raw.toLocaleString('es-AR'); } } } },
      scales: { x: { ticks: { font: { size: 11 } }, grid: { color: '#e9e7f0' } }, y: { ticks: { callback: function(v){ return '$' + (v/1000).toFixed(0) + 'k'; }, font: { size: 11 } }, grid: { color: '#e9e7f0' } } }
    }
  });
}

function renderStacked() {
  var monthSet = {};
  db.summaries.forEach(function(s){ if (s.month) monthSet[s.month] = true; });
  var months = Object.keys(monthSet).sort();
  if (months.length < 2) {
    var ctx = document.getElementById('chart-stacked');
    if (ctx) ctx.parentElement.innerHTML = '<div class="empty">Se necesitan al menos 2 meses de datos</div>';
    return;
  }

  var cats = Object.keys(CAT_COLORS);
  var datasets = cats.map(function(cat) {
    return {
      label: cat,
      data: months.map(function(m) {
        var ms2 = db.summaries.filter(function(s){ return s.month === m; });
        var total = 0;
        ms2.forEach(function(s) {
          (s.ownExpenses||[]).forEach(function(e) {
            var isCredit = !!(e.isCredit || e.cr || e.c);
            if (!isCredit && (e.category||e.cat||'Otros') === cat) {
              total += Number(e.amount||e.a||0);
            }
          });
        });
        return Math.round(total);
      }),
      backgroundColor: CAT_COLORS[cat],
      borderRadius: 3,
      borderSkipped: false
    };
  }).filter(function(ds){ return ds.data.some(function(v){ return v > 0; }); });

  var labels = months.map(function(m) {
    return new Date(m + '-01').toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
  });

  _chartStacked = destroyChart(_chartStacked);
  var ctx = document.getElementById('chart-stacked');
  if (!ctx) return;

  _chartStacked = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 10, family: "'Public Sans'" }, boxWidth: 10, padding: 8 } }, tooltip: { callbacks: { label: function(c){ return ' ' + c.dataset.label + ': $' + c.raw.toLocaleString('es-AR'); } } } },
      scales: { x: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: false } }, y: { stacked: true, ticks: { callback: function(v){ return '$' + (v/1000).toFixed(0) + 'k'; }, font: { size: 11 } }, grid: { color: '#e9e7f0' } } }
    }
  });
}

function renderCuotas() {
  // Project installments: for each expense with cuotas, calculate remaining payments per month
  var now = new Date();
  var futureMonths = [];
  for (var i = 0; i < 12; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    futureMonths.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
  }

  var projections = {};
  futureMonths.forEach(function(m){ projections[m] = 0; });

  db.summaries.forEach(function(s) {
    (s.ownExpenses||[]).forEach(function(e) {
      var cuotas = e.cuotas || e.q;
      var cuotaActual = e.cuotaActual || e.qi;
      var amount = Number(e.amount || e.a || 0);
      if (!cuotas || !cuotaActual || cuotas <= 1) return;

      var remaining = cuotas - cuotaActual;
      if (remaining <= 0) return;

      // Starting from next month relative to summary month
      var summaryDate = new Date((s.month || s.uploadedAt || '').substring(0,7) + '-01');
      for (var i = 1; i <= remaining; i++) {
        var futureDate = new Date(summaryDate.getFullYear(), summaryDate.getMonth() + i, 1);
        var futureYm = futureDate.getFullYear() + '-' + String(futureDate.getMonth()+1).padStart(2,'0');
        if (projections[futureYm] !== undefined) {
          projections[futureYm] += amount;
        }
      }
    });
  });

  var labels = futureMonths.map(function(m) {
    return new Date(m + '-01').toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
  });
  var data = futureMonths.map(function(m){ return Math.round(projections[m]); });

  _chartCuotas = destroyChart(_chartCuotas);
  var ctx = document.getElementById('chart-cuotas');
  if (!ctx) return;

  if (data.every(function(v){ return v === 0; })) {
    ctx.parentElement.innerHTML = '<div class="empty">Sin consumos en cuotas registrados</div>';
    return;
  }

  _chartCuotas = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'Cuotas pendientes $', data: data, backgroundColor: 'rgba(115,103,240,.7)', borderColor: '#7367f0', borderWidth: 1, borderRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c){ return ' $' + c.raw.toLocaleString('es-AR'); } } } },
      scales: { x: { ticks: { font: { size: 11 } }, grid: { display: false } }, y: { ticks: { callback: function(v){ return '$' + (v/1000).toFixed(0) + 'k'; }, font: { size: 11 } }, grid: { color: '#e9e7f0' } } }
    }
  });
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
