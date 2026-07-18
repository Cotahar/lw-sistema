const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const router = express.Router();
const CATEGORIAS = ['Peca', 'Acessorio', 'EPI', 'Utensilio'];

// ---- Catalogo (estoque_itens) ----
// quantidade_atual e custo_medio NAO entram na whitelist de edicao: so mudam
// via estoque_movimentacoes, para preservar a regra Caixa vs. DRE.

router.get('/itens', requerAcessoModulo('estoque', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { search } = req.query;
  const condicoes = []; const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (search) { condicoes.push('nome LIKE ?'); params.push(`%${search}%`); }
  res.json(db.prepare(`SELECT * FROM estoque_itens WHERE ${condicoes.join(' AND ')} ORDER BY nome`).all(...params));
}));

router.get('/itens/:id', requerAcessoModulo('estoque', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const item = db.prepare('SELECT * FROM estoque_itens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!item) throw new ApiError(404, 'Item de estoque nao encontrado.');
  res.json(item);
}));

router.post('/itens', requerAcessoModulo('estoque', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { nome, categoria, unidade_medida, estoque_minimo } = req.body;
  if (!nome || !categoria) throw new ApiError(400, 'Preencha nome e categoria.');
  if (!CATEGORIAS.includes(categoria)) throw new ApiError(400, `Categoria invalida. Use uma de: ${CATEGORIAS.join(', ')}`);
  const info = db.prepare(`
    INSERT INTO estoque_itens (empresa_id, nome, categoria, unidade_medida, estoque_minimo)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.empresaId, nome, categoria, unidade_medida || 'UN', estoque_minimo || 0);
  const item = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'estoque_itens', registroId: item.id, acao: 'INSERT', depois: item });
  res.status(201).json(item);
}));

router.put('/itens/:id', requerAcessoModulo('estoque', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM estoque_itens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Item de estoque nao encontrado.');
  const campos = ['nome', 'categoria', 'unidade_medida', 'estoque_minimo', 'ativo'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  sets.push("atualizado_em = datetime('now')");
  db.prepare(`UPDATE estoque_itens SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'estoque_itens', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/itens/:id', requerAcessoModulo('estoque', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM estoque_itens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Item de estoque nao encontrado.');
  db.prepare('DELETE FROM estoque_itens WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'estoque_itens', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// ---- Movimentacoes (entrada/saida) ----
// Entrada: soma ao estoque, recalcula custo medio ponderado, gera Conta a Pagar (fluxo de caixa).
// Saida com veiculo_destino_id: e o que lanca o custo no DRE do veiculo (a nao ser que venha
// de uma OS, os_id preenchido, cujo custo ja esta em ordens_servico.valor_pecas).

router.get('/movimentacoes', requerAcessoModulo('estoque', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { item_id, veiculo_id } = req.query;
  const condicoes = [];
  const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (item_id) { condicoes.push('item_id = ?'); params.push(item_id); }
  if (veiculo_id) { condicoes.push('veiculo_destino_id = ?'); params.push(veiculo_id); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  res.json(db.prepare(`SELECT * FROM estoque_movimentacoes ${where} ORDER BY data DESC, id DESC`).all(...params));
}));

router.post('/movimentacoes', requerAcessoModulo('estoque', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { item_id, tipo, quantidade, custo_unitario, fornecedor_id, veiculo_destino_id, os_id, observacao } = req.body;
  if (!item_id || !tipo || !quantidade || custo_unitario === undefined) {
    throw new ApiError(400, 'Preencha item_id, tipo, quantidade e custo_unitario.');
  }
  if (!['Entrada', 'Saida'].includes(tipo)) throw new ApiError(400, "Tipo deve ser 'Entrada' ou 'Saida'.");
  if (quantidade <= 0) throw new ApiError(400, 'Quantidade deve ser maior que zero.');

  const resultado = withTransaction(db, () => {
    const item = db.prepare('SELECT * FROM estoque_itens WHERE id = ? AND empresa_id = ?').get(item_id, req.empresaId);
    if (!item) throw new ApiError(400, 'Item de estoque nao encontrado.');

    if (tipo === 'Saida' && quantidade > item.quantidade_atual) {
      throw new ApiError(400, `Estoque insuficiente: disponivel ${item.quantidade_atual}, solicitado ${quantidade}.`);
    }

    const info = db.prepare(`
      INSERT INTO estoque_movimentacoes (empresa_id, item_id, tipo, quantidade, custo_unitario, fornecedor_id, veiculo_destino_id, os_id, observacao, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.empresaId, item_id, tipo, quantidade, custo_unitario, fornecedor_id || null, veiculo_destino_id || null, os_id || null, observacao || null, req.usuario.id);

    if (tipo === 'Entrada') {
      const novoTotal = item.quantidade_atual + quantidade;
      const novoCustoMedio = Math.round((item.quantidade_atual * item.custo_medio + quantidade * custo_unitario) / novoTotal);
      db.prepare("UPDATE estoque_itens SET quantidade_atual = ?, custo_medio = ?, atualizado_em = datetime('now') WHERE id = ?")
        .run(novoTotal, novoCustoMedio, item_id);

      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, ?, date('now'), 'Pendente', 'EstoqueMovimentacao', ?)
      `).run(req.empresaId, fornecedor_id || null, `Compra de estoque: ${item.nome} x${quantidade}`, Math.round(quantidade * custo_unitario), info.lastInsertRowid);
    } else {
      db.prepare("UPDATE estoque_itens SET quantidade_atual = quantidade_atual - ?, atualizado_em = datetime('now') WHERE id = ?")
        .run(quantidade, item_id);
    }

    const movimentacao = db.prepare('SELECT * FROM estoque_movimentacoes WHERE id = ?').get(info.lastInsertRowid);
    const itemAtualizado = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(item_id);
    return { movimentacao, item: itemAtualizado };
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'estoque_movimentacoes', registroId: resultado.movimentacao.id, acao: 'INSERT', depois: resultado.movimentacao });
  res.status(201).json(resultado);
}));

module.exports = router;
