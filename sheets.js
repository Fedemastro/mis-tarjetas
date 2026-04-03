// sheets.js — Google Sheets sync module

const SHEETS = {
  CARDS:          'cards',
  SUMMARIES:      'summaries',
  GASTOS:         'gastos',
  GASTOS_TERC:    'gastosTerceros',
  EXT_HOLDERS:    'extHolders',
  CATEGORIES:     'categories',
  CONFIG:         'config',
  PAYMENTS:        'payments',
};

let gisInited = false;
let gapiInited = false;
let tokenClient = null;
let isAuthorized = false;

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

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


// ─── Google Drive file upload ──────────────────────────────────────────────

async function uploadToDrive(fileName, fileBase64, mimeType, folderPath) {
  if (!isAuthorized) return null;
  try {
    // Find or create folder structure: Mis Tarjetas / Resumenes / YYYY-MM
    const rootFolderId = await findOrCreateFolder('Mis Tarjetas', null);
    const subFolderId  = await findOrCreateFolder('Resumenes', rootFolderId);
    const monthFolder  = await findOrCreateFolder(folderPath, subFolderId);

    // Upload file using multipart
    const boundary = 'misttarjetas_boundary';
    const metadata = JSON.stringify({ name: fileName, parents: [monthFolder] });

    // Decode base64 to binary
    const binaryStr = atob(fileBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    // Build multipart body
    const metaPart = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n';
    const filePart = '--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\nContent-Transfer-Encoding: base64\r\n\r\n' + fileBase64 + '\r\n--' + boundary + '--';
    const body = metaPart + filePart;

    const token = gapi.client.getToken();
    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token.access_token,
        'Content-Type': 'multipart/related; boundary=' + boundary,
      },
      body: body
    });
    const data = await resp.json();
    return data.id ? { id: data.id, link: data.webViewLink } : null;
  } catch(e) {
    console.warn('Drive upload error', e);
    return null;
  }
}


async function moveToTrashDrive(fileId) {
  if (!isAuthorized || !fileId) return false;
  try {
    const token = gapi.client.getToken();
    // Move to trash (recoverable)
    const resp = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trashed: true })
    });
    return resp.ok;
  } catch(e) {
    console.warn('Drive trash error', e);
    return false;
  }
}

async function findOrCreateFolder(name, parentId) {
  const token = gapi.client.getToken();
  // Search for existing folder
  let q = "mimeType='application/vnd.google-apps.folder' and name='" + name.replace(/'/g, "\'") + "' and trashed=false";
  if (parentId) q += " and '" + parentId + "' in parents";

  const searchResp = await fetch(
    'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id)',
    { headers: { 'Authorization': 'Bearer ' + token.access_token } }
  );
  const searchData = await searchResp.json();
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;

  // Create folder
  const meta = { name: name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify(meta)
  });
  const createData = await createResp.json();
  return createData.id;
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

function compressExpenses(expenses) {
  // Store only essential fields using compact keys to stay within Sheets 50k char limit
  return (expenses || []).map(function(e) {
    var c = {
      d: (e.desc || e.d || '').substring(0, 30),
      a: e.amount || e.a || 0,
      cu: e.currency || e.cu || 'ARS',
      cat: (e.category || e.cat || 'Otros').substring(0, 20),
      dt: e.date || e.dt || ''
    };
    if (e.isCredit || e.c) c.cr = 1;
    if (e.cuotas || e.q) { c.q = e.cuotas || e.q; c.qi = e.cuotaActual || e.qi || 1; }
    return c;
  });
}

function compressExtensions(extensions) {
  return (extensions || []).map(function(ext) {
    return {
      holder: ext.holder || '',
      total: ext.total || 0,
      totalUSD: ext.totalUSD || 0,
      items: compressExpenses(ext.items || [])
    };
  });
}

function summariesToRows(summaries) {
  const h = ['id','cardId','cardName','month','vencimiento','minimo','total','totalUSD','ownExpenses','extensions','uploadedAt','driveFileId','driveLink'];
  return [h, ...summaries.map(s => {
    var exp = JSON.stringify(compressExpenses(s.ownExpenses));
    var ext = JSON.stringify(compressExtensions(s.extensions));
    // Truncate if still too long (Sheets limit ~50k chars per cell)
    if (exp.length > 45000) exp = exp.substring(0, 45000) + '...truncated]';
    if (ext.length > 45000) ext = ext.substring(0, 45000) + '...truncated]';
    return [
      s.id, s.cardId, s.cardName, s.month, s.vencimiento,
      s.minimo, s.total, s.totalUSD,
      exp, ext,
      s.uploadedAt || '',
      s.driveFileId || '',
      s.driveLink || ''
    ];
  })];
}
function rowsToSummaries(rows) {
  if (rows.length < 2) return [];
  const [h, ...data] = rows;
  const results = [];
  for (const r of data) {
    try {
      const o = Object.fromEntries(h.map((k,i) => [k, r[i] ?? '']));
      o.ownExpenses = safeJSON(o.ownExpenses, []);
      o.extensions  = safeJSON(o.extensions, []);
      o.minimo   = Number(o.minimo)   || 0;
      o.total    = Number(o.total)    || 0;
      o.totalUSD = Number(o.totalUSD) || 0;
      o.driveFileId = o.driveFileId || null;
      o.driveLink   = o.driveLink   || null;
      if (o.id) results.push(o);
    } catch(e) {
      console.warn('Error parsing summary row:', r, e);
    }
  }
  return results;
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
      sheetWrite(spreadsheetId, SHEETS.PAYMENTS,    paymentsToRows(db.payments || {})),
    ]);
    return true;
  } catch(e) { console.error('pushToSheets error', e); return false; }
}

// ─── Pull full DB from Sheets ──────────────────────────────────────────────

async function pullFromSheets(spreadsheetId) {
  if (!isAuthorized || !spreadsheetId) return null;
  try {
    await ensureSheets(spreadsheetId);
    const [cards, summaries, gastos, gastosTer, extHolders, categories, payments] = await Promise.all([
      sheetRead(spreadsheetId, SHEETS.CARDS),
      sheetRead(spreadsheetId, SHEETS.SUMMARIES),
      sheetRead(spreadsheetId, SHEETS.GASTOS),
      sheetRead(spreadsheetId, SHEETS.GASTOS_TERC),
      sheetRead(spreadsheetId, SHEETS.EXT_HOLDERS),
      sheetRead(spreadsheetId, SHEETS.CATEGORIES),
      sheetRead(spreadsheetId, SHEETS.PAYMENTS),
    ]);
    return {
      cards:          rowsToCards(cards),
      summaries:      rowsToSummaries(summaries),
      gastos:         rowsToGastos(gastos),
      gastosTerceros: rowsToGastosTer(gastosTer),
      extHolders:     rowsToExtHolders(extHolders),
      payments:       rowsToPayments(payments),
      categories:     rowsToCategories(categories).length
                      ? rowsToCategories(categories)
                      : ['Supermercado','Restaurantes / Comida','Nafta / Transporte','Servicios','Salud','Ropa / Indumentaria','Entretenimiento','Viajes','Otros'],
    };
  } catch(e) { console.error('pullFromSheets error', e); return null; }
}

function paymentsToRows(payments) {
  const rows = [['summaryId','ars','usd','full']];
  Object.keys(payments).forEach(id => {
    const p = payments[id];
    rows.push([id, p.ars||'', p.usd||'', p.full?'1':'0']);
  });
  return rows;
}
function rowsToPayments(rows) {
  if (!rows || rows.length < 2) return {};
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0]) result[r[0]] = { ars: r[1]||'', usd: r[2]||'', full: r[3]==='1' };
  }
  return result;
}
