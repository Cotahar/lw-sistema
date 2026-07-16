const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const router = express.Router();
const TIPOS = ['Preventiva', 'Corretiva'];

function buscarOsCompleta(id) {
  const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(id);
  if (!os) return null;
  const itens = db.prepare('SELECT * FROM os_itens WHERE os_id = ?').all(id);
  return { ...os, itens };
}

router.get('/', requerAcessoModulo('manutencao', 'Visualizar'), asyncHandler(async (req, res) => {
  const { veiculo_id } = req.query;
  const rows = veiculo_id
    ? db.prepare('SELECT * FROM ordens_servico WHERE veiculo_id = ? ORDER BY data DESC, id DESC').all(veiculo_id)
    : db.prepare('SELECT * FROM ordens_servico ORDER BY data DESC, id DESC').all();
  res.json(rows);
}));

router.get('/:id', requerAcessoModulo('manutencao', 'Visualizar'), asyncHandler(async (req, res) => {
  const os = buscarOsCompleta(req.params.id);
  if (!os) throw new ApiError(404, 'Ordem de servico nao encontrada.');
  res.json(os);
}));

// Itens que referenciam estoque_item_id geram baixa automatica no estoque
// (estoque_movimentacoes com os_id preenchido), para nao contar o custo duas
// vezes no DRE (valor_pecas da OS ja cobre esse custo).
router.post('/', requerAcessoModulo('manutencao', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { data, veiculo_id, hodometro, tipo, fornecedor_id, valor_pecas, valor_mao_obra, descricao, itens } = req.body;
  if (!veiculo_id || hodometro === undefined || !tipo) throw new ApiError(400, 'Preencha veiculo_id, hodometro e tipo.');
  if (!TIPOS.includes(tipo)) throw new ApiError(400, `Tipo invalido. Use um de: ${TIPOS.join(', ')}`);

  const os = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO ordens_servico (data, veiculo_id, hodometro, tipo, fornecedor_id, valor_pecas, valor_mao_obra, descricao, criado_por)
      VALUES (COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data || null, veiculo_id, hodometro, tipo, fornecedor_id || null, valor_pecas || 0, valor_mao_obra || 0, descricao || null, req.usuario.id);
    const osId = info.lastInsertRowid;

    for (const item of itens || []) {
      if (!item.descricao || item.quantidade === undefined || item.valor_unitario === undefined) {
        throw new ApiError(400, 'Cada item da OS precisa de descricao, quantidade e valor_unitario.');
      }
      db.prepare(`
        INSERT INTO os_itens (os_id, estoque_item_id, pneu_id, descricao, quantidade, valor_unitario)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(osId, item.estoque_item_id || null, item.pneu_id || null, item.descricao, item.quantidade, item.valor_unitario);

      if (item.estoque_item_id) {
        const estoqueItem = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(item.estoque_item_id);
        if (!estoqueItem) throw new ApiError(400, `Item de estoque id ${item.estoque_item_id} nao existe.`);
        if (item.quantidade > estoqueItem.quantidade_atual) {
          throw new ApiError(400, `Estoque insuficiente para ${estoqueItem.nome}: disponivel ${estoqueItem.quantidade_atual}, solicitado ${item.quantidade}.`);
        }
        db.prepare(`
          INSERT INTO estoque_movimentacoes (item_id, tipo, quantidade, custo_unitario, veiculo_destino_id, os_id, criado_por)
          VALUES (?, 'Saida', ?, ?, ?, ?, ?)
        `).run(item.estoque_item_id, item.quantidade, item.valor_unitario, veiculo_id, osId, req.usuario.id);
        db.prepare("UPDATE estoque_itens SET quantidade_atual = quantidade_atual - ?, atualizado_em = datetime('now') WHERE id = ?")
          .run(item.quantidade, item.estoque_item_id);
      }
    }

    if ((valor_pecas || valor_mao_obra) && (valor_pecas + valor_mao_obra) > 0) {
      db.prepare(`
        INSERT INTO contas_pagar (fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, COALESCE(?, date('now')), 'Pendente', 'OrdemServico', ?)
      `).run(fornecedor_id || null, `Ordem de servico #${osId}`, Math.round((valor_pecas || 0) + (valor_mao_obra || 0)), data || null, osId);
    }

    return buscarOsCompleta(osId);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'ordens_servico', registroId: os.id, acao: 'INSERT', depois: os });
  res.status(201).json(os);
}));

router.put('/:id', requerAcessoModulo('manutencao', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = buscarOsCompleta(req.params.id);
  if (!antes) throw new ApiError(404, 'Ordem de servico nao encontrada.');
  // So o cabecalho e editavel; itens sao historico permanente (ligados a baixas de estoque ja feitas).
  const campos = ['data', 'hodometro', 'tipo', 'fornecedor_id', 'valor_pecas', 'valor_mao_obra', 'descricao'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE ordens_servico SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = buscarOsCompleta(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'ordens_servico', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('manutencao', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = buscarOsCompleta(req.params.id);
  if (!antes) throw new ApiError(404, 'Ordem de servico nao encontrada.');
  // Bloqueada pelo banco (FK) se houver baixa de estoque vinculada — protege contra
  // excluir uma OS que ja gerou efeito real no estoque/DRE.
  db.prepare('DELETE FROM ordens_servico WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'ordens_servico', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
