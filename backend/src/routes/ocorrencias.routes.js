const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { nivelEfetivoNoModulo } = require('../middleware/auth');

const router = express.Router();

const RANK_NIVEL = { Nenhum: 0, Visualizar: 1, Gerenciar: 2 };

// Nao existe uma permissao propria para ocorrencias: cada entidade_tipo
// pertence a um modulo ja existente na matriz de permissoes, e o acesso a
// ocorrencia segue o mesmo nivel que o usuario ja tem naquele modulo.
const MODULO_POR_ENTIDADE = {
  Viagem: 'viagens',
  Frete: 'viagens',
  DespesaViagem: 'viagens',
  ContaPagar: 'contas_pagar',
  ContaReceber: 'contas_receber',
  AcertoViagem: 'acertos',
};

function checarAcesso(req, entidadeTipo, nivelMinimo) {
  const modulo = MODULO_POR_ENTIDADE[entidadeTipo];
  if (!modulo) throw new ApiError(400, `entidade_tipo invalido: ${entidadeTipo}`);
  const nivel = nivelEfetivoNoModulo(req.usuario, modulo);
  if (RANK_NIVEL[nivel] < RANK_NIVEL[nivelMinimo]) {
    throw new ApiError(403, `Voce nao tem acesso de '${nivelMinimo}' neste modulo.`);
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const { entidade_tipo, entidade_id } = req.query;
  if (!entidade_tipo || !entidade_id) throw new ApiError(400, 'Informe entidade_tipo e entidade_id.');
  checarAcesso(req, entidade_tipo, 'Visualizar');
  const ocorrencias = db.prepare(`
    SELECT o.*, u.nome AS criado_por_nome FROM ocorrencias o
    LEFT JOIN usuarios u ON u.id = o.criado_por
    WHERE o.entidade_tipo = ? AND o.entidade_id = ?
    ORDER BY o.criado_em DESC, o.id DESC
  `).all(entidade_tipo, entidade_id);
  res.json(ocorrencias);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { entidade_tipo, entidade_id, texto } = req.body;
  if (!entidade_tipo || !entidade_id || !texto) throw new ApiError(400, 'Informe entidade_tipo, entidade_id e texto.');
  checarAcesso(req, entidade_tipo, 'Gerenciar');
  const info = db.prepare(`
    INSERT INTO ocorrencias (entidade_tipo, entidade_id, texto, criado_por) VALUES (?, ?, ?, ?)
  `).run(entidade_tipo, entidade_id, texto, req.usuario.id);
  const ocorrencia = db.prepare(`
    SELECT o.*, u.nome AS criado_por_nome FROM ocorrencias o LEFT JOIN usuarios u ON u.id = o.criado_por WHERE o.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(ocorrencia);
}));

module.exports = router;
