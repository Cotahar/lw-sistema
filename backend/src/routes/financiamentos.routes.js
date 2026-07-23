const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');
const { hojeIsoBrasilia } = require('../utils/dataHora');

const router = express.Router();

function somarMeses(dataIso, meses) {
  const data = new Date(`${dataIso}T00:00:00Z`);
  data.setUTCMonth(data.getUTCMonth() + meses);
  return data.toISOString().slice(0, 10);
}

function buscarFinanciamentoCompleto(id, empresaId) {
  const financiamento = db.prepare('SELECT * FROM financiamentos WHERE id = ? AND empresa_id = ?').get(id, empresaId);
  if (!financiamento) return null;
  const parcelas = db.prepare('SELECT * FROM financiamento_parcelas WHERE financiamento_id = ? ORDER BY numero_parcela').all(id);
  return { ...financiamento, parcelas };
}

router.get('/', requerAcessoModulo('financiamentos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { centro_custo_id } = req.query;
  const condicoes = []; const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (centro_custo_id) { condicoes.push('centro_custo_id = ?'); params.push(centro_custo_id); }
  const rows = db.prepare(`SELECT * FROM financiamentos WHERE ${condicoes.join(' AND ')} ORDER BY id DESC`).all(...params);
  res.json(rows);
}));

router.get('/:id', requerAcessoModulo('financiamentos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const financiamento = buscarFinanciamentoCompleto(req.params.id, req.empresaId);
  if (!financiamento) throw new ApiError(404, 'Financiamento nao encontrado.');
  res.json(financiamento);
}));

// Gera as parcelas (valor total dividido em partes iguais, vencimentos mensais a
// partir da 1a data informada) e, para cada uma, a respectiva Conta a Pagar.
router.post('/', requerAcessoModulo('financiamentos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { centro_custo_id, descricao, credor_fornecedor_id, valor_total, qtd_parcelas, data_contrato, primeira_parcela_vencimento } = req.body;
  if (!centro_custo_id || !descricao || !valor_total || !qtd_parcelas) {
    throw new ApiError(400, 'Preencha centro_custo_id, descricao, valor_total e qtd_parcelas.');
  }
  const centroCusto = db.prepare('SELECT * FROM centros_custo WHERE id = ? AND empresa_id = ?').get(centro_custo_id, req.empresaId);
  if (!centroCusto) throw new ApiError(400, 'Centro de custo nao encontrado.');

  const financiamento = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO financiamentos (empresa_id, centro_custo_id, descricao, credor_fornecedor_id, valor_total, qtd_parcelas, data_contrato)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')))
    `).run(req.empresaId, centro_custo_id, descricao, credor_fornecedor_id || null, valor_total, qtd_parcelas, data_contrato || null);
    const financiamentoId = info.lastInsertRowid;

    const primeiroVencimento = primeira_parcela_vencimento || data_contrato || hojeIsoBrasilia();
    const valorBase = Math.floor(valor_total / qtd_parcelas);
    const resto = valor_total - valorBase * qtd_parcelas; // ajusta o arredondamento na ultima parcela

    for (let numero = 1; numero <= qtd_parcelas; numero += 1) {
      const valorParcela = numero === qtd_parcelas ? valorBase + resto : valorBase;
      const vencimento = somarMeses(primeiroVencimento, numero - 1);
      const parcelaInfo = db.prepare(`
        INSERT INTO financiamento_parcelas (empresa_id, financiamento_id, numero_parcela, data_vencimento, valor_parcela)
        VALUES (?, ?, ?, ?, ?)
      `).run(req.empresaId, financiamentoId, numero, vencimento, valorParcela);

      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, ?, ?, ?, 'Pendente', 'FinanciamentoParcela', ?)
      `).run(req.empresaId, credor_fornecedor_id || null, centro_custo_id, `${descricao} - parcela ${numero}/${qtd_parcelas}`, valorParcela, vencimento, parcelaInfo.lastInsertRowid);
    }

    return buscarFinanciamentoCompleto(financiamentoId, req.empresaId);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'financiamentos', registroId: financiamento.id, acao: 'INSERT', depois: financiamento });
  res.status(201).json(financiamento);
}));

router.delete('/:id', requerAcessoModulo('financiamentos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = buscarFinanciamentoCompleto(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Financiamento nao encontrado.');
  const temParcelaPaga = antes.parcelas.some((p) => p.status === 'Paga');
  if (temParcelaPaga) throw new ApiError(400, 'Nao e possivel excluir um financiamento com parcelas ja pagas.');

  withTransaction(db, () => {
    db.prepare("DELETE FROM contas_pagar WHERE origem_tipo = 'FinanciamentoParcela' AND origem_id IN (SELECT id FROM financiamento_parcelas WHERE financiamento_id = ?)").run(req.params.id);
    db.prepare('DELETE FROM financiamentos WHERE id = ?').run(req.params.id);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'financiamentos', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
