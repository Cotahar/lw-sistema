const db = require('../config/db');
const ApiError = require('./ApiError');
const { registrarAuditoria } = require('./audit');

// Custos (despesas_fixas, o que o DRE soma por centro de custo) lancados A PARTIR de outro registro:
//  - baixa do frete (desconto/pedagio/outro) que na verdade foi um custo da placa (ex.: "compra de
//    4 pneus" que o cliente abateu do frete): entra no DRE SEM conta a pagar - o dinheiro nunca saiu;
//  - multa que a empresa paga (condutor nao indicado / paga): entra no DRE E gera a conta a pagar.
// O registro de origem guarda o id da despesa (despesa_fixa_id) - e por ele que o custo e desfeito.

// Cria a despesa fixa (e, se `conta` for informado, a conta a pagar dela) dentro da transacao do chamador.
function criarDespesaVinculada({ empresaId, usuarioId, centroCustoId, categoriaId, valor, data, descricao, conta = null }) {
  if (!Number.isInteger(valor) || valor <= 0) throw new ApiError(400, 'O valor do custo precisa ser maior que zero.');
  if (!categoriaId) throw new ApiError(400, 'Escolha a categoria do custo.');
  if (!centroCustoId) throw new ApiError(400, 'Escolha a placa / centro de custo do custo.');
  const centro = db.prepare('SELECT id, nome FROM centros_custo WHERE id = ? AND empresa_id = ?').get(centroCustoId, empresaId);
  if (!centro) throw new ApiError(400, 'Centro de custo nao encontrado.');
  const categoria = db.prepare('SELECT id, nome FROM categorias_despesa WHERE id = ?').get(categoriaId);
  if (!categoria) throw new ApiError(400, 'Categoria nao encontrada.');
  const texto = descricao ? String(descricao).trim().toUpperCase() : null;

  const info = db.prepare(`
    INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, descricao, criado_por)
    VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), 0, ?, ?)
  `).run(empresaId, centro.id, categoria.id, valor, data || null, texto, usuarioId);
  const despesa = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(info.lastInsertRowid);

  let contaPagar = null;
  if (conta) {
    const nomeConta = conta.descricao || `${categoria.nome} - ${centro.nome}${texto ? ` - ${texto}` : ''}`.toUpperCase();
    const c = db.prepare(`
      INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id, documento, observacao)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, ?, date('now', '-3 hours')), 'Pendente', 'DespesaFixa', ?, ?, ?)
    `).run(empresaId, conta.fornecedorId || null, centro.id, nomeConta.toUpperCase(), valor, conta.vencimento || null, data || null, despesa.id, conta.documento || null, conta.observacao || null);
    contaPagar = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(c.lastInsertRowid);
  }
  registrarAuditoria({ usuarioId, empresaId, tabela: 'despesas_fixas', registroId: despesa.id, acao: 'INSERT', depois: despesa });
  return { despesa, contaPagar };
}

// Apaga a despesa vinculada (e a conta a pagar dela, se ainda sem pagamento) e limpa as referencias.
// Devolve true se havia algo a desfazer.
function removerDespesaVinculada({ empresaId, usuarioId, despesaFixaId }) {
  if (!despesaFixaId) return false;
  const despesa = db.prepare('SELECT * FROM despesas_fixas WHERE id = ? AND empresa_id = ?').get(despesaFixaId, empresaId);
  if (!despesa) { desvincularReferencias(despesaFixaId); return false; }
  const conta = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(despesa.id);
  if (conta && (conta.status !== 'Pendente' || conta.valor_pago > 0 || conta.valor_descontado > 0)) {
    throw new ApiError(400, 'A conta a pagar deste custo ja tem pagamento lancado: estorne a baixa antes de desfazer o custo.');
  }
  if (conta) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(conta.id);
  desvincularReferencias(despesa.id);
  db.prepare('DELETE FROM despesas_fixas WHERE id = ?').run(despesa.id);
  registrarAuditoria({ usuarioId, empresaId, tabela: 'despesas_fixas', registroId: despesa.id, acao: 'DELETE', antes: despesa });
  return true;
}

// Despesa apagada (por qualquer caminho): as baixas/multas que apontavam para ela voltam a "sem custo".
function desvincularReferencias(despesaFixaId) {
  db.prepare('UPDATE contas_receber_baixas SET despesa_fixa_id = NULL WHERE despesa_fixa_id = ?').run(despesaFixaId);
  db.prepare('UPDATE multas SET despesa_fixa_id = NULL WHERE despesa_fixa_id = ?').run(despesaFixaId);
}

module.exports = { criarDespesaVinculada, removerDespesaVinculada, desvincularReferencias };
