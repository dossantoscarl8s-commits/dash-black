// Rota serverless (Vercel): /api/whatsapp
// GET com hub.* confirma o webhook na Meta; POST recebe as mensagens; GET com login lista os leads.
// Não chama a API da Meta: só recebe o que ela envia.
//
// TESTE: os leads ficam na memória do servidor e somem quando ele reinicia. Trocar por Supabase
// antes de usar em produção.

const crypto = require('crypto');
const { sessaoValida, iguais } = require('../lib/sessao');

const MAX_LEADS = 500;
const leads = new Map();   // {número: lead}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', parte => partes.push(parte));
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

function assinaturaValida(corpo, assinatura, segredo) {
  if (!assinatura) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
  return iguais(assinatura, esperada);
}

// Cada número é um lead: novas mensagens só atualizam o contador.
function registrarMensagens(payload) {
  for (const entrada of payload.entry || []) {
    for (const mudanca of entrada.changes || []) {
      const { messages = [], contacts = [] } = mudanca.value || {};
      for (const msg of messages) {
        if (!msg.from) continue;
        const contato = contacts.find(c => c.wa_id === msg.from);
        const emMs = (Number(msg.timestamp) || Date.now() / 1000) * 1000;
        const lead = leads.get(msg.from);
        if (lead) {
          lead.mensagens += 1;
          lead.ultima = emMs;
          continue;
        }
        leads.set(msg.from, {
          whatsapp: msg.from,
          nome: contato?.profile?.name || null,
          em: emMs,
          ultima: emMs,
          mensagens: 1,
          anuncio: msg.referral?.source_id || null,
          origem: msg.referral?.headline || null,
        });
        if (leads.size > MAX_LEADS) leads.delete(leads.keys().next().value);
      }
    }
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET } = process.env;

  if (req.method === 'GET' && req.query?.['hub.mode']) {
    const token = req.query['hub.verify_token'] || '';
    if (WHATSAPP_VERIFY_TOKEN && req.query['hub.mode'] === 'subscribe' && iguais(token, WHATSAPP_VERIFY_TOKEN)) {
      res.status(200).send(String(req.query['hub.challenge'] || ''));
      return;
    }
    res.status(403).json({ erro: 'Token inválido.' });
    return;
  }

  if (req.method === 'GET') {
    if (!sessaoValida(req)) {
      res.status(401).json({ erro: 'Faça login para ver os leads.' });
      return;
    }
    res.status(200).json({ leads: [...leads.values()] });
    return;
  }

  if (req.method === 'POST') {
    if (!WHATSAPP_APP_SECRET) {
      res.status(503).json({ erro: 'Webhook não configurado no Vercel.' });
      return;
    }
    const corpo = await lerCorpo(req);
    if (!assinaturaValida(corpo, req.headers['x-hub-signature-256'], WHATSAPP_APP_SECRET)) {
      res.status(401).json({ erro: 'Assinatura inválida.' });
      return;
    }
    try {
      registrarMensagens(JSON.parse(corpo.toString('utf8')));
    } catch (_) {
      res.status(400).json({ erro: 'Corpo inválido.' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ erro: 'Método não permitido.' });
};
