const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { nivelEfetivoNoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');

const router = express.Router();
router.use(exigirEmpresaEspecifica);

const RANK_NIVEL = { Nenhum: 0, Visualizar: 1, Gerenciar: 2 };

// Frete/DespesaViagem pertencem ao modulo 'viagens' na matriz de permissoes,
// mesmo padrao de ocorrencias.routes.js; OrdemServico ao modulo 'manutencao'.
const MODULO_POR_ENTIDADE = { Frete: 'viagens', DespesaViagem: 'viagens', OrdemServico: 'manutencao' };
const TABELA_POR_ENTIDADE = { Frete: 'fretes', DespesaViagem: 'despesas_viagem', OrdemServico: 'ordens_servico' };
// Limite maximo de anexos por entidade (pedido explicito do usuario pra OS:
// "ate 3 anexos") - checado tambem aqui no servidor (nao so escondendo o
// botao no frontend), senao um upload direto na API furaria o limite.
// Entidades sem entrada aqui continuam sem limite.
const LIMITE_POR_ENTIDADE = { OrdemServico: 3 };

function checarAcesso(req, entidadeTipo, nivelMinimo) {
  const modulo = MODULO_POR_ENTIDADE[entidadeTipo];
  if (!modulo) throw new ApiError(400, `entidade_tipo invalido: ${entidadeTipo}`);
  const nivel = nivelEfetivoNoModulo(req.usuario, modulo);
  if (RANK_NIVEL[nivel] < RANK_NIVEL[nivelMinimo]) {
    throw new ApiError(403, `Voce nao tem acesso de '${nivelMinimo}' neste modulo.`);
  }
}

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'), 'anexos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Aceita imagem (foto de comprovante/nota tirada pelo celular) ou PDF (nota
// fiscal/boleto digitalizado) - os dois formatos que realmente aparecem em
// comprovante de despesa/receita de viagem. Extensao original preservada no
// nome salvo em disco pra abrir/pre-visualizar certo (o navegador decide
// pelo Content-Type do multer/express.static, mas alguns leitores de PDF
// externos ainda olham a extensao).
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).slice(0, 10)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype) || file.mimetype === 'application/pdf'),
});

router.get('/', asyncHandler(async (req, res) => {
  const { entidade_tipo, entidade_id } = req.query;
  if (!entidade_tipo || !entidade_id) throw new ApiError(400, 'Informe entidade_tipo e entidade_id.');
  checarAcesso(req, entidade_tipo, 'Visualizar');
  const anexos = db.prepare(`
    SELECT a.*, u.nome AS criado_por_nome FROM anexos a
    LEFT JOIN usuarios u ON u.id = a.criado_por
    WHERE a.entidade_tipo = ? AND a.entidade_id = ? AND a.empresa_id = ?
    ORDER BY a.criado_em DESC, a.id DESC
  `).all(entidade_tipo, entidade_id, req.empresaId);
  res.json(anexos);
}));

router.post('/', upload.single('arquivo'), asyncHandler(async (req, res) => {
  const { entidade_tipo, entidade_id } = req.body;
  if (!entidade_tipo || !entidade_id) {
    if (req.file) fs.unlink(req.file.path, () => {});
    throw new ApiError(400, 'Informe entidade_tipo e entidade_id.');
  }
  if (!req.file) throw new ApiError(400, 'Envie um arquivo (imagem ou PDF, ate 10MB).');
  try {
    checarAcesso(req, entidade_tipo, 'Gerenciar');
    const tabela = TABELA_POR_ENTIDADE[entidade_tipo];
    const entidade = db.prepare(`SELECT 1 FROM ${tabela} WHERE id = ? AND empresa_id = ?`).get(entidade_id, req.empresaId);
    if (!entidade) throw new ApiError(404, 'Registro referenciado nao encontrado nesta empresa.');

    const limite = LIMITE_POR_ENTIDADE[entidade_tipo];
    if (limite) {
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM anexos WHERE entidade_tipo = ? AND entidade_id = ?').get(entidade_tipo, entidade_id);
      if (total >= limite) throw new ApiError(400, `Limite de ${limite} anexos atingido para este registro.`);
    }

    const info = db.prepare(`
      INSERT INTO anexos (empresa_id, entidade_tipo, entidade_id, nome_arquivo, nome_original, tipo_mime, tamanho_bytes, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.empresaId, entidade_tipo, entidade_id, req.file.filename, req.file.originalname.toUpperCase(), req.file.mimetype, req.file.size, req.usuario.id);
    const anexo = db.prepare(`
      SELECT a.*, u.nome AS criado_por_nome FROM anexos a LEFT JOIN usuarios u ON u.id = a.criado_por WHERE a.id = ?
    `).get(info.lastInsertRowid);
    res.status(201).json(anexo);
  } catch (err) {
    fs.unlink(req.file.path, () => {}); // nao deixa arquivo orfao em disco se a validacao falhar depois do upload
    throw err;
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const anexo = db.prepare('SELECT * FROM anexos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!anexo) throw new ApiError(404, 'Anexo nao encontrado.');
  checarAcesso(req, anexo.entidade_tipo, 'Gerenciar');
  db.prepare('DELETE FROM anexos WHERE id = ?').run(anexo.id);
  fs.unlink(path.join(UPLOAD_DIR, anexo.nome_arquivo), () => {}); // se o arquivo ja nao existir em disco, ignora
  res.status(204).send();
}));

module.exports = router;
