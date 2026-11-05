// Sessão do login da tela de Leads: cookie assinado no servidor, sem dados no navegador.
// Usuário, senha e segredo ficam só nas variáveis de ambiente do Vercel, nunca no código.

const crypto = require('crypto');

const COOKIE = 'sessao_leads';
const DURACAO = 12 * 3600;   // segundos

const resumo = v => crypto.createHash('sha256').update(String(v)).digest();
const iguais = (a, b) => crypto.timingSafeEqual(resumo(a), resumo(b));
const assinar = (expira, segredo) => crypto.createHmac('sha256', segredo).update(String(expira)).digest('hex');

function criarCookie() {
  const expira = Math.floor(Date.now() / 1000) + DURACAO;
  const valor = `${expira}.${assinar(expira, process.env.SESSAO_SEGREDO)}`;
  return `${COOKIE}=${valor}; Path=/api; Max-Age=${DURACAO}; HttpOnly; Secure; SameSite=Strict`;
}

const limparCookie = () => `${COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

function sessaoValida(req) {
  const segredo = process.env.SESSAO_SEGREDO;
  if (!segredo) return false;
  const achado = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]+)`));
  if (!achado) return false;
  const [, expira, assinatura] = achado;
  return Number(expira) > Date.now() / 1000 && iguais(assinatura, assinar(expira, segredo));
}

module.exports = { criarCookie, limparCookie, sessaoValida, iguais };
