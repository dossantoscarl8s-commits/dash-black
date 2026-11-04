// Rota serverless (Vercel): GET /api/leads
// Busca os leads de hoje das contas de anúncio em UMA chamada (Graph API batch).
// O token fica só no servidor, na variável de ambiente META_TOKEN.

const CONTAS = require('../lib/contas');

const GRAPH_VERSION = process.env.META_API_VERSION || 'v24.0';

// O status das campanhas muda pouco. Consultar a cada 5 min, e não a cada atualização, poupa o
// limite de chamadas da Meta. Se a consulta falhar, vale o último status conhecido da conta.
const VALIDADE_STATUS = 5 * 60 * 1000;
let statusGuardado = null;   // {em, porConta: Map(adAccountId → {ativas} ou {erro})}

// Tipos de ação contados como lead, em ordem de prioridade (o primeiro encontrado vence,
// para não contar o mesmo lead duas vezes). Pode ser sobrescrito por LEAD_ACTION_TYPES.
const LEAD_TYPES = (process.env.LEAD_ACTION_TYPES ||
  'onsite_conversion.messaging_conversation_started_7d,lead,onsite_conversion.lead_grouped,leadgen_grouped,offsite_conversion.fb_pixel_lead')
  .split(',').map(s => s.trim()).filter(Boolean);

// Conversas iniciadas, quantas chegaram a 3 mensagens do cliente e quantas foram bloqueadas.
const TIPO_CONVERSA = 'onsite_conversion.messaging_conversation_started_7d';
const TIPO_MSG_3 = 'onsite_conversion.messaging_user_depth_3_message_send';
const TIPO_BLOQUEIO = 'onsite_conversion.messaging_block';

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

function resumirCampanha(row) {
  return {
    id: row.campaign_id,
    nome: row.campaign_name || 'Sem nome',
    leads: contarLeads(row.actions),
    gasto: row.spend != null ? Number(row.spend) : 0,
    conversas: valorAcao(row.actions, TIPO_CONVERSA),
    m3: valorAcao(row.actions, TIPO_MSG_3),
    bloqueios: valorAcao(row.actions, TIPO_BLOQUEIO),
  };
}

module.exports = async (req, res) => {
  const token = process.env.META_TOKEN;
  if (!token) {
    res.status(500).json({ erro: 'META_TOKEN não configurado no Vercel.' });
    return;
  }

  const contas = CONTAS.filter(c => c.enabled);
  const agora = Date.now();
  const statusValido = statusGuardado && agora - statusGuardado.em < VALIDADE_STATUS;

  // Resultados de hoje de cada conta e, quando vencido, o status. Os totais da unidade
  // continuam somando tudo; o status só marca cada campanha com `ativa`.
  const batch = [
    ...contas.map(c => ({
      method: 'GET',
      relative_url: `${c.adAccountId}/insights?level=campaign&date_preset=today&limit=200&fields=campaign_id,campaign_name,actions,spend,account_currency`,
    })),
    ...(statusValido ? [] : contas.map(c => ({
      method: 'GET',
      relative_url: `${c.adAccountId}/campaigns?effective_status=${encodeURIComponent('["ACTIVE"]')}&fields=id&limit=500`,
    }))),
  ];

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

    if (!statusValido) {
      const anterior = statusGuardado?.porConta;
      statusGuardado = {
        em: agora,
        porConta: new Map(contas.map((c, i) => {
          const item = json[contas.length + i];
          const corpo = lerItem(item);
          const novo = item?.code === 200 && Array.isArray(corpo?.data)
            ? { ativas: new Set(corpo.data.map(x => x.id)) }
            : { erro: corpo?.error?.message || 'Falha ao consultar o status das campanhas' };
          return [c.adAccountId, novo.ativas ? novo : (anterior?.get(c.adAccountId)?.ativas ? anterior.get(c.adAccountId) : novo)];
        })),
      };
    }

    const unidades = contas.map((c, i) => {
      const item = json[i];
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
      const { ativas, erro: erroStatus = null } = statusGuardado.porConta.get(c.adAccountId);

      const linhas = parsed.data || [];
      const campanhas = linhas.map(row => ({
        ...resumirCampanha(row),
        ativa: ativas ? ativas.has(row.campaign_id) : null,
      }));
      const somar = campo => campanhas.reduce((s, x) => s + x[campo], 0);
      return {
        unidade: c.unidade,
        adAccountId: c.adAccountId,
        leads: somar('leads'),
        gasto: somar('gasto'),
        conversas: somar('conversas'),
        m3: somar('m3'),
        bloqueios: somar('bloqueios'),
        moeda: linhas[0]?.account_currency || 'BRL',
        campanhas,
        erro: null,
        erroStatus,
      };
    });

    // Cache curto na CDN do Vercel: várias telas abertas dividem a mesma consulta à Meta.
    res.setHeader('Cache-Control', 's-maxage=8, stale-while-revalidate=4');
    res.status(200).json({ atualizadoEm: new Date().toISOString(), unidades });
  } catch (e) {
    res.status(502).json({ erro: 'Falha ao consultar a Meta: ' + e.message });
  }
};
