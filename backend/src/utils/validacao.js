const ApiError = require('./ApiError');

// Dinheiro trafega SEMPRE em centavos inteiros (ver CONTEXTO_PROJETO.md). Sem esta checagem um valor
// que chegasse como texto ("100") era CONCATENADO nos saldos (500 + "100" = "500100") e um 10.5
// deixava casas decimais num campo que o sistema inteiro trata como inteiro. O frontend ja manda
// centavos inteiros - isto e a defesa do lado do servidor (chamada direta a API, tela antiga aberta).
function exigirCentavos(valor, { campo = 'valor', permitirZero = false, permitirNegativo = false } = {}) {
  const valido = Number.isInteger(valor) && (permitirNegativo || valor >= 0) && (permitirZero || valor !== 0);
  if (!valido) {
    const faixa = permitirNegativo ? 'inteiro' : permitirZero ? 'inteiro, zero ou maior' : 'inteiro, maior que zero';
    throw new ApiError(400, `Valor invalido em "${campo}": informe um valor em centavos (${faixa}).`);
  }
  return valor;
}

// Mesmo, para campo opcional: undefined/null passam direto.
function exigirCentavosOpcional(valor, opcoes) {
  if (valor === undefined || valor === null) return valor;
  return exigirCentavos(valor, opcoes);
}

module.exports = { exigirCentavos, exigirCentavosOpcional };
