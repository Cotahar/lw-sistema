const db = require('../config/db');
const { somar } = require('./formatacao');

// Itens manuais (reembolso/desconto) de uma viagem, na ordem de lancamento.
function listarItensManuais(viagemId) {
  return db.prepare('SELECT * FROM acerto_itens WHERE viagem_id = ? ORDER BY id').all(viagemId);
}

// REGRA ATUAL (so para acertos AINDA NAO fechados): quando o motorista paga uma despesa do caminhao (pago_por = 'Motorista') ou paga
// parte dela em dinheiro (valor_pago_dinheiro), ele vai cobrar a empresa no fim da viagem: o valor vira REEMBOLSO automatico no
// acerto, uma linha por despesa. A unica coisa descontada do motorista sao os adiantamentos (e os descontos lancados a mao).
function listarReembolsosAutomaticos(viagemId) {
  const despesas = db.prepare(`
    SELECT dv.id, dv.data, dv.valor, dv.pago_por, dv.valor_pago_dinheiro, dv.descricao, cat.nome AS categoria_nome
    FROM despesas_viagem dv
    LEFT JOIN categorias_despesa cat ON cat.id = dv.categoria_id
    WHERE dv.viagem_id = ? AND (dv.pago_por = 'Motorista' OR dv.valor_pago_dinheiro > 0)
    ORDER BY dv.data, dv.id
  `).all(viagemId);
  return despesas.map((d) => {
    const pagouTudo = d.pago_por === 'Motorista';
    const detalhe = [d.categoria_nome, d.descricao].filter(Boolean).join(' - ') || 'Despesa';
    return {
      origem: 'Despesa', automatico: true, despesa_id: d.id, data: d.data,
      descricao: `${pagouTudo ? 'Pago pelo motorista' : 'Pago em dinheiro pelo motorista'}: ${detalhe}`,
      valor: pagouTudo ? d.valor : d.valor_pago_dinheiro,
    };
  }).filter((l) => l.valor > 0);
}

// Legado: ate esta regra, despesa por conta do motorista (pago_por = 'Motorista') virava DESCONTO no acerto. Acertos ja fechados
// continuam sendo mostrados assim (viagens fechadas nao mudam).
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
  const reembolsosManuais = itens.filter((i) => i.tipo === 'Reembolso').map(linhaDeItem);
  const descontosManuais = itens.filter((i) => i.tipo === 'Desconto').map(linhaDeItem);
  const reembolsosAutomaticos = listarReembolsosAutomaticos(viagemId);
  const descontosLegado = [...listarDespesasPorContaDoMotorista(viagemId).map(linhaDeDespesa), ...descontosManuais];
  let reembolsos;
  let descontos;
  if (!acerto) {
    // Acerto em aberto: regra atual (reembolso automatico; nada de desconto por despesa).
    reembolsos = [...reembolsosAutomaticos, ...reembolsosManuais];
    descontos = descontosManuais;
  } else {
    // Acerto fechado: mostra as linhas que batem com o total gravado (novo ou legado); se nenhuma bater, reconcilia o legado.
    const comAutomaticos = [...reembolsosAutomaticos, ...reembolsosManuais];
    reembolsos = somar(comAutomaticos.map((l) => l.valor)) === acerto.valor_reembolsos
      ? comAutomaticos : reconciliarComTotal(reembolsosManuais, acerto.valor_reembolsos);
    if (somar(descontosLegado.map((l) => l.valor)) === acerto.valor_descontos) descontos = descontosLegado;
    else if (somar(descontosManuais.map((l) => l.valor)) === acerto.valor_descontos) descontos = descontosManuais;
    else descontos = reconciliarComTotal(descontosLegado, acerto.valor_descontos);
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

module.exports = { listarItensManuais, listarReembolsosAutomaticos, listarDespesasPorContaDoMotorista, montarDetalhamentoAcerto };
