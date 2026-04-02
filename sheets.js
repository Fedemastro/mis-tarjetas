// sheets.js — Google Sheets sync module

const SHEETS = {
  CARDS:          'cards',
  SUMMARIES:      'summaries',
  GASTOS:         'gastos',
  GASTOS_TERC:    'gastosTerceros',
  EXT_HOLDERS:    'extHolders',
  CATEGORIES:     'categories',
  CONFIG:         'config',
};

let gisInited = false;
let gapiInited = false;
let tokenClient = null;
let isAuthorized = false;

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// ─── Token persistence ─────────────────────────────────────────────────────

function saveToken(token) {
  if (!token) return;
  localStorage.setItem('gsheets_token', JSON.stringify({ ...token, saved_at: Date.now() }));
}

function loadSavedToken() {
  try {
    const raw = localStorage.getItem('gsheets_token');
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Token de Google dura 3600s — lo descartamos si pasaron más de 55 minutos
    if ((Date.now() - data.saved_at) / 1000 > 3300) {
      localStorage.removeItem('gsheets_token');
      return null;
    }
    return data;
  } catch { return null; }
}

function clearSavedToken() {
  localStorage.removeItem('gsheets_token');
}

// ─── Init ──────────────────────────────────────────────────────────────────

function sheetsInit(clientId, apiKey, onReady) {
  if (!clientId || !apiKey) { onReady(false); return; }

  gapi.load('client', async () => {
    try {
      await gapi.client.init({ apiKey, discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'] });
      gapiInited = true;
    } catch(e) { console.warn('gapi init error', e); onReady(false); return; }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) { console.warn('OAuth error', resp); return; }
        isAuthorized = true;
        saveToken(gapi.client.getToken());
        if (window._sheetsOnAuth) window._sheetsOnAuth();
      }
    });
    gisInited = true;

    // Intentar restaurar token guardado — evita pedir auth en cada recarga
    const saved = loadSavedToken();
    if (saved) {
      gapi.client.setToken(saved);
      isAuthorized = true;
      onReady(true);
      if (window._sheetsOnAuth) window._sheetsOnAuth();
    } else {
      onReady(true);
    }
  });
}

function sheetsSignIn() {
  if (!tokenClient) return;
  // Sin prompt si ya hubo una sesión previa — aparece un selector de cuenta en vez del flujo completo
  const saved = loadSavedToken();
  tokenClient.requestAccessToken({ prompt: saved ? '' : 'consent' });
}

function sheetsSignOut() {
  const token = gapi.client.getToken();
  if (token) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
    isAuthorized = false;
  }
  clearSavedToken();
}

// ─── Ensure sheet tabs exist ───────────────────────────────────────────────

async function ensureSheets(spreadsheetId) {
  try {
    const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const existing = meta.result.sheets.map(s => s.properties.title);
    const needed = Object.values(SHEETS).filter(s => !existing.includes(s));
    if (!needed.length) return;
    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: needed.map(title => ({ addSheet: { properties: { title } } })) }
    });
  } catch(e) { console.warn('ensureSheets error', e); }
}

// ─── Read / Write helpers ──────────────────────────────────────────────────

async function sheetRead(spreadsheetId, sheetName) {
  try {
    const resp = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:ZZ`,
    });
    return resp.result.values || [];
  } catch(e) {
    console.warn(`sheetRead error (${sheetName})`, e);
    return [];
  }
}

async function sheetWrite(spreadsheetId, sheetName, rows) {
  try {
    await gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A:ZZ` });
    if (!rows.length) return;
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      resource: { values: rows }
    });
  } catch(e) { console.warn(`sheetWrite error (${sheetName})`, e); }
}

// ─── Serializers ──────────────────────────────────────────────────────────

function cardsToRows(cards) {
  const h = ['id','name','bank','type','autoDebit'];
  return [h, ...cards.map(c => h.map(k => c[k] ?? ''))];
}
function rowsToCards(rows) {
  if (rows.length < 2) return [];
  const [h, ...data] = rows;
  return data.map(r => Object.fromEntries(h.map((k,i) => [k, r[i] ?? ''])));
}

function summariesToRows(summaries) {
  const h = ['id','cardId','cardName','month','vencimiento','minimo','total','totalUSD','ownExpenses','extensions','uploadedAt'];
  return [h, ...summaries.map(s => [
    s.id, s.cardId, s.cardName, s.month, s.vencimiento,
    s.minimo, s.total, s.totalUSD,
    JSON.stringify(s.ownExpenses || []),
    JSON.stringify(s.extensions || []),
    s.uploadedAt || ''
  ])];
}
function rowsToSummaries(rows) {
  if (rows.length < 2) return [];
  const [h, ...data] = rows;
  return data.map(r => {
    const o = Object.fromEntries(h.map((k,i) => [k, r[i] ?? '']));
    o.ownExpenses = safeJSON(o.ownExpenses, []);
    o.extensions  = safeJSON(o.extensions, []);
    o.minimo   = Number(o.minimo)   || 0;
    o.total    = Number(o.total)    || 0;
    o.totalUSD = Number(o.totalUSD) || 0;
    return o;
  });
}

function gastosToRows(gastos) {
  const h = ['id','desc','amount','cat','date','currency','month'];
  return [h, ...gastos.map(g => h.map(k => g[k] ?? ''))];
}
function rowsToGastos(rows) {
  if (rows.length < 2) return [];
  const [h, ...data] = rows;
  return data.map(r => { const o = Object.fromEntries(h.map((k,i) => [k, r[i] ?? ''])); o.amount = Number(o.amount)||0; return o; });
}

function gastosTercToRows(gt) {
  const h = ['id','holder','desc','amount','cardId','cardName','date','month'];
  return [h, ...gt.map(g => h.map(k => g[k] ?? ''))];
}
function rowsToGastosTer(rows) {
  if (rows.length < 2) return [];
  const [h, ...data] = rows;
  return data.map(r => { const o = Object.fromEntries(h.map((k,i) => [k, r[i] ?? ''])); o.amount = Number(o.amount)||0; return o; });
}

function extHoldersToRows(holders) {
  return [['id','name'], ...holders.map(h => [h.id, h.name])];
}
function rowsToExtHolders(rows) {
  if (rows.length < 2) return [];
  return rows.slice(1).map(r => ({ id: r[0]||'', name: r[1]||'' }));
}

function categoriesToRows(cats) {
  return [['category'], ...cats.map(c => [c])];
}
function rowsToCategories(rows) {
  if (rows.length < 2) return [];
  return rows.slice(1).map(r => r[0]).filter(Boolean);
}

function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ─── Push full DB to Sheets ────────────────────────────────────────────────

async function pushToSheets(spreadsheetId, db) {
  if (!isAuthorized || !spreadsheetId) return false;
  try {
    await ensureSheets(spreadsheetId);
    await Promise.all([
      sheetWrite(spreadsheetId, SHEETS.CARDS,       cardsToRows(db.cards)),
      sheetWrite(spreadsheetId, SHEETS.SUMMARIES,   summariesToRows(db.summaries)),
      sheetWrite(spreadsheetId, SHEETS.GASTOS,      gastosToRows(db.gastos)),
      sheetWrite(spreadsheetId, SHEETS.GASTOS_TERC, gastosTercToRows(db.gastosTerceros)),
      sheetWrite(spreadsheetId, SHEETS.EXT_HOLDERS, extHoldersToRows(db.extHolders)),
      sheetWrite(spreadsheetId, SHEETS.CATEGORIES,  categoriesToRows(db.categories)),
    ]);
    return true;
  } catch(e) { console.error('pushToSheets error', e); return false; }
}

// ─── Pull full DB from Sheets ──────────────────────────────────────────────

async function pullFromSheets(spreadsheetId) {
  if (!isAuthorized || !spreadsheetId) return null;
  try {
    await ensureSheets(spreadsheetId);
    const [cards, summaries, gastos, gastosTer, extHolders, categories] = await Promise.all([
      sheetRead(spreadsheetId, SHEETS.CARDS),
      sheetRead(spreadsheetId, SHEETS.SUMMARIES),
      sheetRead(spreadsheetId, SHEETS.GASTOS),
      sheetRead(spreadsheetId, SHEETS.GASTOS_TERC),
      sheetRead(spreadsheetId, SHEETS.EXT_HOLDERS),
      sheetRead(spreadsheetId, SHEETS.CATEGORIES),
    ]);
    return {
      cards:          rowsToCards(cards),
      summaries:      rowsToSummaries(summaries),
      gastos:         rowsToGastos(gastos),
      gastosTerceros: rowsToGastosTer(gastosTer),
      extHolders:     rowsToExtHolders(extHolders),
      categories:     rowsToCategories(categories).length
                      ? rowsToCategories(categories)
                      : ['Supermercado','Restaurantes / Comida','Nafta / Transporte','Servicios','Salud','Ropa / Indumentaria','Entretenimiento','Viajes','Otros'],
    };
  } catch(e) { console.error('pullFromSheets error', e); return null; }
}
