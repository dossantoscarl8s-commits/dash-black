// Rota serverless (Vercel): GET /api/estrategia
// Orçamento consumido, alcance e frequência por unidade e resultado por anúncio.
// É mais pesada que /api/leads, por isso só roda com a tela aberta e fica mais tempo em cache.

const CONTAS = require('../lib/contas');

const GRAPH_VERSION = process.env.META_API_VERSION || 'v24.0';
const TAG_CAMPANHA = '[MENSAGENS]';
const TIPO_CONVERSA = 'onsite_conversion.messaging_conversation_started_7d';
const TIPO_MSG_3 = 'onsite_conversion.messaging_user_depth_3_message_send';
const LIMITE_BATCH = 50;
const ATIVAS = encodeURIComponent('["ACTIVE"]');

const campos = texto => encodeURIComponent(texto);

// Cinco consultas por conta, sempre nesta ordem.
const consultasDaConta = id => [
  `${id}/insights?level=account&date_preset=today&fields=${campos('reach,frequency')}`,
  `${id}/insights?level=account&date_preset=last_7d&fields=${campos('reach,frequency')}`,
  `${id}/campaigns?effective_status=${ATIVAS}&limit=500&fields=${campos('id,name,daily_budget,insights.date_preset(today){spend}')}`,
  `${id}/adsets?effective_status=${ATIVAS}&limit=500&fields=${campos('campaign_id,daily_budget,start_time,end_time')}`,
  `${id}/ads?effective_status=${ATIVAS}&limit=300&fields=${campos('id,name,campaign_id,insights.date_preset(today){spend,impressions,ctr,actions}')}`,
];

function valorAcao(actions, tipo) {
  if (!Array.isArray(actions)) return 0;
  const a = actions.find(x => x.action_type === tipo);
  return a ? Number(a.value) || 0 : 0;
}

const numero = v => (v != null ? Number(v) : null);

const rastreada = campanha => (campanha.name || '').toUpperCase().includes(TAG_CAMPANHA);

// Conjunto ativo na Meta pode estar agendado ou já encerrado: vale só o que está no período hoje.
function noPeriodo(conjunto, agora) {
  const inicio = Date.parse(conjunto.start_time);
  const fim = Date.parse(conjunto.end_time);
  return !(inicio > agora) && !(fim < agora);
}

// Soma o orçamento diário do que está no período e o gasto dessas campanhas hoje, só nas campanhas
// rastreadas. O orçamento pode estar na campanha ou nos conjuntos; a Meta devolve em centavos.
function resumirOrcamento(todasCampanhas, todosConjuntos, agora = Date.now()) {
  let orcamento = 0, consumido = 0, semDiario = 0;
  const campanhas = todasCampanhas.filter(rastreada);
  const ids = new Set(campanhas.map(c => c.id));
  const conjuntos = todosConjuntos.filter(s => ids.has(s.campaign_id));
  const vigentes = conjuntos.filter(s => noPeriodo(s, agora));
  for (const c of campanhas) {
    const daCampanha = vigentes.filter(s => s.campaign_id === c.id);
    if (!daCampanha.length) continue;
    const naCampanha = Number(c.daily_budget) || 0;
    const nosConjuntos = daCampanha.reduce((s, x) => s + (Number(x.daily_budget) || 0), 0);
    const diario = naCampanha || nosConjuntos;
    if (!diario) { semDiario += 1; continue; }
    orcamento += diario / 100;
    consumido += Number(c.insights?.data?.[0]?.spend) || 0;
  }
  return { orcamento, consumido, semDiario, foraDoPeriodo: conjuntos.length - vigentes.length };
}

function resumirAnuncio(ad, unidade, campanha) {
  const row = ad.insights?.data?.[0];
  if (!row) return null;
  return {
    id: ad.id,
    nome: ad.name || 'Sem nome',
    unidade,
    campanha: campanha.name,
    gasto: Number(row.spend) || 0,
    impressoes: Number(row.impressions) || 0,
    ctr: numero(row.ctr),
    conversas: valorAcao(row.actions, TIPO_CONVERSA),
    m3: valorAcao(row.actions, TIPO_MSG_3),
  };
}

async function consultarMeta(urls, token) {
  const lotes = [];
  for (let i = 0; i < urls.length; i += LIMITE_BATCH) lotes.push(urls.slice(i, i + LIMITE_BATCH));
  const respostas = await Promise.all(lotes.map(async lote => {
    const body = new URLSearchParams({
      access_token: token,
      include_headers: 'false',
      batch: JSON.stringify(lote.map(relative_url => ({ method: 'GET', relative_url }))),
    });
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/`, { method: 'POST', body });
    const json = await r.json();
    if (!Array.isArray(json)) throw new Error(json?.error?.message || 'Resposta inesperada da Meta');
    return json;
  }));
  return respostas.flat();
}

function lerItem(item) {
  let corpo = null;
  try { corpo = item && item.body ? JSON.parse(item.body) : null; } catch (_) {}
  if (!item || item.code !== 200 || !corpo || corpo.error) {
    return { erro: corpo?.error?.message || `Erro HTTP ${item?.code ?? '?'}`, data: null };
  }
  return { erro: null, data: corpo.data || [] };
}

module.exports = async (req, res) => {
  const token = process.env.META_TOKEN;
  if (!token) {
    res.status(500).json({ erro: 'META_TOKEN não configurado no Vercel.' });
    return;
  }

  const contas = CONTAS.filter(c => c.enabled);
  const POR_CONTA = 5;

  try {
    const itens = await consultarMeta(contas.flatMap(c => consultasDaConta(c.adAccountId)), token);
    const anuncios = [];

    const unidades = contas.map((c, i) => {
      const [hoje, semana, campanhas, conjuntos, ads] =
        itens.slice(i * POR_CONTA, (i + 1) * POR_CONTA).map(lerItem);
      const erro = [hoje, semana, campanhas, conjuntos, ads].find(x => x.erro)?.erro || null;

      if (campanhas.data && ads.data) {
        const porId = new Map(campanhas.data.map(x => [x.id, x]));
        for (const ad of ads.data) {
          const campanha = porId.get(ad.campaign_id);
          if (!campanha || !rastreada(campanha)) continue;
          const anuncio = resumirAnuncio(ad, c.unidade, campanha);
          if (anuncio) anuncios.push(anuncio);
        }
      }

      const orcamento = campanhas.data && conjuntos.data
        ? resumirOrcamento(campanhas.data, conjuntos.data)
        : { orcamento: null, consumido: null, semDiario: null, foraDoPeriodo: null };

      return {
        unidade: c.unidade,
        adAccountId: c.adAccountId,
        ...orcamento,
        alcanceHoje: numero(hoje.data?.[0]?.reach),
        freqHoje: numero(hoje.data?.[0]?.frequency),
        alcance7d: numero(semana.data?.[0]?.reach),
        freq7d: numero(semana.data?.[0]?.frequency),
        erro,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    res.status(200).json({ atualizadoEm: new Date().toISOString(), unidades, anuncios });
  } catch (e) {
    res.status(502).json({ erro: 'Falha ao consultar a Meta: ' + e.message });
  }
};
