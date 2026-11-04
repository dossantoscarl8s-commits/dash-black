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

function contarLeads(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const tipo of LEAD_TYPES) {
    const a = actions.find(x => x.action_type === tipo);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

module.exports = async (req, res) => {
  const token = process.env.META_TOKEN;
  if (!token) {
    res.status(500).json({ erro: 'META_TOKEN não configurado no Vercel.' });
    return;
  }

  const contas = CONTAS.filter(c => c.enabled);
  const batch = contas.map(c => ({
    method: 'GET',
    relative_url: `${c.adAccountId}/insights?level=account&date_preset=today&fields=actions,spend,account_name,account_currency`,
  }));

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

    const unidades = contas.map((c, i) => {
      const item = json[i];
      let parsed = null;
      try { parsed = item && item.body ? JSON.parse(item.body) : null; } catch (_) {}
      if (!item || item.code !== 200 || !parsed || parsed.error) {
        return {
          unidade: c.unidade,
          adAccountId: c.adAccountId,
          leads: null,
          gasto: null,
          erro: parsed?.error?.message || `Erro HTTP ${item?.code ?? '?'}`,
        };
      }
      const row = (parsed.data && parsed.data[0]) || {};
      return {
        unidade: c.unidade,
        adAccountId: c.adAccountId,
        leads: contarLeads(row.actions),
        gasto: row.spend != null ? Number(row.spend) : 0,
        moeda: row.account_currency || 'BRL',
        erro: null,
      };
    });

    // Cache curto na CDN do Vercel: várias telas abertas dividem a mesma consulta à Meta.
    res.setHeader('Cache-Control', 's-maxage=8, stale-while-revalidate=4');
    res.status(200).json({ atualizadoEm: new Date().toISOString(), unidades });
  } catch (e) {
    res.status(502).json({ erro: 'Falha ao consultar a Meta: ' + e.message });
  }
};
