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

module.exports = { agoraBrasilia, hojeIsoBrasilia, agoraDataHoraIsoBrasilia };
