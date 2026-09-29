// O acerto em si (acertos_viagem) nao guarda status de pagamento - o
// dinheiro e sempre uma Conta a Pagar em separado (origem_tipo
// 'AcertoViagem'), que pode ser 1 linha (so o saldo) ou 2 (saldo + imposto
// da empresa). "status_pagamento" resume essas linhas pra exibicao (tela de
// Acertos do escritorio e app do motorista) - sem isso nenhuma tela
// refletia que o acerto ja tinha sido pago, mesmo depois da baixa em
// Contas a Pagar (bug reportado pelo usuario). Compartilhado entre
// acertos.routes.js e motorista.routes.js pra nunca divergir.
// null = nada a pagar em dinheiro (saldo_final <= 0 e sem imposto, tudo
// ficou em conta corrente do motorista).
const SELECT_STATUS_PAGAMENTO = `
  (SELECT COUNT(*) FROM contas_pagar cp WHERE cp.origem_tipo = 'AcertoViagem' AND cp.origem_id = a.id) AS qtd_contas_pagar,
  (SELECT COUNT(*) FROM contas_pagar cp WHERE cp.origem_tipo = 'AcertoViagem' AND cp.origem_id = a.id AND cp.status = 'Pago') AS qtd_contas_pagar_pagas
`;

function statusPagamentoDoAcerto(qtdContas, qtdPagas) {
  if (qtdContas === 0) return null;
  if (qtdPagas === qtdContas) return 'Pago';
  if (qtdPagas > 0) return 'Parcial';
  return 'Pendente';
}

// Recebe linhas de acertos_viagem (alias `a`) que ja incluem as duas
// subqueries de SELECT_STATUS_PAGAMENTO - troca os dois campos auxiliares
// por `status_pagamento`.
function comStatusPagamento(linhas) {
  return linhas.map(({ qtd_contas_pagar, qtd_contas_pagar_pagas, ...resto }) => ({
    ...resto,
    status_pagamento: statusPagamentoDoAcerto(qtd_contas_pagar, qtd_contas_pagar_pagas),
  }));
}

module.exports = { SELECT_STATUS_PAGAMENTO, comStatusPagamento };
