const db = require('../config/db');
const ApiError = require('./ApiError');
const { withTransaction } = require('./transaction');

function formatarMoeda(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Lancamento RATEADO: um valor total (ex.: Sem Parar R$ 10.000) dividido entre
// varios centros de custo (placas / Base). Gera UMA conta a pagar com o total e
// uma linha de despesa fixa por centro (a parte de cada um - e o que o DRE soma
// por placa/conjunto). Sem parcelamento.
//
// Usado pela tela de Despesas Fixas ("Lancar com rateio entre centros") e pela
// importacao da fatura do Sem Parar (administracao). `minimoCentros` so e
// afrouxado pela importacao, que pode ter uma fatura com uma unica placa.
function criarDespesaRateada({ empresaId, usuarioId, rateios, categoria_id, valor, data, recorrente, descricao, qtd_parcelas, fornecedor_id, data_vencimento, minimoCentros = 2 }) {
  if (qtd_parcelas) throw new ApiError(400, 'Despesa rateada entre centros de custo nao pode ser parcelada.');
  if (!categoria_id) throw new ApiError(400, 'Informe a categoria da despesa.');
  if (!Array.isArray(rateios) || rateios.length < minimoCentros) {
    throw new ApiError(400, `Informe ao menos ${minimoCentros} centro${minimoCentros > 1 ? 's' : ''} de custo para ratear a despesa.`);
  }
  const ids = rateios.map((r) => Number(r.centro_custo_id));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new ApiError(400, 'Cada linha do rateio precisa de um centro de custo.');
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'O mesmo centro de custo aparece mais de uma vez no rateio.');
  if (rateios.some((r) => !Number.isInteger(r.valor) || r.valor <= 0)) throw new ApiError(400, 'Cada centro de custo precisa de um valor maior que zero.');
  const soma = rateios.reduce((t, r) => t + r.valor, 0);
  if (valor !== undefined && valor !== null && valor !== soma) {
    throw new ApiError(400, `A soma do rateio (${formatarMoeda(soma)}) nao bate com o valor total informado (${formatarMoeda(valor)}).`);
  }
  const categoria = db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(categoria_id);
  if (!categoria) throw new ApiError(400, 'Categoria nao encontrada.');
  const centros = ids.map((id) => {
    const c = db.prepare('SELECT * FROM centros_custo WHERE id = ? AND empresa_id = ?').get(id, empresaId);
    if (!c) throw new ApiError(400, `Centro de custo #${id} nao encontrado.`);
    return c;
  });
  if (fornecedor_id) {
    const f = db.prepare('SELECT id FROM fornecedores WHERE id = ? AND empresa_id = ?').get(fornecedor_id, empresaId);
    if (!f) throw new ApiError(400, 'Fornecedor nao encontrado.');
  }
  const nomeDescricao = descricao ? String(descricao).toUpperCase() : null;

  return withTransaction(db, () => {
    const inserir = db.prepare(`
      INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, descricao, criado_por)
      VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?)
    `);
    const linhasIds = rateios.map((r) => inserir.run(empresaId, r.centro_custo_id, categoria_id, r.valor, data || null, recorrente ? 1 : 0, nomeDescricao, usuarioId).lastInsertRowid);
    const principalId = linhasIds[0];
    db.prepare(`UPDATE despesas_fixas SET rateio_id = ? WHERE id IN (${linhasIds.map(() => '?').join(',')})`).run(principalId, ...linhasIds);
    const nomeConta = `${categoria.nome} - RATEIO ENTRE ${centros.length} CENTROS DE CUSTO${nomeDescricao ? ` - ${nomeDescricao}` : ''}`.toUpperCase();
    const conta = db.prepare(`
      INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
      VALUES (?, ?, NULL, ?, ?, COALESCE(?, ?, date('now', '-3 hours')), 'Pendente', 'DespesaFixa', ?)
    `).run(empresaId, fornecedor_id || null, nomeConta, soma, data_vencimento || null, data || null, principalId);
    const despesas = db.prepare('SELECT * FROM despesas_fixas WHERE rateio_id = ? ORDER BY id').all(principalId);
    return { rateio_id: principalId, valor_total: soma, conta_pagar_id: conta.lastInsertRowid, despesas };
  });
}

module.exports = { criarDespesaRateada };
