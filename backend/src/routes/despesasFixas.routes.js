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
  const rateio = despesa.rateio_id ? db.prepare('SELECT id, centro_custo_id, valor FROM despesas_fixas WHERE rateio_id = ? ORDER BY id').all(despesa.rateio_id) : null;
  return { ...despesa, parcelas, rateio };
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
  const rows = db.prepare(`
    SELECT d.*,
           (SELECT SUM(r.valor) FROM despesas_fixas r WHERE r.rateio_id = d.rateio_id) AS rateio_total,
           (SELECT COUNT(*) FROM despesas_fixas r WHERE r.rateio_id = d.rateio_id) AS rateio_qtd
    FROM despesas_fixas d WHERE ${condicoes.join(' AND ').replace(/(^|\s|\()(centro_custo_id|criado_em|data|empresa_id)\b/g, '$1d.$2')} ORDER BY d.data DESC, d.id DESC
  `).all(...params);
  res.json(rows);
}));

// Lancamento RATEADO: um valor total (ex.: Sem Parar R$ 10.000) dividido entre
// varios centros de custo (placas / Base). Gera UMA conta a pagar com o total e
// uma linha de despesa fixa por centro (a parte de cada um - e o que o DRE soma
// por placa/conjunto). Sem parcelamento.
function criarDespesaRateada(req) {
  const { rateios, categoria_id, valor, data, recorrente, descricao, qtd_parcelas, fornecedor_id, data_vencimento } = req.body;
  if (qtd_parcelas) throw new ApiError(400, 'Despesa rateada entre centros de custo nao pode ser parcelada.');
  if (!categoria_id) throw new ApiError(400, 'Informe a categoria da despesa.');
  if (!Array.isArray(rateios) || rateios.length < 2) throw new ApiError(400, 'Informe ao menos 2 centros de custo para ratear a despesa.');
  const ids = rateios.map((r) => Number(r.centro_custo_id));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new ApiError(400, 'Cada linha do rateio precisa de um centro de custo.');
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'O mesmo centro de custo aparece mais de uma vez no rateio.');
  if (rateios.some((r) => !Number.isInteger(r.valor) || r.valor <= 0)) throw new ApiError(400, 'Cada centro de custo precisa de um valor maior que zero.');
  const soma = rateios.reduce((t, r) => t + r.valor, 0);
  if (valor !== undefined && valor !== null && valor !== soma) {
    throw new ApiError(400, `A soma do rateio (${(soma / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) nao bate com o valor total informado (${(valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`);
  }
  const categoria = db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(categoria_id);
  if (!categoria) throw new ApiError(400, 'Categoria nao encontrada.');
  const centros = ids.map((id) => {
    const c = db.prepare('SELECT * FROM centros_custo WHERE id = ? AND empresa_id = ?').get(id, req.empresaId);
    if (!c) throw new ApiError(400, `Centro de custo #${id} nao encontrado.`);
    return c;
  });
  if (fornecedor_id) {
    const f = db.prepare('SELECT id FROM fornecedores WHERE id = ? AND empresa_id = ?').get(fornecedor_id, req.empresaId);
    if (!f) throw new ApiError(400, 'Fornecedor nao encontrado.');
  }
  const nomeDescricao = descricao ? String(descricao).toUpperCase() : null;

  return withTransaction(db, () => {
    const inserir = db.prepare(`
      INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, descricao, criado_por)
      VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?)
    `);
    const linhasIds = rateios.map((r) => inserir.run(req.empresaId, r.centro_custo_id, categoria_id, r.valor, data || null, recorrente ? 1 : 0, nomeDescricao, req.usuario.id).lastInsertRowid);
    const principalId = linhasIds[0];
    db.prepare(`UPDATE despesas_fixas SET rateio_id = ? WHERE id IN (${linhasIds.map(() => '?').join(',')})`).run(principalId, ...linhasIds);
    const nomeConta = `${categoria.nome} - RATEIO ENTRE ${centros.length} CENTROS DE CUSTO${nomeDescricao ? ` - ${nomeDescricao}` : ''}`.toUpperCase();
    const conta = db.prepare(`
      INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
      VALUES (?, ?, NULL, ?, ?, COALESCE(?, ?, date('now', '-3 hours')), 'Pendente', 'DespesaFixa', ?)
    `).run(req.empresaId, fornecedor_id || null, nomeConta, soma, data_vencimento || null, data || null, principalId);
    const despesas = db.prepare(`SELECT * FROM despesas_fixas WHERE rateio_id = ? ORDER BY id`).all(principalId);
    return { rateio_id: principalId, valor_total: soma, conta_pagar_id: conta.lastInsertRowid, despesas };
  });
}

// Exclui o lancamento rateado INTEIRO (todas as linhas + a conta unica) - so se
// a conta ainda nao teve pagamento.
function excluirGrupoRateio(rateioId) {
  const conta = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(rateioId);
  if (conta && conta.status !== 'Pendente') throw new ApiError(400, 'Este lancamento rateado ja possui pagamento lancado e nao pode ser excluido.');
  return withTransaction(db, () => {
    if (conta) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(conta.id);
    db.prepare('DELETE FROM despesas_fixas WHERE rateio_id = ?').run(rateioId);
  });
}

router.post('/', requerAcessoModulo('despesas_fixas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  if (req.body.rateios !== undefined) {
    const resultado = criarDespesaRateada(req);
    for (const d of resultado.despesas) {
      registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_fixas', registroId: d.id, acao: 'INSERT', depois: d });
    }
    return res.status(201).json(resultado);
  }
  const { centro_custo_id, categoria_id, valor, data, recorrente, descricao, qtd_parcelas, primeira_parcela_vencimento, fornecedor_id, data_vencimento } = req.body;
  if (!centro_custo_id || !categoria_id || valor === undefined) {
    throw new ApiError(400, 'Preencha centro_custo_id, categoria_id e valor.');
  }
  const centroCusto = db.prepare('SELECT * FROM centros_custo WHERE id = ? AND empresa_id = ?').get(centro_custo_id, req.empresaId);
  if (!centroCusto) throw new ApiError(400, 'Centro de custo nao encontrado.');

  const despesa = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, qtd_parcelas, descricao, criado_por)
      VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?, ?)
    `).run(req.empresaId, centro_custo_id, categoria_id, valor, data || null, recorrente ? 1 : 0, qtd_parcelas || null, descricao ? descricao.toUpperCase() : null, req.usuario.id);
    const nova = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(info.lastInsertRowid);

    const categoria = db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(categoria_id);
    const nomeBase = `${categoria ? categoria.nome : 'Despesa fixa'} - ${centroCusto.nome}`.toUpperCase();

    if (qtd_parcelas) {
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
        `).run(req.empresaId, centro_custo_id, `${nomeBase} - PARCELA ${numero}/${qtd_parcelas}`, valorParcela, vencimento, parcelaInfo.lastInsertRowid);
      }
    } else {
      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, ?, ?, COALESCE(?, ?, date('now', '-3 hours')), 'Pendente', 'DespesaFixa', ?)
      `).run(req.empresaId, fornecedor_id || null, centro_custo_id, nomeBase, valor, data_vencimento || null, data || null, nova.id);
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
  // Linha de um lancamento rateado: o valor/data/categoria definem o rateio e a
  // conta unica - mudar so uma parte desfaria a soma. Corrige-se excluindo o
  // lancamento rateado e lancando de novo.
  if (antes.rateio_id && ['valor', 'data', 'categoria_id'].some((c) => req.body[c] !== undefined && req.body[c] !== antes[c])) {
    throw new ApiError(400, 'Esta despesa faz parte de um lancamento rateado: valor, data e categoria nao podem ser alterados. Exclua o rateio e lance de novo.');
  }
  const campos = ['categoria_id', 'valor', 'data', 'recorrente', 'descricao'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(campo === 'descricao' && req.body[campo] ? String(req.body[campo]).toUpperCase() : req.body[campo]); }
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

  if (antes.rateio_id) {
    const grupo = db.prepare('SELECT * FROM despesas_fixas WHERE rateio_id = ?').all(antes.rateio_id);
    excluirGrupoRateio(antes.rateio_id);
    for (const d of grupo) registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_fixas', registroId: d.id, acao: 'DELETE', antes: d });
    return res.status(204).send();
  }

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

router.post('/batch-delete', requerAcessoModulo('despesas_fixas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'Informe a lista de ids a excluir.');
  const gruposJaTratados = new Set();
  const registros = ids.map((id) => {
    const antes = buscarDespesaFixaCompleta(id, req.empresaId);
    if (!antes) throw new ApiError(404, `Despesa fixa #${id} nao encontrada.`);
    if (antes.rateio_id) {
      // Lancamento rateado: apaga o grupo inteiro (uma vez so, mesmo com varias linhas marcadas).
      if (gruposJaTratados.has(antes.rateio_id)) return null;
      gruposJaTratados.add(antes.rateio_id);
      const conta = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(antes.rateio_id);
      if (conta && conta.status !== 'Pendente') throw new ApiError(400, `O lancamento rateado da despesa #${id} ja possui pagamento lancado e nao pode ser excluido em lote.`);
      return antes;
    }
    if (antes.qtd_parcelas) {
      if (antes.parcelas.some((p) => p.status === 'Paga')) throw new ApiError(400, `A despesa fixa #${id} tem parcelas ja pagas e nao pode ser excluida em lote.`);
    } else {
      const contaPagar = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(antes.id);
      if (contaPagar && contaPagar.status !== 'Pendente') throw new ApiError(400, `A despesa fixa #${id} ja possui pagamento lancado e nao pode ser excluida em lote.`);
    }
    return antes;
  }).filter(Boolean);
  withTransaction(db, () => {
    for (const antes of registros) {
      if (antes.rateio_id) {
        const grupo = db.prepare('SELECT * FROM despesas_fixas WHERE rateio_id = ?').all(antes.rateio_id);
        db.prepare("DELETE FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").run(antes.rateio_id);
        db.prepare('DELETE FROM despesas_fixas WHERE rateio_id = ?').run(antes.rateio_id);
        for (const d of grupo) registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_fixas', registroId: d.id, acao: 'DELETE', antes: d });
        continue;
      }
      if (antes.qtd_parcelas) {
        db.prepare("DELETE FROM contas_pagar WHERE origem_tipo = 'DespesaFixaParcela' AND origem_id IN (SELECT id FROM despesa_fixa_parcelas WHERE despesa_fixa_id = ?)").run(antes.id);
      } else {
        db.prepare("DELETE FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").run(antes.id);
      }
      db.prepare('DELETE FROM despesas_fixas WHERE id = ?').run(antes.id);
      registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_fixas', registroId: antes.id, acao: 'DELETE', antes });
    }
  });
  res.status(204).send();
}));

module.exports = router;
