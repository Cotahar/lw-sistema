const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerPerfilMinimo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');

const router = express.Router();

// Cadastro restrito ao Admin, conforme PRD (secao 6): a tabela de comissao por
// media KM/L (agora tambem por marca do veiculo) e configuracao sensivel,
// nao operacao diaria do perfil Comum. Rotas proprias (nao o CRUD generico)
// porque precisamos validar sobreposicao de faixas dentro da mesma marca -
// o CRUD generico nao tem esse tipo de validacao customizada.

// Duas faixas da MESMA marca (ou ambas sem marca = fallback generico) nao
// podem cobrir o mesmo trecho de km/l - senao a busca em acertos.routes.js
// (que pega a primeira que bate, ordenada por km_l_de) ficaria ambigua.
function validarSobreposicao({ marca, km_l_de, km_l_ate, ignorarId }) {
  if (km_l_de >= km_l_ate) throw new ApiError(400, '"KM/L de" precisa ser menor que "KM/L ate".');
  const conflitantes = db.prepare(`
    SELECT id FROM comissao_faixas
    WHERE ativo = 1 AND marca IS ? AND km_l_de <= ? AND km_l_ate >= ? AND id != ?
  `).all(marca || null, km_l_ate, km_l_de, ignorarId || 0);
  if (conflitantes.length) {
    throw new ApiError(400, `Esta faixa sobrepoe outra ja cadastrada para ${marca ? `a marca ${marca}` : 'qualquer marca'} (id ${conflitantes[0].id}).`);
  }
}

router.get('/', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const faixas = db.prepare('SELECT * FROM comissao_faixas ORDER BY (marca IS NULL), marca, km_l_de').all();
  res.json(faixas);
}));

router.post('/', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const { marca, km_l_de, km_l_ate, percentual_comissao, ativo } = req.body;
  if (km_l_de === undefined || km_l_ate === undefined || percentual_comissao === undefined) {
    throw new ApiError(400, 'Preencha km_l_de, km_l_ate e percentual_comissao.');
  }
  validarSobreposicao({ marca, km_l_de, km_l_ate });
  const info = db.prepare(`
    INSERT INTO comissao_faixas (marca, km_l_de, km_l_ate, percentual_comissao, ativo)
    VALUES (?, ?, ?, ?, ?)
  `).run(marca || null, km_l_de, km_l_ate, percentual_comissao, ativo === undefined ? 1 : (ativo ? 1 : 0));
  const nova = db.prepare('SELECT * FROM comissao_faixas WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'comissao_faixas', registroId: nova.id, acao: 'INSERT', depois: nova });
  res.status(201).json(nova);
}));

router.put('/:id', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM comissao_faixas WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Faixa nao encontrada.');
  const marca = req.body.marca !== undefined ? req.body.marca : antes.marca;
  const km_l_de = req.body.km_l_de !== undefined ? req.body.km_l_de : antes.km_l_de;
  const km_l_ate = req.body.km_l_ate !== undefined ? req.body.km_l_ate : antes.km_l_ate;
  const percentual_comissao = req.body.percentual_comissao !== undefined ? req.body.percentual_comissao : antes.percentual_comissao;
  const ativo = req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : antes.ativo;
  if (ativo) validarSobreposicao({ marca, km_l_de, km_l_ate, ignorarId: antes.id });
  db.prepare(`
    UPDATE comissao_faixas SET marca = ?, km_l_de = ?, km_l_ate = ?, percentual_comissao = ?, ativo = ? WHERE id = ?
  `).run(marca || null, km_l_de, km_l_ate, percentual_comissao, ativo, req.params.id);
  const depois = db.prepare('SELECT * FROM comissao_faixas WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'comissao_faixas', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM comissao_faixas WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Faixa nao encontrada.');
  db.prepare('DELETE FROM comissao_faixas WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'comissao_faixas', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
