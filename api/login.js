// Rota serverless (Vercel): POST /api/login entra, DELETE /api/login sai.
// Usa LEADS_USUARIO, LEADS_SENHA e SESSAO_SEGREDO; sem elas, ninguém entra.

const { criarCookie, limparCookie, iguais } = require('../lib/sessao');

const MAX_FALHAS = 5;
const BLOQUEIO = 15 * 60 * 1000;
const ESPERA_FALHA = 500;
const falhas = new Map();   // {ip: {n, ate}}

const espera = ms => new Promise(r => setTimeout(r, ms));
const ipDe = req => String(req.headers['x-forwarded-for'] || 'desconhecido').split(',')[0].trim();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', limparCookie());
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  const { LEADS_USUARIO, LEADS_SENHA, SESSAO_SEGREDO } = process.env;
  if (!LEADS_USUARIO || !LEADS_SENHA || !SESSAO_SEGREDO) {
    res.status(503).json({ erro: 'Login não configurado no Vercel.' });
    return;
  }

  const ip = ipDe(req);
  const registro = falhas.get(ip);
  if (registro && registro.ate > Date.now()) {
    res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' });
    return;
  }

  const { usuario = '', senha = '' } = req.body || {};
  const usuarioOk = iguais(usuario, LEADS_USUARIO);
  const senhaOk = iguais(senha, LEADS_SENHA);
  if (!usuarioOk || !senhaOk) {
    const n = (registro?.n || 0) + 1;
    falhas.set(ip, { n: n >= MAX_FALHAS ? 0 : n, ate: n >= MAX_FALHAS ? Date.now() + BLOQUEIO : 0 });
    await espera(ESPERA_FALHA);
    res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    return;
  }

  falhas.delete(ip);
  res.setHeader('Set-Cookie', criarCookie());
  res.status(204).end();
};
