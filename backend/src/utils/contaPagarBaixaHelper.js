const db = require('../config/db');
const ApiError = require('./ApiError');

// Parcela de origem cujo status precisa ficar em sincronia com a conta a
// pagar (financiamento/despesa fixa/OS parcelados) - usado tanto ao baixar
// (marca Paga) quanto ao estornar (volta pra Pendente).
const TABELA_PARCELA_POR_ORIGEM = {
  FinanciamentoParcela: 'financiamento_parcelas',
  DespesaFixaParcela: 'despesa_fixa_parcelas',
  OrdemServicoParcela: 'os_parcelas',
};

function formatarMoeda(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Baixa (pagamento) de UMA conta a pagar: efetiva a saida de caixa e, quando a
// origem for uma parcela de financiamento/despesa fixa/OS, sincroniza o status
// dela tambem. Desconto (se houver) so abate o saldo da conta, nao movimenta
// caixa. Se o total baixado (dinheiro + desconto) for maior que o restante,
// responde 409 pedindo confirmacao (ajustarValorConta=true) - ela reajusta o
// valor original do lancamento pra refletir o que foi realmente pago.
//
// Extraida de POST /contas-pagar/:id/baixar para ser reaproveitada pela baixa
// em lote (POST /contas-pagar/baixar-lote). Deve rodar dentro de uma transacao.
//
// BAIXA SEM PAGAMENTO (semPagamento): quita (no todo ou em parte) a conta SEM valor
// pago e SEM conta bancaria - nada sai do caixa. Serve para despesa que foi
// paga por outro meio (fora dos caixas controlados), compensada ou cancelada.
// Como o desconto, abate o saldo da conta sem movimentar caixa (e entra em
// valor_descontado, para nao mexer em nenhuma conta de restante); a diferenca e
// que fica registrada como Ocorrencia da conta. `valorSemPagamento` e o quanto
// baixar (padrao: o restante todo); nunca acima do restante.
function baixarContaPagar({ empresaId, usuarioId, contaId, contaBancariaId, valorPago, desconto, dataPagamento, ajustarValorConta, semPagamento = false, valorSemPagamento }) {
  if (!semPagamento && !contaBancariaId) throw new ApiError(400, 'Informe a conta bancaria de origem do pagamento.');
  const contaPagar = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(contaId, empresaId);
  if (!contaPagar) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  if (contaPagar.status === 'Pago') throw new ApiError(400, 'Esta conta ja esta paga.');
  if (!semPagamento) {
    const contaBancaria = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(contaBancariaId, empresaId);
    if (!contaBancaria) throw new ApiError(400, 'Conta bancaria nao encontrada.');
  }

  const restante = contaPagar.valor - contaPagar.valor_pago - contaPagar.valor_descontado;
  if (semPagamento) {
    const quitar = valorSemPagamento !== undefined && valorSemPagamento !== null ? valorSemPagamento : restante;
    if (!Number.isInteger(quitar) || quitar <= 0) throw new ApiError(400, 'Informe o valor a baixar sem pagamento (maior que zero).');
    if (quitar > restante) throw new ApiError(400, `O valor a baixar sem pagamento (${formatarMoeda(quitar)}) e maior que o restante da conta (${formatarMoeda(restante)}).`);
    valorPago = 0;
    desconto = quitar;
    ajustarValorConta = false;
    contaBancariaId = null;
  }
  const valorBaixa = valorPago !== undefined && valorPago !== null ? valorPago : restante;
  const valorDesconto = desconto || 0;
  const totalBaixa = valorBaixa + valorDesconto;
  if (valorBaixa < 0 || valorDesconto < 0 || totalBaixa <= 0) throw new ApiError(400, 'Valor de baixa invalido.');

  let valorContaFinal = contaPagar.valor;
  if (totalBaixa > restante) {
    if (!ajustarValorConta) {
      throw new ApiError(409, `O valor a baixar (${formatarMoeda(totalBaixa)}) e maior que o restante da conta (${formatarMoeda(restante)}). Confirme para ajustar o valor do lancamento.`);
    }
    valorContaFinal = contaPagar.valor_pago + contaPagar.valor_descontado + totalBaixa;
  }

  const novoValorPago = contaPagar.valor_pago + valorBaixa;
  const novoValorDescontado = contaPagar.valor_descontado + valorDesconto;
  const novoStatus = (novoValorPago + novoValorDescontado) >= valorContaFinal ? 'Pago' : 'Parcial';
  db.prepare(`
    UPDATE contas_pagar SET valor = ?, valor_pago = ?, valor_descontado = ?, status = ?, data_pagamento = COALESCE(?, date('now', '-3 hours')), conta_bancaria_id = COALESCE(?, conta_bancaria_id)
    WHERE id = ?
  `).run(valorContaFinal, novoValorPago, novoValorDescontado, novoStatus, dataPagamento || null, contaBancariaId || null, contaPagar.id);

  let movimentacao = null;
  if (valorBaixa > 0) {
    const movInfo = db.prepare(`
      INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, origem_id, criado_por)
      VALUES (?, ?, 'Saida', ?, COALESCE(?, date('now', '-3 hours')), ?, 'ContaPagar', ?, ?)
    `).run(empresaId, contaBancariaId, valorBaixa, dataPagamento || null, contaPagar.descricao, contaPagar.id, usuarioId);
    db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual - ? WHERE id = ?').run(valorBaixa, contaBancariaId);
    movimentacao = db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(movInfo.lastInsertRowid);
  }

  // Sincroniza o status na tabela de origem tambem (financiamento/despesa
  // fixa/OS parcelados) - sem isso a parcela ficava "Pendente" pra sempre
  // nessas tabelas mesmo depois de paga aqui, por mais que a conta a pagar
  // (a fonte de verdade pro financeiro) estivesse correta.
  if (novoStatus === 'Pago') {
    const tabelaParcela = TABELA_PARCELA_POR_ORIGEM[contaPagar.origem_tipo];
    if (tabelaParcela) {
      db.prepare(`UPDATE ${tabelaParcela} SET status = 'Paga', data_pagamento = COALESCE(?, date('now', '-3 hours')) WHERE id = ?`)
        .run(dataPagamento || null, contaPagar.origem_id);
    }
  }

  if (semPagamento) {
    db.prepare("INSERT INTO ocorrencias (empresa_id, entidade_tipo, entidade_id, texto, criado_por) VALUES (?, 'ContaPagar', ?, ?, ?)")
      .run(empresaId, contaPagar.id, `Baixa SEM PAGAMENTO de ${formatarMoeda(desconto)} (nada saiu do caixa)${dataPagamento ? ` em ${dataPagamento.split('-').reverse().join('/')}` : ''}.`, usuarioId);
  }

  return {
    antes: contaPagar,
    contaPagar: db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(contaPagar.id),
    movimentacao,
  };
}

module.exports = { baixarContaPagar, TABELA_PARCELA_POR_ORIGEM };
