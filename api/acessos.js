// Rota serverless (Vercel): /api/acessos
// POST registra uma pessoa redirecionada por um link rastreado. GET devolve os totais para o modal.
// Os acessos ficam numa planilha Google, pelo Apps Script de planilha/acessos.gs.

const PLANILHA_URL = process.env.PLANILHA_URL || '';   // URL /exec do app da Web, só no Vercel

const LINKS = ['patos', 'natal'];
const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const ANUNCIO = ['campaign_name', 'adset_name', 'ad_name', 'campaign_id', 'adset_id', 'ad_id'];
const CAMPOS = [...UTMS, 'utm_id', ...ANUNCIO];
const COLUNAS = ['data', 'link', ...UTMS, 'cidade', 'uf'];   // planilha com o script antigo, sem cabeçalho na resposta
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const ROBOS = /bot\b|crawl|spider|facebookexternalhit|facebookcatalog|meta-external|facebot|whatsapp\/|preview|headless|lighthouse|curl|python|axios|node-fetch|okhttp|go-http|monitor/i;
const MAX_TEXTO = 200;
const DIA_MS = 864e5;

const texto = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXTO) : null);
const ehData = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const inicioDoDia = (data, dias = 0) => new Date(Date.parse(`${data}T00:00:00-03:00`) + dias * DIA_MS).toISOString();
const horaBrasil = iso => new Date(Date.parse(iso) - 3 * 3600 * 1000).getUTCHours();

// O Vercel informa a localização aproximada pelo IP, codificada na URL. O IP não é guardado.
function cabecalho(req, nome) {
  const v = req.headers[nome];
  if (!v) return null;
  try { return texto(decodeURIComponent(v)); } catch (_) { return texto(v); }
}

// Os links são para público do Brasil, e os verificadores da Meta se passam por navegador comum
// a partir de data centers no exterior. Linhas antigas sem país usam a UF; a coluna tipo marca robô.
function ehRobo(a) {
  if (a.tipo === 'robô') return true;
  if (a.pais) return a.pais !== 'BR';
  return Boolean(a.uf) && !UFS.includes(a.uf);
}

async function planilha(busca, opcoes) {
  const r = await fetch(PLANILHA_URL + busca, { ...opcoes, signal: AbortSignal.timeout(20000) });
  const corpo = await r.text();
  try { return JSON.parse(corpo); } catch (_) { throw new Error(`a planilha não respondeu como esperado (${r.status})`); }
}

function contar(lista, campos) {
  const grupos = new Map();
  for (const x of lista) {
    const chave = JSON.stringify(campos.map(c => x[c]));
    if (!grupos.has(chave)) grupos.set(chave, { ...Object.fromEntries(campos.map(c => [c, x[c]])), n: 0 });
    grupos.get(chave).n += 1;
  }
  return [...grupos.values()].sort((a, b) => b.n - a.n).slice(0, 50);
}

async function registrar(req, res) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') { res.status(403).json({ erro: 'Origem não permitida.' }); return; }
  let corpo;
  try { corpo = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch (_) { res.status(400).json({ erro: 'Corpo inválido.' }); return; }
  if (!LINKS.includes(corpo?.link)) { res.status(400).json({ erro: 'Link inválido.' }); return; }

  // Provável robô não é gravado.
  const ua = req.headers['user-agent'] || '';
  const pais = cabecalho(req, 'x-vercel-ip-country');
  if (!ua || ROBOS.test(ua) || corpo.automatizado === true || (pais && pais !== 'BR')) { res.status(204).end(); return; }

  const acesso = {
    link: corpo.link,
    cidade: cabecalho(req, 'x-vercel-ip-city'),
    uf: cabecalho(req, 'x-vercel-ip-country-region'),
    pais,
  };
  for (const k of CAMPOS) acesso[k] = texto(corpo[k]);
  const r = await planilha('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(acesso) });
  if (!r.ok) throw new Error('a planilha não confirmou a gravação');
  res.status(204).end();
}

async function resumir(req, res) {
  const { link = 'patos', de, ate } = req.query || {};
  if (!LINKS.includes(link)) { res.status(400).json({ erro: 'Link inválido.' }); return; }
  if ((de && !ehData(de)) || (ate && !ehData(ate))) { res.status(400).json({ erro: 'Data inválida.' }); return; }
  const q = new URLSearchParams({ link });
  if (de) q.set('de', inicioDoDia(de));
  if (ate) q.set('ate', inicioDoDia(ate, 1));
  const { linhas, colunas = COLUNAS } = await planilha('?' + q);
  if (!Array.isArray(linhas)) throw new Error('a planilha não devolveu os acessos');

  const pessoas = linhas
    .map(l => {
      const a = Object.fromEntries([...CAMPOS, 'cidade', 'uf', 'pais', 'tipo'].map(c => [c, l[colunas.indexOf(c)] || null]));
      a.criado_em = l[0];
      return a;
    })
    .filter(a => !ehRobo(a))
    .map(({ pais, tipo, ...a }) => a);
  res.status(200).json({
    total: pessoas.length,
    horas: contar(pessoas.map(a => ({ hora: horaBrasil(a.criado_em) })), ['hora']),
    utms: contar(pessoas, UTMS),
    anuncios: contar(pessoas.filter(a => ANUNCIO.some(c => a[c])), ANUNCIO),
    cidades: contar(pessoas, ['cidade', 'uf']),
    ultimos: pessoas.slice(-100).reverse(),
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) { res.status(405).json({ erro: 'Método não permitido.' }); return; }
  if (!PLANILHA_URL) { res.status(503).json({ erro: 'Rastreio ainda não configurado: falta PLANILHA_URL no Vercel.' }); return; }
  try {
    await (req.method === 'POST' ? registrar : resumir)(req, res);
  } catch (e) {
    res.status(502).json({ erro: 'Falha no rastreio: ' + e.message });
  }
};
