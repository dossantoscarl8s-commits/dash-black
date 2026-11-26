// Rastreio dos links de WhatsApp. Cada página define LINK e DESTINO antes de carregar este arquivo.
// Registra o acesso e redireciona; o keepalive conclui o envio mesmo com a página já saindo.
(function () {
  try {
    var params = new URLSearchParams(location.search);
    var acesso = { link: LINK };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name'].forEach(function (k) {
      if (params.get(k)) acesso[k] = params.get(k).slice(0, 200);
    });
    if (navigator.webdriver) acesso.automatizado = true;
    fetch('/api/acessos', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(acesso)
    }).catch(function () {});
  } catch (_) {}

  // Os parâmetros do link não seguem adiante: o WhatsApp não os usa e alterariam a mensagem.
  if (DESTINO !== '#') location.replace(DESTINO);
})();
