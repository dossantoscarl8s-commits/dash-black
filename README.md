# Dashboard de leads ao vivo (Meta Ads)

- `index.html`: o painel, com as abas Painel, Campanhas, Estratégia e Logs (atualiza a cada 10 s ou pelo botão Atualizar). Abra com `?demo` para ver com números fictícios.
- `api/leads.js`: rota serverless que consulta as 17 contas por campanha numa única chamada batch da Graph API.
- `api/estrategia.js`: rota da aba Estratégia (orçamento, alcance, frequência e anúncios). Só roda com a aba aberta e os dados ficam até 5 min em cache.
- `lib/contas.js`: lista de unidades e contas.

## Publicar no Vercel
1. Suba esta pasta para um repositório no GitHub (ou rode `npx vercel` dentro dela).
2. No Vercel: Add New Project, importe o repositório, sem framework.
3. Em Settings > Environment Variables, crie `META_TOKEN` com o token da Meta.
4. Deploy. O painel fica na raiz do domínio.

Variáveis opcionais: `META_API_VERSION` (padrão v24.0) e `LEAD_ACTION_TYPES`
(padrão `onsite_conversion.messaging_conversation_started_7d,lead,...`: conta conversas por mensagem iniciadas, que é o resultado das campanhas de mensagens).
