// Cole em Extensões > Apps Script da planilha e implante como app da Web.
// Colunas: data (UTC), link, utm_source, utm_medium, utm_campaign, utm_content, utm_term, cidade, uf
const CAMPOS = ['link', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'cidade', 'uf'];

function aba() {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (s.getLastRow() === 0) s.appendRow(['data'].concat(CAMPOS));
  return s;
}

function responder(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  // O apóstrofo mantém tudo como texto, sem virar fórmula.
  const linha = [new Date().toISOString()].concat(CAMPOS.map(c => String(d[c] || '').slice(0, 200)));
  const trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try { aba().appendRow(linha.map(v => v ? "'" + v : '')); SpreadsheetApp.flush(); }
  finally { trava.releaseLock(); }
  return responder({ ok: true });
}

function doGet(e) {
  const p = e.parameter;
  const linhas = aba().getDataRange().getValues().slice(1)
    .filter(l => l[1] === p.link && (!p.de || l[0] >= p.de) && (!p.ate || l[0] < p.ate));
  return responder({ linhas: linhas });
}
