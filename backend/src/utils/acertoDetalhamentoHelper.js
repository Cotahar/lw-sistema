const db = require('../config/db');

function somar(lista) {
  return lista.reduce((total, valor) => total + (valor || 0), 0);
}

// Itens manuais (reembolso/desconto) de uma viagem, na ordem de lancamento.
function listarItensManuais(viagemId) {
  return db.prepare('SELECT * FROM acerto_itens WHERE viagem_id = ? ORDER BY id').all(viagemId);
}

// Despesas "por conta do motorista" (pago_por = 'Motorista') nao geram Conta a
// Pagar: viram desconto no acerto, uma linha por despesa. Sao somadas no
// total de descontos (ver calcularAcerto em acertos.routes.js) e aparecem
// junto dos descontos manuais na listagem.
function listarDespesasPorContaDoMotorista(viagemId) {
  return db.prepare(`
    SELECT dv.id, dv.data, dv.valor, dv.descricao, cat.nome AS categoria_nome
    FROM despesas_viagem dv
    LEFT JOIN categorias_despesa cat ON cat.id = dv.categoria_id
    WHERE dv.viagem_id = ? AND dv.pago_por = 'Motorista'
    ORDER BY dv.data, dv.id
  `).all(viagemId);
}

function linhaDeItem(item) {
  return { id: item.id, origem: 'Manual', descricao: item.descricao, valor: item.valor };
}

function linhaDeDespesa(despesa) {
  const descricao = [despesa.categoria_nome, despesa.descricao].filter(Boolean).join(' - ') || 'Despesa';
  return { origem: 'Despesa', despesa_id: despesa.id, data: despesa.data, descricao, valor: despesa.valor };
}

// Acerto ja fechado guarda so os TOTAIS (valor_reembolsos/valor_descontos):
// os fechados antes da listagem existir (inclusive os importados) nao tem
// itens, e um fechado com valor digitado a mao pode ter total diferente da
// soma das linhas. Pra a listagem nunca contradizer o total gravado: soma
// igual = so as linhas; falta valor = linha extra "sem detalhamento"; sobra
// valor = uma linha unica com o total gravado.
function reconciliarComTotal(linhas, totalGravado) {
  const soma = somar(linhas.map((l) => l.valor));
  if (soma === totalGravado) return linhas;
  if (soma < totalGravado) return [...linhas, { origem: 'SemDetalhe', descricao: 'Sem detalhamento', valor: totalGravado - soma }];
  return [{ origem: 'SemDetalhe', descricao: 'Total lancado no fechamento', valor: totalGravado }];
}

// Listagem de reembolsos e descontos de uma viagem, pronta pra exibir
// (relatorios, tela do acerto fechado, WhatsApp, app do motorista).
// `acerto` (opcional) e o acerto ja fechado - com ele a listagem e
// reconciliada com os totais gravados (ver reconciliarComTotal).
function montarDetalhamentoAcerto(viagemId, acerto = null) {
  const itens = listarItensManuais(viagemId);
  let reembolsos = itens.filter((i) => i.tipo === 'Reembolso').map(linhaDeItem);
  let descontos = [
    ...listarDespesasPorContaDoMotorista(viagemId).map(linhaDeDespesa),
    ...itens.filter((i) => i.tipo === 'Desconto').map(linhaDeItem),
  ];
  if (acerto) {
    reembolsos = reconciliarComTotal(reembolsos, acerto.valor_reembolsos);
    descontos = reconciliarComTotal(descontos, acerto.valor_descontos);
  }
  const viagem = db.prepare('SELECT valor_pedagio FROM viagens WHERE id = ?').get(viagemId);
  return {
    reembolsos,
    descontos,
    totalReembolsos: somar(reembolsos.map((l) => l.valor)),
    totalDescontos: somar(descontos.map((l) => l.valor)),
    valorPedagio: viagem ? viagem.valor_pedagio : 0,
  };
}

module.exports = { somar, listarItensManuais, listarDespesasPorContaDoMotorista, montarDetalhamentoAcerto };
