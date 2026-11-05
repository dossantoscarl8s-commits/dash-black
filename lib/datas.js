// Datas de dias encerrados: só vale AAAA-MM-DD anterior a hoje no horário de Brasília.

const hojeBrasil = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const dataValida = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && v < hojeBrasil();

function diasAntes(data, n) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

module.exports = { dataValida, diasAntes };
