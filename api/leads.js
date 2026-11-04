// Rota serverless (Vercel): GET /api/leads
// Busca os leads de hoje das contas de anúncio em UMA chamada (Graph API batch).
// O token fica só no servidor, na variável de ambiente META_TOKEN.

const CONTAS = require('../lib/contas');

const GRAPH_VERSION = process.env.META_API_VERSION || 'v24.0';

// Tipos de ação contados como lead, em ordem de prioridade (o primeiro encontrado vence,
// para não contar o mesmo lead duas vezes). Pode ser sobrescrito por LEAD_ACTION_TYPES.
const LEAD_TYPES = (process.env.LEAD_ACTION_TYPES ||
  'onsite_conversion.messaging_conversation_started_7d,lead,onsite_conversion.lead_grouped,leadgen_grouped,offsite_conversion.fb_pixel_lead')
  .split(',').map(s => s.trim()).filter(Boolean);

// Conversas iniciadas e quantas chegaram a 2, 3 e 5 mensagens do cliente.
const TIPO_CONVERSA = 'onsite_conversion.messaging_conversation_started_7d';

// A Meta já usou mais de um nome para essas faixas; aceita as duas grafias.
const faixaMensagens = n => new RegExp(`messaging_user(_conversation)?_depth_${n}_message_send$`);

function contarLeads(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const tipo of LEAD_TYPES) {
    const a = actions.find(x => x.action_type === tipo);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

function valorAcao(actions, tipo) {
  if (!Array.isArray(actions)) return 0;
  const a = actions.find(x => x.action_type === tipo);
  return a ? Number(a.value) || 0 : 0;
}

function valorFaixa(actions, n) {
  if (!Array.isArray(actions)) return 0;
  const regra = faixaMensagens(n);
  const a = actions.find(x => regra.test(x.action_type));
  return a ? Number(a.value) || 0 : 0;
}

function resumirCampanha(row) {
  const conversas = valorAcao(row.actions, TIPO_CONVERSA);
  const m2 = valorFaixa(row.actions, 2);
  const m3 = valorFaixa(row.actions, 3);
  const m5 = valorFaixa(row.actions, 5);
  return {
    id: row.campaign_id,
    nome: row.campaign_name || 'Sem nome',
    leads: contarLeads(row.actions),
    gasto: row.spend != null ? Number(row.spend) : 0,
    conversas, m2, m3, m5,
    // A Meta não informa o total de mensagens: este é o mínimo garantido pelas faixas acima.
    msgs: conversas + m2 + m3 + 2 * m5,
  };
}

module.exports = async (req, res) => {
  const token = process.env.META_TOKEN;
  if (!token) {
    res.status(500).json({ erro: 'META_TOKEN não configurado no Vercel.' });
    return;
  }

  const contas = CONTAS.filter(c => c.enabled);
  // Duas consultas por conta: resultados de hoje e campanhas ativas agora. Os totais da
  // unidade continuam somando tudo; o status só marca cada campanha com `ativa`.
  const batch = contas.flatMap(c => [
    {
      method: 'GET',
      relative_url: `${c.adAccountId}/insights?level=campaign&date_preset=today&limit=200&fields=campaign_id,campaign_name,actions,spend,account_currency`,
    },
    {
      method: 'GET',
      relative_url: `${c.adAccountId}/campaigns?effective_status=${encodeURIComponent('["ACTIVE"]')}&fields=id&limit=500`,
    },
  ]);

  try {
    const body = new URLSearchParams({
      access_token: token,
      include_headers: 'false',
      batch: JSON.stringify(batch),
    });
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/`, { method: 'POST', body });
    const json = await r.json();

    if (!Array.isArray(json)) {
      const msg = json?.error?.message || 'Resposta inesperada da Meta';
      res.status(502).json({ erro: msg, codigo: json?.error?.code });
      return;
    }

    const lerItem = item => {
      try { return item && item.body ? JSON.parse(item.body) : null; } catch (_) { return null; }
    };

    // Diagnóstico: tipos de mensagem que a Meta devolveu hoje, com o total de cada um.
    const tiposMensagem = {};

    const unidades = contas.map((c, i) => {
      const item = json[i * 2];
      const parsed = lerItem(item);
      if (!item || item.code !== 200 || !parsed || parsed.error) {
        return {
          unidade: c.unidade,
          adAccountId: c.adAccountId,
          leads: null,
          gasto: null,
          campanhas: [],
          erro: parsed?.error?.message || `Erro HTTP ${item?.code ?? '?'}`,
        };
      }
      // Se o status falhar, `ativa` fica null e a campanha segue visível, com o erro nos logs.
      const itemStatus = json[i * 2 + 1];
      const status = lerItem(itemStatus);
      const statusOk = itemStatus?.code === 200 && Array.isArray(status?.data);
      const ativas = new Set(statusOk ? status.data.map(x => x.id) : []);

      const linhas = parsed.data || [];
      linhas.flatMap(row => row.actions || [])
        .filter(a => /messag|depth/i.test(a.action_type))
        .forEach(a => { tiposMensagem[a.action_type] = (tiposMensagem[a.action_type] || 0) + (Number(a.value) || 0); });
      const campanhas = linhas.map(row => ({
        ...resumirCampanha(row),
        ativa: statusOk ? ativas.has(row.campaign_id) : null,
      }));
      const somar = campo => campanhas.reduce((s, x) => s + x[campo], 0);
      return {
        unidade: c.unidade,
        adAccountId: c.adAccountId,
        leads: somar('leads'),
        gasto: somar('gasto'),
        conversas: somar('conversas'),
        msgs: somar('msgs'),
        moeda: linhas[0]?.account_currency || 'BRL',
        campanhas,
        erro: null,
        erroStatus: statusOk ? null : (status?.error?.message || 'Falha ao consultar o status das campanhas'),
      };
    });

    // Cache curto na CDN do Vercel: várias telas abertas dividem a mesma consulta à Meta.
    res.setHeader('Cache-Control', 's-maxage=8, stale-while-revalidate=4');
    res.status(200).json({ atualizadoEm: new Date().toISOString(), unidades, tiposMensagem });
  } catch (e) {
    res.status(502).json({ erro: 'Falha ao consultar a Meta: ' + e.message });
  }
};
