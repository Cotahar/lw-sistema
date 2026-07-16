const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');
const { verificarAlertasDoVeiculo } = require('../utils/alertaEngine');

const router = express.Router();

router.get('/regras', requerAcessoModulo('alertas', 'Visualizar'), asyncHandler(async (req, res) => {
  const { veiculo_id } = req.query;
  const rows = veiculo_id
    ? db.prepare('SELECT * FROM alertas_regras WHERE veiculo_id = ? ORDER BY id DESC').all(veiculo_id)
    : db.prepare('SELECT * FROM alertas_regras ORDER BY id DESC').all();
  res.json(rows);
}));

router.post('/regras', requerAcessoModulo('alertas', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { veiculo_id, descricao, intervalo_km, km_referencia } = req.body;
  if (!veiculo_id || !descricao || !intervalo_km) throw new ApiError(400, 'Preencha veiculo_id, descricao e intervalo_km.');
  const veiculo = db.prepare('SELECT hodometro_atual FROM veiculos WHERE id = ?').get(veiculo_id);
  if (!veiculo) throw new ApiError(400, 'Veiculo nao encontrado.');

  const info = db.prepare(`
    INSERT INTO alertas_regras (veiculo_id, descricao, intervalo_km, km_referencia)
    VALUES (?, ?, ?, ?)
  `).run(veiculo_id, descricao, intervalo_km, km_referencia ?? veiculo.hodometro_atual);
  const regra = db.prepare('SELECT * FROM alertas_regras WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'alertas_regras', registroId: regra.id, acao: 'INSERT', depois: regra });
  res.status(201).json(regra);
}));

router.put('/regras/:id', requerAcessoModulo('alertas', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM alertas_regras WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Regra de alerta nao encontrada.');
  const campos = ['descricao', 'intervalo_km', 'km_referencia', 'ativo'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE alertas_regras SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM alertas_regras WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'alertas_regras', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/regras/:id', requerAcessoModulo('alertas', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM alertas_regras WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Regra de alerta nao encontrada.');
  db.prepare('DELETE FROM alertas_regras WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'alertas_regras', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

router.get('/ocorrencias', requerAcessoModulo('alertas', 'Visualizar'), asyncHandler(async (req, res) => {
  const { status, veiculo_id } = req.query;
  const condicoes = [];
  const params = [];
  if (status) { condicoes.push('ao.status = ?'); params.push(status); }
  if (veiculo_id) { condicoes.push('ao.veiculo_id = ?'); params.push(veiculo_id); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  res.json(db.prepare(`
    SELECT ao.*, v.placa, ar.descricao AS regra_descricao
    FROM alertas_ocorrencias ao
    JOIN veiculos v ON v.id = ao.veiculo_id
    JOIN alertas_regras ar ON ar.id = ao.regra_id
    ${where}
    ORDER BY ao.data_disparo DESC
  `).all(...params));
}));

router.post('/ocorrencias/:id/resolver', requerAcessoModulo('alertas', 'Gerenciar'), asyncHandler(async (req, res) => {
  const ocorrencia = db.prepare('SELECT * FROM alertas_ocorrencias WHERE id = ?').get(req.params.id);
  if (!ocorrencia) throw new ApiError(404, 'Ocorrencia nao encontrada.');
  if (ocorrencia.status === 'Resolvido') throw new ApiError(400, 'Esta ocorrencia ja esta resolvida.');

  db.prepare("UPDATE alertas_ocorrencias SET status = 'Resolvido', resolvido_em = datetime('now') WHERE id = ?").run(ocorrencia.id);
  // Reinicia a contagem do intervalo a partir do km em que o alerta foi atendido.
  db.prepare('UPDATE alertas_regras SET km_referencia = ? WHERE id = ?').run(ocorrencia.km_atual_no_disparo, ocorrencia.regra_id);

  const depois = db.prepare('SELECT * FROM alertas_ocorrencias WHERE id = ?').get(ocorrencia.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'alertas_ocorrencias', registroId: depois.id, acao: 'UPDATE', antes: ocorrencia, depois });
  res.json(depois);
}));

// Varredura sob demanda (util para o Dashboard, ou se a maquina ficou algum tempo sem uso).
router.post('/verificar', requerAcessoModulo('alertas', 'Gerenciar'), asyncHandler(async (req, res) => {
  const veiculos = db.prepare('SELECT id FROM veiculos WHERE ativo = 1').all();
  const disparadas = veiculos.flatMap((v) => verificarAlertasDoVeiculo(v.id));
  res.json({ novasOcorrencias: disparadas });
}));

module.exports = router;
