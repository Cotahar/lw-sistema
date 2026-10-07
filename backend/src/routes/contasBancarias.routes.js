const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');
const { desfazerTransferencia } = require('../utils/transferenciaHelper');

const router = express.Router();

router.get('/', requerAcessoModulo('contas_bancarias', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const condicoes = []; const params = [];
  condicaoEmpresa(condicoes, params, req);
  res.json(db.prepare(`SELECT * FROM contas_bancarias WHERE ${condicoes.join(' AND ')} ORDER BY nome`).all(...params));
}));

// ---- Transferencias entre contas ----
// (declaradas antes de '/:id' pra "transferencias" nao ser lido como um id)

// Historico de transferencias da empresa (mais recentes primeiro). Com
// conta_bancaria_id, traz as que tiveram essa conta como origem OU destino.
router.get('/transferencias', requerAcessoModulo('contas_bancarias', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conta_bancaria_id, data_de, data_ate } = req.query;
  const condicoes = ['t.empresa_id = ?'];
  const params = [req.empresaId];
  if (conta_bancaria_id) { condicoes.push('(t.conta_origem_id = ? OR t.conta_destino_id = ?)'); params.push(conta_bancaria_id, conta_bancaria_id); }
  if (data_de) { condicoes.push('t.data >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('t.data <= ?'); params.push(data_ate); }
  res.json(db.prepare(`
    SELECT t.*, co.nome AS conta_origem_nome, cd.nome AS conta_destino_nome, u.nome AS criado_por_nome
    FROM transferencias_contas t
    JOIN contas_bancarias co ON co.id = t.conta_origem_id
    JOIN contas_bancarias cd ON cd.id = t.conta_destino_id
    LEFT JOIN usuarios u ON u.id = t.criado_por
    WHERE ${condicoes.join(' AND ')}
    ORDER BY t.data DESC, t.id DESC
  `).all(...params));
}));

// Move saldo de uma conta para outra: uma Saida na origem e uma Entrada no
// destino (ambas em movimentacoes_caixa, origem_tipo 'Transferencia'), numa
// transacao so. Nao bloqueia saldo insuficiente (conta com limite/cheque
// especial e comum) - devolve o saldo resultante das duas contas pra tela
// poder avisar.
router.post('/transferencias', requerAcessoModulo('contas_bancarias', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conta_origem_id, conta_destino_id, valor, data, descricao } = req.body;
  if (!conta_origem_id || !conta_destino_id) throw new ApiError(400, 'Informe a conta de origem e a conta de destino.');
  if (Number(conta_origem_id) === Number(conta_destino_id)) throw new ApiError(400, 'A conta de destino precisa ser diferente da conta de origem.');
  if (!Number.isInteger(valor) || valor <= 0) throw new ApiError(400, 'Informe um valor maior que zero.');
  if (data !== undefined && data !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(String(data)) || Number.isNaN(Date.parse(`${data}T00:00:00Z`)))) {
    throw new ApiError(400, 'Informe uma data valida (AAAA-MM-DD).');
  }

  const origem = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(conta_origem_id, req.empresaId);
  const destino = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(conta_destino_id, req.empresaId);
  if (!origem || !destino) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  if (!origem.ativo || !destino.ativo) throw new ApiError(400, 'As duas contas precisam estar ativas.');

  const observacao = descricao ? String(descricao).trim().toUpperCase() : null;
  const transferencia = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO transferencias_contas (empresa_id, conta_origem_id, conta_destino_id, valor, data, descricao, criado_por)
      VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?)
    `).run(req.empresaId, origem.id, destino.id, valor, data || null, observacao, req.usuario.id);
    const id = info.lastInsertRowid;
    const criada = db.prepare('SELECT * FROM transferencias_contas WHERE id = ?').get(id);
    const sufixo = observacao ? ` - ${observacao}` : '';
    const inserirMov = db.prepare(`
      INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, origem_id, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, 'Transferencia', ?, ?)
    `);
    inserirMov.run(req.empresaId, origem.id, 'Saida', valor, criada.data, `TRANSFERENCIA PARA ${destino.nome}${sufixo}`, id, req.usuario.id);
    inserirMov.run(req.empresaId, destino.id, 'Entrada', valor, criada.data, `TRANSFERENCIA DE ${origem.nome}${sufixo}`, id, req.usuario.id);
    db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual - ? WHERE id = ?').run(valor, origem.id);
    db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(valor, destino.id);
    return criada;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'transferencias_contas', registroId: transferencia.id, acao: 'INSERT', depois: transferencia });
  res.status(201).json({
    ...transferencia,
    saldo_origem_apos: db.prepare('SELECT saldo_atual FROM contas_bancarias WHERE id = ?').get(origem.id).saldo_atual,
    saldo_destino_apos: db.prepare('SELECT saldo_atual FROM contas_bancarias WHERE id = ?').get(destino.id).saldo_atual,
  });
}));

// Desfaz a transferencia por completo (devolve os dois saldos e some das duas
// contas) - o historico fica registrado na auditoria.
router.delete('/transferencias/:id', requerAcessoModulo('contas_bancarias', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM transferencias_contas WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Transferencia nao encontrada.');
  withTransaction(db, () => desfazerTransferencia(antes.id));
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'transferencias_contas', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

router.get('/:id', requerAcessoModulo('contas_bancarias', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  res.json(conta);
}));

router.post('/', requerAcessoModulo('contas_bancarias', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { nome, banco, agencia, conta, saldo_atual } = req.body;
  if (!nome) throw new ApiError(400, 'Informe o nome da conta.');
  const info = db.prepare('INSERT INTO contas_bancarias (empresa_id, nome, banco, agencia, conta, saldo_atual) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.empresaId, nome.toUpperCase(), banco ? banco.toUpperCase() : null, agencia || null, conta || null, saldo_atual || 0);
  const nova = db.prepare('SELECT * FROM contas_bancarias WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_bancarias', registroId: nova.id, acao: 'INSERT', depois: nova });
  res.status(201).json(nova);
}));

router.put('/:id', requerAcessoModulo('contas_bancarias', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  const campos = ['nome', 'banco', 'agencia', 'conta', 'ativo'];
  const camposTexto = ['nome', 'banco'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      sets.push(`${campo} = ?`);
      valores.push(camposTexto.includes(campo) && req.body[campo] ? String(req.body[campo]).toUpperCase() : req.body[campo]);
    }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE contas_bancarias SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM contas_bancarias WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_bancarias', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.get('/:id/movimentacoes', requerAcessoModulo('contas_bancarias', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT id FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  res.json(db.prepare('SELECT * FROM movimentacoes_caixa WHERE conta_bancaria_id = ? ORDER BY data DESC, id DESC').all(req.params.id));
}));

// Ajuste manual de caixa (nao ligado a uma Conta a Pagar/Receber). Usado, por
// exemplo, no "Fechamento Livre" do acerto de viagem quando o operador precisa
// corrigir o caixa manualmente.
router.post('/:id/movimentacoes', requerAcessoModulo('contas_bancarias', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  const { tipo, valor, data, descricao } = req.body;
  if (!tipo || !valor) throw new ApiError(400, 'Preencha tipo e valor.');
  if (!['Entrada', 'Saida'].includes(tipo)) throw new ApiError(400, "Tipo deve ser 'Entrada' ou 'Saida'.");

  const movimentacao = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, criado_por)
      VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, 'Ajuste', ?)
    `).run(req.empresaId, conta.id, tipo, valor, data || null, descricao || null, req.usuario.id);
    const delta = tipo === 'Entrada' ? valor : -valor;
    db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(delta, conta.id);
    return db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(info.lastInsertRowid);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'movimentacoes_caixa', registroId: movimentacao.id, acao: 'INSERT', depois: movimentacao });
  res.status(201).json(movimentacao);
}));

module.exports = router;
