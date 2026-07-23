const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const router = express.Router();

// Join usado tanto na listagem quanto na busca por :id - traz o nome da
// categoria e o veiculo/viagem de origem (quando a conta veio de uma despesa
// de viagem ou fixa), pra permitir filtrar/linkar sem precisar guardar essas
// referencias direto em contas_pagar (que e de origem polimorfica).
const SELECT_LISTA = `
  SELECT cp.*,
         f.nome AS fornecedor_nome,
         cc.nome AS centro_custo_nome,
         COALESCE(dv.categoria_id, df.categoria_id) AS categoria_id,
         cat.nome AS categoria_nome,
         dv.viagem_id AS viagem_id,
         vc.placa AS veiculo_placa
  FROM contas_pagar cp
  LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
  LEFT JOIN centros_custo cc ON cc.id = cp.centro_custo_id
  LEFT JOIN despesas_viagem dv ON cp.origem_tipo = 'DespesaViagem' AND dv.id = cp.origem_id
  LEFT JOIN despesas_fixas df ON cp.origem_tipo = 'DespesaFixa' AND df.id = cp.origem_id
  LEFT JOIN categorias_despesa cat ON cat.id = COALESCE(dv.categoria_id, df.categoria_id)
  LEFT JOIN viagens vg ON vg.id = dv.viagem_id
  LEFT JOIN (
    SELECT ci.conjunto_id, v.id, v.placa
    FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id AND v.tipo = 'Cavalo'
  ) vc ON vc.conjunto_id = vg.conjunto_id
`;

router.get('/', requerAcessoModulo('contas_pagar', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { status, origem_tipo, categoria_id, veiculo_id, search } = req.query;
  const condicoes = ['cp.empresa_id = ?'];
  const params = [req.empresaId];
  if (status) { condicoes.push('cp.status = ?'); params.push(status); }
  if (origem_tipo) { condicoes.push('cp.origem_tipo = ?'); params.push(origem_tipo); }
  if (categoria_id) { condicoes.push('COALESCE(dv.categoria_id, df.categoria_id) = ?'); params.push(categoria_id); }
  if (veiculo_id) { condicoes.push('vc.id = ?'); params.push(veiculo_id); }
  if (search) { condicoes.push('cp.descricao LIKE ?'); params.push(`%${search}%`); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  res.json(db.prepare(`${SELECT_LISTA} ${where} ORDER BY cp.data_vencimento`).all(...params));
}));

router.get('/:id', requerAcessoModulo('contas_pagar', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  res.json(conta);
}));

// Conta a pagar avulsa (nao gerada automaticamente por outro modulo).
router.post('/', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { fornecedor_id, centro_custo_id, descricao, valor, data_vencimento } = req.body;
  if (!descricao || !valor || !data_vencimento) throw new ApiError(400, 'Preencha descricao, valor e data_vencimento.');
  const info = db.prepare(`
    INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo)
    VALUES (?, ?, ?, ?, ?, ?, 'Pendente', 'Outro')
  `).run(req.empresaId, fornecedor_id || null, centro_custo_id || null, descricao, valor, data_vencimento);
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: conta.id, acao: 'INSERT', depois: conta });
  res.status(201).json(conta);
}));

router.put('/:id', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  if (antes.status !== 'Pendente') throw new ApiError(400, 'So e possivel editar contas ainda Pendentes.');
  const campos = ['fornecedor_id', 'centro_custo_id', 'descricao', 'valor', 'data_vencimento'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE contas_pagar SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

// Baixa (pagamento): efetiva a saida de caixa e, quando a origem for uma
// parcela de financiamento, sincroniza o status dela tambem. Desconto (se
// houver) so abate o saldo da conta, nao movimenta caixa (mesmo padrao de
// contas_receber_baixas). Se o total baixado (dinheiro + desconto) for maior
// que o restante da conta, a rota responde 409 pedindo confirmacao
// (ajustarValorConta=true) antes de aceitar - ela reajusta o valor
// original do lancamento pra refletir o que foi realmente pago/descontado.
router.post('/:id/baixar', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conta_bancaria_id, valor_pago, desconto, data_pagamento, ajustarValorConta } = req.body;
  if (!conta_bancaria_id) throw new ApiError(400, 'Informe a conta bancaria de origem do pagamento.');

  const resultado = withTransaction(db, () => {
    const contaPagar = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!contaPagar) throw new ApiError(404, 'Conta a pagar nao encontrada.');
    if (contaPagar.status === 'Pago') throw new ApiError(400, 'Esta conta ja esta paga.');
    const contaBancaria = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(conta_bancaria_id, req.empresaId);
    if (!contaBancaria) throw new ApiError(400, 'Conta bancaria nao encontrada.');

    const restante = contaPagar.valor - contaPagar.valor_pago - contaPagar.valor_descontado;
    const valorBaixa = valor_pago !== undefined && valor_pago !== null ? valor_pago : restante;
    const valorDesconto = desconto || 0;
    const totalBaixa = valorBaixa + valorDesconto;
    if (valorBaixa < 0 || valorDesconto < 0 || totalBaixa <= 0) throw new ApiError(400, 'Valor de baixa invalido.');

    let valorContaFinal = contaPagar.valor;
    if (totalBaixa > restante) {
      if (!ajustarValorConta) {
        throw new ApiError(409, `O valor a baixar (${(totalBaixa / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) e maior que o restante da conta (${(restante / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}). Confirme para ajustar o valor do lancamento.`);
      }
      valorContaFinal = contaPagar.valor_pago + contaPagar.valor_descontado + totalBaixa;
    }

    const novoValorPago = contaPagar.valor_pago + valorBaixa;
    const novoValorDescontado = contaPagar.valor_descontado + valorDesconto;
    const novoStatus = (novoValorPago + novoValorDescontado) >= valorContaFinal ? 'Pago' : 'Parcial';
    db.prepare(`
      UPDATE contas_pagar SET valor = ?, valor_pago = ?, valor_descontado = ?, status = ?, data_pagamento = COALESCE(?, date('now', '-3 hours')), conta_bancaria_id = ?
      WHERE id = ?
    `).run(valorContaFinal, novoValorPago, novoValorDescontado, novoStatus, data_pagamento || null, conta_bancaria_id, contaPagar.id);

    let movimentacao = null;
    if (valorBaixa > 0) {
      const movInfo = db.prepare(`
        INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, origem_id, criado_por)
        VALUES (?, ?, 'Saida', ?, COALESCE(?, date('now', '-3 hours')), ?, 'ContaPagar', ?, ?)
      `).run(req.empresaId, conta_bancaria_id, valorBaixa, data_pagamento || null, contaPagar.descricao, contaPagar.id, req.usuario.id);
      db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual - ? WHERE id = ?').run(valorBaixa, conta_bancaria_id);
      movimentacao = db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(movInfo.lastInsertRowid);
    }

    if (contaPagar.origem_tipo === 'FinanciamentoParcela' && novoStatus === 'Pago') {
      db.prepare("UPDATE financiamento_parcelas SET status = 'Paga', data_pagamento = COALESCE(?, date('now', '-3 hours')) WHERE id = ?")
        .run(data_pagamento || null, contaPagar.origem_id);
    }

    return {
      antes: contaPagar,
      contaPagar: db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(contaPagar.id),
      movimentacao,
    };
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: resultado.contaPagar.id, acao: 'UPDATE', antes: resultado.antes, depois: resultado.contaPagar });
  res.json(resultado);
}));

router.delete('/:id', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  if (antes.status !== 'Pendente') throw new ApiError(400, 'So e possivel excluir contas ainda Pendentes.');
  db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
