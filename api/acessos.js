// Rota serverless (Vercel): /api/acessos
// POST registra um acesso ao link rastreado. GET devolve os totais para o modal do painel.
// A chave do Supabase fica só no servidor, em SUPABASE_URL e SUPABASE_SECRET_KEY.

const LINKS = ['patos'];
const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const MAX_TEXTO = 200;

const texto = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXTO) : null);
const ehData = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// O Vercel informa a cidade aproximada pelo IP, codificada na URL. O IP não é guardado.
function cabecalho(req, nome) {
  const v = req.headers[nome];
  if (!v) return null;
  try { return texto(decodeURIComponent(v)); } catch (_) { return texto(v); }
}

function supabase(caminho, corpo) {
  const chave = process.env.SUPABASE_SECRET_KEY;
  const headers = { apikey: chave, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  if (!chave.startsWith('sb_')) headers.Authorization = `Bearer ${chave}`;   // chave service_role antiga (JWT)
  return fetch(`${process.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${caminho}`, {
    method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(8000),
  });
}

async function registrar(req, res) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') { res.status(403).json({ erro: 'Origem não permitida.' }); return; }
  let corpo;
  try { corpo = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch (_) { res.status(400).json({ erro: 'Corpo inválido.' }); return; }
  if (!LINKS.includes(corpo?.link)) { res.status(400).json({ erro: 'Link inválido.' }); return; }

  const acesso = {
    link: corpo.link,
    cidade: cabecalho(req, 'x-vercel-ip-city'),
    uf: cabecalho(req, 'x-vercel-ip-country-region'),
  };
  for (const k of UTMS) acesso[k] = texto(corpo[k]);
  const r = await supabase('acessos', acesso);
  if (!r.ok) throw new Error(`banco respondeu ${r.status}`);
  res.status(204).end();
}

async function resumir(req, res) {
  const { link = 'patos', de, ate } = req.query || {};
  if (!LINKS.includes(link)) { res.status(400).json({ erro: 'Link inválido.' }); return; }
  if ((de && !ehData(de)) || (ate && !ehData(ate))) { res.status(400).json({ erro: 'Data inválida.' }); return; }
  const r = await supabase('rpc/resumo_acessos', { p_link: link, p_de: de || null, p_ate: ate || null });
  if (!r.ok) throw new Error(`banco respondeu ${r.status}`);
  res.status(200).json(await r.json());
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) { res.status(405).json({ erro: 'Método não permitido.' }); return; }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    res.status(503).json({ erro: 'Rastreio ainda não configurado: faltam SUPABASE_URL e SUPABASE_SECRET_KEY no Vercel.' });
    return;
  }
  try {
    await (req.method === 'POST' ? registrar : resumir)(req, res);
  } catch (e) {
    res.status(502).json({ erro: 'Falha no rastreio: ' + e.message });
  }
};
