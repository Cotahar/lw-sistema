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

function buscarDespesaFixaCompleta(id, empresaId) {
  const despesa = db.prepare('SELECT * FROM despesas_fixas WHERE id = ? AND empresa_id = ?').get(id, empresaId);
  if (!despesa) return null;
  const parcelas = db.prepare('SELECT * FROM despesa_fixa_parcelas WHERE despesa_fixa_id = ? ORDER BY numero_parcela').all(id);
  return { ...despesa, parcelas };
}

// Despesas recorrentes/fixas nao ligadas a uma viagem (seguro, rastreamento,
// salario administrativo...). Sempre geram Conta a Pagar (sao sempre da empresa).
router.get('/', requerAcessoModulo('despesas_fixas', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { centro_custo_id, data_cadastro_de, data_cadastro_ate, data_vencimento_de, data_vencimento_ate } = req.query;
  const condicoes = []; const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (centro_custo_id) { condicoes.push('centro_custo_id = ?'); params.push(centro_custo_id); }
  if (data_cadastro_de) { condicoes.push('date(criado_em) >= ?'); params.push(data_cadastro_de); }
  if (data_cadastro_ate) { condicoes.push('date(criado_em) <= ?'); params.push(data_cadastro_ate); }
  if (data_vencimento_de) { condicoes.push('data >= ?'); params.push(data_vencimento_de); }
  if (data_vencimento_ate) { condicoes.push('data <= ?'); params.push(data_vencimento_ate); }
  const rows = db.prepare(`SELECT * FROM despesas_fixas WHERE ${condicoes.join(' AND ')} ORDER BY data DESC, id DESC`).all(...params);
  res.json(rows);
}));

router.post('/', requerAcessoModulo('despesas_fixas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { centro_custo_id, categoria_id, valor, data, recorrente, descricao, qtd_parcelas, primeira_parcela_vencimento } = req.body;
  if (!centro_custo_id || !categoria_id || valor === undefined) {
    throw new ApiError(400, 'Preencha centro_custo_id, categoria_id e valor.');
  }
  const centroCusto = db.prepare('SELECT * FROM centros_custo WHERE id = ? AND empresa_id = ?').get(centro_custo_id, req.empresaId);
  if (!centroCusto) throw new ApiError(400, 'Centro de custo nao encontrado.');

  const despesa = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, qtd_parcelas, descricao, criado_por)
      VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?, ?)
    `).run(req.empresaId, centro_custo_id, categoria_id, valor, data || null, recorrente ? 1 : 0, qtd_parcelas || null, descricao || null, req.usuario.id);
    const nova = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(info.lastInsertRowid);

    const categoria = db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(categoria_id);
    const nomeBase = `${categoria ? categoria.nome : 'Despesa fixa'} - ${centroCusto.nome}`;

    if (qtd_parcelas && qtd_parcelas > 1) {
      // Parcelada: mesmo padrao de financiamentos - uma parcela por mes,
      // rateio com resto ajustado na ultima, uma conta_pagar por parcela.
      const primeiroVencimento = primeira_parcela_vencimento || data || hojeIsoBrasilia();
      const valorBase = Math.floor(valor / qtd_parcelas);
      const resto = valor - valorBase * qtd_parcelas;
      for (let numero = 1; numero <= qtd_parcelas; numero += 1) {
        const valorParcela = numero === qtd_parcelas ? valorBase + resto : valorBase;
        const vencimento = somarMeses(primeiroVencimento, numero - 1);
        const parcelaInfo = db.prepare(`
          INSERT INTO despesa_fixa_parcelas (empresa_id, despesa_fixa_id, numero_parcela, data_vencimento, valor_parcela)
          VALUES (?, ?, ?, ?, ?)
        `).run(req.empresaId, nova.id, numero, vencimento, valorParcela);
        db.prepare(`
          INSERT INTO contas_pagar (empresa_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
          VALUES (?, ?, ?, ?, ?, 'Pendente', 'DespesaFixaParcela', ?)
        `).run(req.empresaId, centro_custo_id, `${nomeBase} - parcela ${numero}/${qtd_parcelas}`, valorParcela, vencimento, parcelaInfo.lastInsertRowid);
      }
    } else {
      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), 'Pendente', 'DespesaFixa', ?)
      `).run(req.empresaId, centro_custo_id, nomeBase, valor, data || null, nova.id);
    }

    return buscarDespesaFixaCompleta(nova.id, req.empresaId);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_fixas', registroId: despesa.id, acao: 'INSERT', depois: despesa });
  res.status(201).json(despesa);
}));

router.get('/:id', requerAcessoModulo('despesas_fixas', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const despesa = buscarDespesaFixaCompleta(req.params.id, req.empresaId);
  if (!despesa) throw new ApiError(404, 'Despesa fixa nao encontrada.');
  res.json(despesa);
}));

router.put('/:id', requerAcessoModulo('despesas_fixas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM despesas_fixas WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Despesa fixa nao encontrada.');
  const campos = ['categoria_id', 'valor', 'data', 'recorrente', 'descricao'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE despesas_fixas SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_fixas', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('despesas_fixas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = buscarDespesaFixaCompleta(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Despesa fixa nao encontrada.');

  if (antes.qtd_parcelas) {
    const temParcelaPaga = antes.parcelas.some((p) => p.status === 'Paga');
    if (temParcelaPaga) throw new ApiError(400, 'Nao e possivel excluir uma despesa fixa com parcelas ja pagas.');
    withTransaction(db, () => {
      db.prepare("DELETE FROM contas_pagar WHERE origem_tipo = 'DespesaFixaParcela' AND origem_id IN (SELECT id FROM despesa_fixa_parcelas WHERE despesa_fixa_id = ?)").run(req.params.id);
      db.prepare('DELETE FROM despesas_fixas WHERE id = ?').run(req.params.id);
    });
  } else {
    const contaPagar = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(antes.id);
    if (contaPagar && contaPagar.status !== 'Pendente') throw new ApiError(400, 'Esta despesa ja possui pagamento lancado e nao pode ser excluida.');
    withTransaction(db, () => {
      if (contaPagar) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(contaPagar.id);
      db.prepare('DELETE FROM despesas_fixas WHERE id = ?').run(req.params.id);
    });
  }
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_fixas', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
