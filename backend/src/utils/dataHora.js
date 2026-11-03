// "Hoje"/"agora" calculados no servidor precisam refletir o horario de
// Brasilia (UTC-3, sem horario de verao desde 2019) - o container (Railway)
// roda em UTC, entao `new Date().toISOString()` puro fica ate 3h adiantado
// (mesmo bug do `datetime('now')` sem ajuste no SQL, ver schema.sql). Sempre
// usar isto em vez de `new Date().toISOString()` quando o valor for
// comparado com ou exibido como data/hora "de hoje" pro usuario.
function agoraBrasilia() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function hojeIsoBrasilia() {
  return agoraBrasilia().toISOString().slice(0, 10);
}

function agoraDataHoraIsoBrasilia() {
  return agoraBrasilia().toISOString().slice(0, 19).replace('T', ' ');
}

// Soma dias a uma data ISO (YYYY-MM-DD) sem passar por fuso (usa UTC so como
// calendario), devolvendo outra data ISO.
function somarDiasIso(dataIso, dias) {
  const data = new Date(`${dataIso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

// Mesmo, somando meses (parcelas mensais de financiamento, despesa fixa e OS). Dia 31 + 1 mes cai no
// comeco do mes seguinte ao curto (comportamento do Date) - igual ao que as tres rotas ja faziam.
function somarMesesIso(dataIso, meses) {
  const data = new Date(`${dataIso}T00:00:00Z`);
  data.setUTCMonth(data.getUTCMonth() + meses);
  return data.toISOString().slice(0, 10);
}

// Prazo padrao de recebimento do frete: data de descarga (entrega) + 3 dias.
// Sem data de descarga ainda, usa hoje + 3 dias - nunca o inicio da viagem,
// que deixava fretes recem-lancados "vencidos ha 40 dias" numa viagem longa.
const PRAZO_RECEBIMENTO_DIAS = 3;
function dataPrevistaRecebimentoPadrao(dataDescarga) {
  return somarDiasIso(dataDescarga || hojeIsoBrasilia(), PRAZO_RECEBIMENTO_DIAS);
}

module.exports = {
  agoraBrasilia, hojeIsoBrasilia, agoraDataHoraIsoBrasilia, somarDiasIso, somarMesesIso, dataPrevistaRecebimentoPadrao, PRAZO_RECEBIMENTO_DIAS,
};
