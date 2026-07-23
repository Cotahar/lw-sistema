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
const TIPOS = ['Preventiva', 'Corretiva'];

function somarMeses(dataIso, meses) {
  const data = new Date(`${dataIso}T00:00:00Z`);
  data.setUTCMonth(data.getUTCMonth() + meses);
  return data.toISOString().slice(0, 10);
}

function buscarOsCompleta(id, empresaId) {
  const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ? AND empresa_id = ?').get(id, empresaId);
  if (!os) return null;
  const itens = db.prepare('SELECT * FROM os_itens WHERE os_id = ?').all(id);
  const parcelas = db.prepare('SELECT * FROM os_parcelas WHERE os_id = ? ORDER BY numero_parcela').all(id);
  return { ...os, itens, parcelas };
}

router.get('/', requerAcessoModulo('manutencao', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id } = req.query;
  const condicoes = []; const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (veiculo_id) { condicoes.push('veiculo_id = ?'); params.push(veiculo_id); }
  const rows = db.prepare(`SELECT * FROM ordens_servico WHERE ${condicoes.join(' AND ')} ORDER BY data DESC, id DESC`).all(...params);
  res.json(rows);
}));

router.get('/:id', requerAcessoModulo('manutencao', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const os = buscarOsCompleta(req.params.id, req.empresaId);
  if (!os) throw new ApiError(404, 'Ordem de servico nao encontrada.');
  res.json(os);
}));

// Itens que referenciam estoque_item_id geram baixa automatica no estoque
// (estoque_movimentacoes com os_id preenchido), para nao contar o custo duas
// vezes no DRE (valor_pecas da OS ja cobre esse custo).
router.post('/', requerAcessoModulo('manutencao', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const {
    data, veiculo_id, hodometro, tipo, fornecedor_id, valor_pecas, valor_mao_obra, descricao, itens,
    qtd_parcelas, primeira_parcela_vencimento,
  } = req.body;
  if (!veiculo_id || hodometro === undefined || !tipo) throw new ApiError(400, 'Preencha veiculo_id, hodometro e tipo.');
  if (!TIPOS.includes(tipo)) throw new ApiError(400, `Tipo invalido. Use um de: ${TIPOS.join(', ')}`);

  const os = withTransaction(db, () => {
    const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND empresa_id = ?').get(veiculo_id, req.empresaId);
    if (!veiculo) throw new ApiError(400, 'Veiculo nao encontrado nesta empresa.');

    const info = db.prepare(`
      INSERT INTO ordens_servico (empresa_id, data, veiculo_id, hodometro, tipo, fornecedor_id, valor_pecas, valor_mao_obra, qtd_parcelas, descricao, criado_por)
      VALUES (?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.empresaId, data || null, veiculo_id, hodometro, tipo, fornecedor_id || null, valor_pecas || 0, valor_mao_obra || 0, qtd_parcelas || null, descricao || null, req.usuario.id);
    const osId = info.lastInsertRowid;

    for (const item of itens || []) {
      if (!item.descricao || item.quantidade === undefined || item.valor_unitario === undefined) {
        throw new ApiError(400, 'Cada item da OS precisa de descricao, quantidade e valor_unitario.');
      }
      db.prepare(`
        INSERT INTO os_itens (empresa_id, os_id, estoque_item_id, pneu_id, descricao, quantidade, valor_unitario)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.empresaId, osId, item.estoque_item_id || null, item.pneu_id || null, item.descricao, item.quantidade, item.valor_unitario);

      if (item.estoque_item_id) {
        const estoqueItem = db.prepare('SELECT * FROM estoque_itens WHERE id = ? AND empresa_id = ?').get(item.estoque_item_id, req.empresaId);
        if (!estoqueItem) throw new ApiError(400, `Item de estoque id ${item.estoque_item_id} nao existe.`);
        if (item.quantidade > estoqueItem.quantidade_atual) {
          throw new ApiError(400, `Estoque insuficiente para ${estoqueItem.nome}: disponivel ${estoqueItem.quantidade_atual}, solicitado ${item.quantidade}.`);
        }
        db.prepare(`
          INSERT INTO estoque_movimentacoes (empresa_id, item_id, tipo, quantidade, custo_unitario, veiculo_destino_id, os_id, criado_por)
          VALUES (?, ?, 'Saida', ?, ?, ?, ?, ?)
        `).run(req.empresaId, item.estoque_item_id, item.quantidade, item.valor_unitario, veiculo_id, osId, req.usuario.id);
        db.prepare("UPDATE estoque_itens SET quantidade_atual = quantidade_atual - ?, atualizado_em = datetime('now', '-3 hours') WHERE id = ?")
          .run(item.quantidade, item.estoque_item_id);
      }
    }

    const valorTotal = Math.round((valor_pecas || 0) + (valor_mao_obra || 0));
    if (valorTotal > 0) {
      if (qtd_parcelas && qtd_parcelas > 1) {
        // Parcelada: mesmo padrao de financiamentos/despesas fixas - uma
        // parcela por mes, rateio com resto ajustado na ultima, uma
        // conta_pagar por parcela (a peca/mao de obra sai como um bloco so).
        const primeiroVencimento = primeira_parcela_vencimento || data || hojeIsoBrasilia();
        const valorBase = Math.floor(valorTotal / qtd_parcelas);
        const resto = valorTotal - valorBase * qtd_parcelas;
        for (let numero = 1; numero <= qtd_parcelas; numero += 1) {
          const valorParcela = numero === qtd_parcelas ? valorBase + resto : valorBase;
          const vencimento = somarMeses(primeiroVencimento, numero - 1);
          const parcelaInfo = db.prepare(`
            INSERT INTO os_parcelas (empresa_id, os_id, numero_parcela, data_vencimento, valor_parcela)
            VALUES (?, ?, ?, ?, ?)
          `).run(req.empresaId, osId, numero, vencimento, valorParcela);
          db.prepare(`
            INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
            VALUES (?, ?, ?, ?, ?, 'Pendente', 'OrdemServicoParcela', ?)
          `).run(req.empresaId, fornecedor_id || null, `Ordem de servico #${osId} - parcela ${numero}/${qtd_parcelas}`, valorParcela, vencimento, parcelaInfo.lastInsertRowid);
        }
      } else {
        db.prepare(`
          INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
          VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), 'Pendente', 'OrdemServico', ?)
        `).run(req.empresaId, fornecedor_id || null, `Ordem de servico #${osId}`, valorTotal, data || null, osId);
      }
    }

    return buscarOsCompleta(osId, req.empresaId);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'ordens_servico', registroId: os.id, acao: 'INSERT', depois: os });
  res.status(201).json(os);
}));

router.put('/:id', requerAcessoModulo('manutencao', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = buscarOsCompleta(req.params.id, req.empresaId);
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
  const depois = buscarOsCompleta(req.params.id, req.empresaId);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'ordens_servico', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('manutencao', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = buscarOsCompleta(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Ordem de servico nao encontrada.');

  if (antes.qtd_parcelas) {
    if (antes.parcelas.some((p) => p.status === 'Paga')) throw new ApiError(400, 'Nao e possivel excluir uma OS com parcelas ja pagas.');
  } else {
    const contaPagar = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'OrdemServico' AND origem_id = ?").get(antes.id);
    if (contaPagar && contaPagar.status !== 'Pendente') throw new ApiError(400, 'Esta ordem de servico ja possui pagamento lancado e nao pode ser excluida.');
  }

  // Bloqueada pelo banco (FK) se houver baixa de estoque vinculada — protege contra
  // excluir uma OS que ja gerou efeito real no estoque/DRE.
  withTransaction(db, () => {
    if (antes.qtd_parcelas) {
      db.prepare("DELETE FROM contas_pagar WHERE origem_tipo = 'OrdemServicoParcela' AND origem_id IN (SELECT id FROM os_parcelas WHERE os_id = ?)").run(req.params.id);
    } else {
      db.prepare("DELETE FROM contas_pagar WHERE origem_tipo = 'OrdemServico' AND origem_id = ?").run(req.params.id);
    }
    db.prepare('DELETE FROM ordens_servico WHERE id = ?').run(req.params.id);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'ordens_servico', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
