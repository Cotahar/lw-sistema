const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { registrarAuditoria } = require('../utils/audit');

const router = express.Router();

const PRAZO_INDICACAO_DIAS = 30; // art. 257 par. 8 CTB

function somarDias(dataIso, dias) {
  const data = new Date(`${dataIso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function diasRestantes(prazoIso) {
  const hoje = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const prazo = new Date(`${prazoIso}T00:00:00Z`);
  return Math.round((prazo - hoje) / 86400000);
}

function comDiasRestantes(multa) {
  return { ...multa, dias_restantes: multa.status === 'AguardandoIndicacao' ? diasRestantes(multa.prazo_indicacao) : null };
}

const SELECT_LISTA = `
  SELECT m.*, v.placa AS veiculo_placa, mo.nome AS motorista_nome
  FROM multas m
  JOIN veiculos v ON v.id = m.veiculo_id
  LEFT JOIN motoristas mo ON mo.id = m.motorista_id
`;

router.get('/', requerAcessoModulo('multas', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { status, veiculo_id, motorista_id } = req.query;
  const condicoes = ['m.empresa_id = ?'];
  const params = [req.empresaId];
  if (status) { condicoes.push('m.status = ?'); params.push(status); }
  if (veiculo_id) { condicoes.push('m.veiculo_id = ?'); params.push(veiculo_id); }
  if (motorista_id) { condicoes.push('m.motorista_id = ?'); params.push(motorista_id); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  const linhas = db.prepare(`${SELECT_LISTA} ${where} ORDER BY m.prazo_indicacao`).all(...params);
  res.json(linhas.map(comDiasRestantes));
}));

router.get('/:id', requerAcessoModulo('multas', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const multa = db.prepare(`${SELECT_LISTA} WHERE m.id = ? AND m.empresa_id = ?`).get(req.params.id, req.empresaId);
  if (!multa) throw new ApiError(404, 'Multa nao encontrada.');
  res.json(comDiasRestantes(multa));
}));

router.post('/', requerAcessoModulo('multas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const {
    veiculo_id, motorista_id, orgao_autuador, numero_ait, descricao,
    valor_original, data_infracao, data_notificacao, observacoes,
  } = req.body;
  if (!veiculo_id || !descricao || !valor_original || !data_notificacao) {
    throw new ApiError(400, 'Preencha veiculo_id, descricao, valor_original e data_notificacao.');
  }

  const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND empresa_id = ?').get(veiculo_id, req.empresaId);
  if (!veiculo) throw new ApiError(400, 'Veiculo nao encontrado nesta empresa.');
  if (motorista_id) {
    const motorista = db.prepare('SELECT id FROM motoristas WHERE id = ? AND empresa_id = ?').get(motorista_id, req.empresaId);
    if (!motorista) throw new ApiError(400, 'Motorista nao encontrado nesta empresa.');
  }

  const prazoIndicacao = somarDias(data_notificacao, PRAZO_INDICACAO_DIAS);
  const info = db.prepare(`
    INSERT INTO multas (
      empresa_id, veiculo_id, motorista_id, orgao_autuador, numero_ait, descricao,
      valor_original, data_infracao, data_notificacao, prazo_indicacao, status, condutor_indicado_em, observacoes, criado_por
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.empresaId, veiculo_id, motorista_id || null, orgao_autuador || null, numero_ait || null, descricao,
    valor_original, data_infracao || null, data_notificacao, prazoIndicacao,
    motorista_id ? 'CondutorIndicado' : 'AguardandoIndicacao', motorista_id ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    observacoes || null, req.usuario.id,
  );
  const multa = db.prepare(`${SELECT_LISTA} WHERE m.id = ?`).get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'multas', registroId: multa.id, acao: 'INSERT', depois: multa });
  res.status(201).json(comDiasRestantes(multa));
}));

router.put('/:id', requerAcessoModulo('multas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM multas WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Multa nao encontrada.');

  const campos = ['orgao_autuador', 'numero_ait', 'descricao', 'valor_original', 'data_infracao', 'data_notificacao', 'observacoes'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  if (req.body.data_notificacao !== undefined) {
    sets.push('prazo_indicacao = ?');
    valores.push(somarDias(req.body.data_notificacao, PRAZO_INDICACAO_DIAS));
  }
  sets.push("atualizado_em = datetime('now')");

  db.prepare(`UPDATE multas SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare(`${SELECT_LISTA} WHERE m.id = ?`).get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'multas', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(comDiasRestantes(depois));
}));

router.post('/:id/indicar-condutor', requerAcessoModulo('multas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { motorista_id } = req.body;
  if (!motorista_id) throw new ApiError(400, 'Informe motorista_id.');
  const antes = db.prepare('SELECT * FROM multas WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Multa nao encontrada.');
  const motorista = db.prepare('SELECT id FROM motoristas WHERE id = ? AND empresa_id = ?').get(motorista_id, req.empresaId);
  if (!motorista) throw new ApiError(400, 'Motorista nao encontrado nesta empresa.');

  db.prepare(`
    UPDATE multas SET motorista_id = ?, condutor_indicado_em = datetime('now'), status = 'CondutorIndicado', atualizado_em = datetime('now')
    WHERE id = ?
  `).run(motorista_id, req.params.id);
  const depois = db.prepare(`${SELECT_LISTA} WHERE m.id = ?`).get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'multas', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(comDiasRestantes(depois));
}));

const STATUS_VALIDOS = ['AguardandoIndicacao', 'CondutorIndicado', 'NaoIndicado', 'Paga', 'Recorrida', 'Cancelada'];

router.post('/:id/status', requerAcessoModulo('multas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!STATUS_VALIDOS.includes(status)) throw new ApiError(400, `Status invalido. Use um de: ${STATUS_VALIDOS.join(', ')}`);
  const antes = db.prepare('SELECT * FROM multas WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Multa nao encontrada.');

  // Nao indicar o condutor a tempo dobra o valor da multa (art. 257 par. 8 CTB) -
  // calculado aqui, nao editavel manualmente, pra nao divergir da regra legal.
  const valorNaoIndicacao = status === 'NaoIndicado' ? antes.valor_original * 2 : antes.valor_nao_indicacao;

  db.prepare(`UPDATE multas SET status = ?, valor_nao_indicacao = ?, atualizado_em = datetime('now') WHERE id = ?`)
    .run(status, valorNaoIndicacao, req.params.id);
  const depois = db.prepare(`${SELECT_LISTA} WHERE m.id = ?`).get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'multas', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(comDiasRestantes(depois));
}));

router.delete('/:id', requerAcessoModulo('multas', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM multas WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Multa nao encontrada.');
  if (antes.status !== 'AguardandoIndicacao') throw new ApiError(400, 'So e possivel excluir multas ainda aguardando indicacao do condutor.');
  db.prepare('DELETE FROM multas WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'multas', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// Texto pronto pra repassar ao motorista (impressao/whatsapp), mesmo padrao de /acertos/:id/whatsapp.
router.get('/:id/notificacao-condutor', requerAcessoModulo('multas', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const multa = db.prepare(`${SELECT_LISTA} WHERE m.id = ? AND m.empresa_id = ?`).get(req.params.id, req.empresaId);
  if (!multa) throw new ApiError(404, 'Multa nao encontrada.');
  if (!multa.motorista_nome) throw new ApiError(400, 'Indique o condutor antes de gerar a notificacao.');

  const linhas = [
    `🚨 *Notificação de Multa de Trânsito*`,
    `🚛 Veículo: ${multa.veiculo_placa}`,
    `👤 Condutor indicado: ${multa.motorista_nome}`,
    multa.orgao_autuador ? `🏛️ Órgão autuador: ${multa.orgao_autuador}` : null,
    multa.numero_ait ? `📄 Auto de infração: ${multa.numero_ait}` : null,
    `📋 Infração: ${multa.descricao}`,
    multa.data_infracao ? `📅 Data da infração: ${multa.data_infracao.split('-').reverse().join('/')}` : null,
    `💰 Valor: ${(multa.valor_original / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    '',
    'Você foi identificado como o condutor no momento da infração acima.',
  ].filter((l) => l !== null);

  res.type('text/plain').send(linhas.join('\n'));
}));

module.exports = router;
