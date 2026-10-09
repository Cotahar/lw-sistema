// Valor em reais por extenso (pt-BR) para recibos: 150000 centavos -> "mil e quinhentos reais".
const UNIDADES = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

// 0 < n < 1000
function centenaPorExtenso(n) {
  if (n === 100) return 'cem';
  const partes = [];
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  if (centena) partes.push(CENTENAS[centena]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const dezena = Math.floor(resto / 10);
      const unidade = resto % 10;
      partes.push(unidade ? `${DEZENAS[dezena]} e ${UNIDADES[unidade]}` : DEZENAS[dezena]);
    }
  }
  return partes.join(' e ');
}

const ESCALAS = [
  { valor: 1e9, singular: 'bilhao', plural: 'bilhoes' },
  { valor: 1e6, singular: 'milhao', plural: 'milhoes' },
  { valor: 1e3, singular: 'mil', plural: 'mil' },
];

// Inteiro >= 0 por extenso.
function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const partes = [];
  let resto = n;
  let qtdUltimoGrupo = 0;
  for (const escala of ESCALAS) {
    const qtd = Math.floor(resto / escala.valor);
    if (qtd > 0) {
      partes.push(escala.valor === 1e3 && qtd === 1 ? 'mil' : `${centenaPorExtenso(qtd)} ${qtd === 1 ? escala.singular : escala.plural}`);
      qtdUltimoGrupo = qtd;
      resto %= escala.valor;
    }
  }
  if (resto > 0) {
    partes.push(centenaPorExtenso(resto));
    qtdUltimoGrupo = resto;
  }
  // "e" so antes da ultima parte quando ela e uma centena redonda ou menor que 100
  // (mil e quinhentos; dois mil e cem; um milhao e duzentos mil; mil duzentos e trinta e quatro).
  if (partes.length === 1) return partes[0];
  const ultima = partes[partes.length - 1];
  const inicio = partes.slice(0, -1).join(' ');
  const ligaComE = qtdUltimoGrupo < 100 || qtdUltimoGrupo % 100 === 0;
  return ligaComE ? `${inicio} e ${ultima}` : `${inicio} ${ultima}`;
}

function valorPorExtenso(centavos) {
  const total = Math.round(Number(centavos) || 0);
  if (total <= 0) return 'zero reais';
  const reais = Math.floor(total / 100);
  const cent = total % 100;
  const partesTexto = [];
  if (reais > 0) {
    const preposicao = reais >= 1e6 && reais % 1e6 === 0 ? ' de' : '';
    partesTexto.push(`${inteiroPorExtenso(reais)}${preposicao} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent > 0) partesTexto.push(`${inteiroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partesTexto.join(' e ');
}

module.exports = { valorPorExtenso };
