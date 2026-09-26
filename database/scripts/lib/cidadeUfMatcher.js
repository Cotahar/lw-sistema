// Casa um par (cidade, uf) digitado livremente contra a lista oficial de
// municipios do IBGE (frontend/data/municipios_ibge.json) - usado pelos
// scripts de diagnostico/normalizacao de cidade/UF (ver
// verificar_cidades_uf.js e normalizar_cidades_uf.js). Mesma ideia de
// distancia de edicao ja usada em frontend/js/components/searchableSelect.js,
// reaproveitada aqui do lado do Node.
const path = require('node:path');
const municipios = require(path.resolve(__dirname, '../../../frontend/data/municipios_ibge.json'));

function normalizar(txt) {
  return String(txt || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function distanciaEdicao(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const porUf = new Map();
for (const m of municipios) {
  if (!porUf.has(m.uf)) porUf.set(m.uf, []);
  porUf.get(m.uf).push(m);
}

// Devolve { municipio: {nome, uf}, confianca: 'EXATO'|'PROXIMO'|'DIVERGENTE', distancia } ou null se nao achou nada plausivel.
// 'EXATO': mesmo nome normalizado (so difere em acento/caixa) na mesma UF -
//          seguro aplicar automaticamente.
// 'PROXIMO': erro de digitacao pequeno (distancia <= 20% do tamanho do nome,
//            capado em 3) na mesma UF - seguro aplicar automaticamente.
// 'DIVERGENTE': so achou algo plausivel numa UF diferente da informada, ou a
//               distancia e grande - fica de fora da normalizacao automatica.
function encontrarMelhorMatch(cidadeBruta, ufBruta) {
  const cidadeAlvo = normalizar(cidadeBruta);
  const ufAlvo = normalizar(ufBruta);
  if (!cidadeAlvo) return null;

  const candidatosUf = porUf.get(ufAlvo) || [];
  let melhor = null;
  for (const m of candidatosUf) {
    const nomeNorm = normalizar(m.nome);
    if (nomeNorm === cidadeAlvo) return { municipio: m, confianca: 'EXATO', distancia: 0 };
    const dist = distanciaEdicao(cidadeAlvo, nomeNorm);
    if (!melhor || dist < melhor.distancia) melhor = { municipio: m, distancia: dist };
  }
  if (melhor) {
    const tolerancia = Math.min(3, Math.max(1, Math.floor(melhor.municipio.nome.length * 0.2)));
    if (melhor.distancia <= tolerancia) return { municipio: melhor.municipio, confianca: 'PROXIMO', distancia: melhor.distancia };
  }

  // UF pode estar errada tambem - procura no Brasil inteiro so pra reportar
  // como DIVERGENTE (nunca aplicado automaticamente, so aparece no diagnostico).
  let melhorGeral = null;
  for (const m of municipios) {
    const dist = distanciaEdicao(cidadeAlvo, normalizar(m.nome));
    if (!melhorGeral || dist < melhorGeral.distancia) melhorGeral = { municipio: m, distancia: dist };
  }
  if (melhorGeral && melhorGeral.distancia <= 2) return { municipio: melhorGeral.municipio, confianca: 'DIVERGENTE', distancia: melhorGeral.distancia };
  return null;
}

module.exports = { normalizar, encontrarMelhorMatch, municipios };
