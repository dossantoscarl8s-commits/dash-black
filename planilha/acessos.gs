// Cole em Extensões > Apps Script da planilha e implante como app da Web.
// A primeira linha da planilha define as colunas. Campos novos viram colunas sozinhos.
const INICIAIS = ['data', 'link', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'cidade', 'uf'];
const MAX_COLUNAS = 60;

function aba() {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (s.getLastRow() === 0) s.appendRow(INICIAIS);
  return s;
}

function responder(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  const trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try {
    const s = aba();
    const colunas = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(String);
    Object.keys(d).forEach(c => {
      if (colunas.indexOf(c) < 0 && /^[a-z_]{1,30}$/.test(c) && colunas.length < MAX_COLUNAS) {
        colunas.push(c);
        s.getRange(1, colunas.length).setValue(c);
      }
    });
    d.data = new Date().toISOString();
    // O apóstrofo mantém tudo como texto, sem virar fórmula.
    s.appendRow(colunas.map(c => d[c] ? "'" + String(d[c]).slice(0, 200) : ''));
    SpreadsheetApp.flush();
  } finally { trava.releaseLock(); }
  return responder({ ok: true });
}

function doGet(e) {
  const p = e.parameter;
  const tudo = aba().getDataRange().getValues();
  const linhas = tudo.slice(1)
    .filter(l => l[1] === p.link && (!p.de || l[0] >= p.de) && (!p.ate || l[0] < p.ate));
  return responder({ colunas: tudo[0], linhas: linhas });
}
