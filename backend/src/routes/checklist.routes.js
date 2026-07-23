const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerPerfilMinimo, requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { registrarAuditoria } = require('../utils/audit');

const router = express.Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'), 'checklist');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // o frontend ja comprime antes de enviar; isto e so um limite de seguranca
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// ---- Catalogo de itens (Defletores, Geladeira, Radio PX, Rastreador...) ----
// Compartilhado entre empresas de proposito (taxonomia, nao dado operacional).
router.get('/catalogo', requerAcessoModulo('checklist', 'Visualizar'), asyncHandler(async (req, res) => {
  res.json(db.prepare('SELECT * FROM checklist_itens_catalogo ORDER BY nome').all());
}));

router.post('/catalogo', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const { nome } = req.body;
  if (!nome) throw new ApiError(400, 'Informe o nome do item.');
  const info = db.prepare('INSERT INTO checklist_itens_catalogo (nome) VALUES (?)').run(nome);
  const item = db.prepare('SELECT * FROM checklist_itens_catalogo WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'checklist_itens_catalogo', registroId: item.id, acao: 'INSERT', depois: item });
  res.status(201).json(item);
}));

router.put('/catalogo/:id', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM checklist_itens_catalogo WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Item nao encontrado.');
  const { nome, ativo } = req.body;
  const sets = [];
  const valores = [];
  if (nome !== undefined) { sets.push('nome = ?'); valores.push(nome); }
  if (ativo !== undefined) { sets.push('ativo = ?'); valores.push(ativo ? 1 : 0); }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE checklist_itens_catalogo SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM checklist_itens_catalogo WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'checklist_itens_catalogo', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/catalogo/:id', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM checklist_itens_catalogo WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Item nao encontrado.');
  db.prepare('DELETE FROM checklist_itens_catalogo WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'checklist_itens_catalogo', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

function exigirVeiculoDaEmpresa(req) {
  const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.veiculoId, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
}

// ---- Estado do checklist por placa ----
router.get('/veiculo/:veiculoId', requerAcessoModulo('checklist', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  exigirVeiculoDaEmpresa(req);
  const rows = db.prepare(`
    SELECT c.id AS item_id, c.nome, vc.id AS veiculo_checklist_id, vc.presente, vc.observacao, vc.atualizado_em
    FROM checklist_itens_catalogo c
    LEFT JOIN veiculo_checklist vc ON vc.item_id = c.id AND vc.veiculo_id = ?
    WHERE c.ativo = 1
    ORDER BY c.nome
  `).all(req.params.veiculoId);
  res.json(rows);
}));

router.put('/veiculo/:veiculoId/:itemId', requerAcessoModulo('checklist', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  exigirVeiculoDaEmpresa(req);
  const { presente, observacao } = req.body;
  const existente = db.prepare('SELECT * FROM veiculo_checklist WHERE veiculo_id = ? AND item_id = ?').get(req.params.veiculoId, req.params.itemId);

  let depois;
  if (existente) {
    db.prepare("UPDATE veiculo_checklist SET presente = ?, observacao = ?, atualizado_em = datetime('now', '-3 hours') WHERE id = ?")
      .run(presente ? 1 : 0, observacao || null, existente.id);
    depois = db.prepare('SELECT * FROM veiculo_checklist WHERE id = ?').get(existente.id);
  } else {
    const info = db.prepare('INSERT INTO veiculo_checklist (empresa_id, veiculo_id, item_id, presente, observacao) VALUES (?, ?, ?, ?, ?)')
      .run(req.empresaId, req.params.veiculoId, req.params.itemId, presente ? 1 : 0, observacao || null);
    depois = db.prepare('SELECT * FROM veiculo_checklist WHERE id = ?').get(info.lastInsertRowid);
  }

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'veiculo_checklist', registroId: depois.id, acao: existente ? 'UPDATE' : 'INSERT', antes: existente || null, depois });
  res.json(depois);
}));

// ---- Registro fotografico (Recebimento / Entrega) ----
router.get('/veiculo/:veiculoId/fotos', requerAcessoModulo('checklist', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  exigirVeiculoDaEmpresa(req);
  const { momento } = req.query;
  const condicoes = ['veiculo_id = ?'];
  const params = [req.params.veiculoId];
  if (momento) { condicoes.push('momento = ?'); params.push(momento); }
  res.json(db.prepare(`SELECT * FROM veiculo_checklist_fotos WHERE ${condicoes.join(' AND ')} ORDER BY criado_em DESC`).all(...params));
}));

router.post('/veiculo/:veiculoId/fotos', requerAcessoModulo('checklist', 'Gerenciar'), exigirEmpresaEspecifica, upload.single('foto'), asyncHandler(async (req, res) => {
  exigirVeiculoDaEmpresa(req);
  const { momento, item_id } = req.body;
  if (!['Recebimento', 'Entrega'].includes(momento)) throw new ApiError(400, "Informe momento 'Recebimento' ou 'Entrega'.");
  if (!req.file) throw new ApiError(400, 'Envie um arquivo de imagem.');
  const info = db.prepare(`
    INSERT INTO veiculo_checklist_fotos (empresa_id, veiculo_id, item_id, momento, arquivo, criado_por)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.empresaId, req.params.veiculoId, item_id || null, momento, req.file.filename, req.usuario.id);
  const foto = db.prepare('SELECT * FROM veiculo_checklist_fotos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(foto);
}));

router.delete('/fotos/:id', requerAcessoModulo('checklist', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const foto = db.prepare('SELECT * FROM veiculo_checklist_fotos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!foto) throw new ApiError(404, 'Foto nao encontrada.');
  db.prepare('DELETE FROM veiculo_checklist_fotos WHERE id = ?').run(foto.id);
  fs.unlink(path.join(UPLOAD_DIR, foto.arquivo), () => {});
  res.status(204).send();
}));

// ---- Vistorias periodicas do conjunto (a cada ~30 dias) ----
// Cada vistoria e "retrato" do conjunto numa data: os itens sao por veiculo
// (placa), nao por conjunto, pois carretas podem trocar de conjunto - ver
// comentario em schema.sql.
function veiculosDoConjunto(conjuntoId, empresaId) {
  return db.prepare(`
    SELECT v.id, v.placa, v.tipo FROM conjunto_itens ci
    JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.conjunto_id = ? AND v.empresa_id = ?
    ORDER BY ci.ordem
  `).all(conjuntoId, empresaId);
}

router.get('/conjunto/:conjuntoId/vistorias', requerAcessoModulo('checklist', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conjunto = db.prepare('SELECT id FROM conjuntos WHERE id = ? AND empresa_id = ?').get(req.params.conjuntoId, req.empresaId);
  if (!conjunto) throw new ApiError(404, 'Conjunto nao encontrado.');
  const vistorias = db.prepare(`
    SELECT * FROM checklist_vistorias WHERE conjunto_id = ? ORDER BY data_vistoria DESC, id DESC
  `).all(req.params.conjuntoId);
  res.json(vistorias);
}));

router.post('/conjunto/:conjuntoId/vistorias', requerAcessoModulo('checklist', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conjunto = db.prepare('SELECT id FROM conjuntos WHERE id = ? AND empresa_id = ?').get(req.params.conjuntoId, req.empresaId);
  if (!conjunto) throw new ApiError(404, 'Conjunto nao encontrado.');
  const veiculos = veiculosDoConjunto(req.params.conjuntoId, req.empresaId);
  if (!veiculos.length) throw new ApiError(400, 'Este conjunto nao tem veiculos vinculados.');
  const itensCatalogo = db.prepare('SELECT id FROM checklist_itens_catalogo WHERE ativo = 1').all();

  const info = db.prepare(`
    INSERT INTO checklist_vistorias (empresa_id, conjunto_id, data_vistoria, criado_por)
    VALUES (?, ?, COALESCE(?, date('now', '-3 hours')), ?)
  `).run(req.empresaId, req.params.conjuntoId, req.body.data_vistoria || null, req.usuario.id);

  // Cada item comeca com o ultimo valor conhecido (veiculo_checklist), pra o
  // usuario so precisar atualizar o que mudou desde a ultima vistoria.
  for (const veiculo of veiculos) {
    for (const item of itensCatalogo) {
      const ultimo = db.prepare('SELECT presente, observacao FROM veiculo_checklist WHERE veiculo_id = ? AND item_id = ?').get(veiculo.id, item.id);
      db.prepare(`
        INSERT INTO checklist_vistoria_itens (empresa_id, vistoria_id, veiculo_id, item_id, presente, observacao)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.empresaId, info.lastInsertRowid, veiculo.id, item.id, ultimo ? ultimo.presente : 1, ultimo ? ultimo.observacao : null);
    }
  }

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'checklist_vistorias', registroId: info.lastInsertRowid, acao: 'INSERT', depois: { conjunto_id: req.params.conjuntoId } });
  const vistoria = db.prepare('SELECT * FROM checklist_vistorias WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(vistoria);
}));

router.get('/vistorias/:id', requerAcessoModulo('checklist', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const vistoria = db.prepare('SELECT * FROM checklist_vistorias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!vistoria) throw new ApiError(404, 'Vistoria nao encontrada.');

  const itens = db.prepare(`
    SELECT cvi.*, v.placa, v.tipo AS veiculo_tipo, c.nome AS item_nome
    FROM checklist_vistoria_itens cvi
    JOIN veiculos v ON v.id = cvi.veiculo_id
    JOIN checklist_itens_catalogo c ON c.id = cvi.item_id
    WHERE cvi.vistoria_id = ?
    ORDER BY v.tipo DESC, v.placa, c.nome
  `).all(req.params.id);

  // Divergencia: compara o conjunto de placas registradas nesta vistoria com
  // a composicao atual do conjunto (pode ter trocado carreta/cavalo desde entao).
  const placasNaVistoria = [...new Set(itens.map((i) => i.placa))].sort();
  const veiculosAtuais = veiculosDoConjunto(vistoria.conjunto_id, req.empresaId);
  const placasAtuais = veiculosAtuais.map((v) => v.placa).sort();
  const conjuntoDivergente = JSON.stringify(placasNaVistoria) !== JSON.stringify(placasAtuais);

  res.json({ vistoria, itens, conjuntoDivergente, placasNaVistoria, placasAtuais });
}));

router.put('/vistorias/:vistoriaId/veiculo/:veiculoId/item/:itemId', requerAcessoModulo('checklist', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const vistoria = db.prepare('SELECT * FROM checklist_vistorias WHERE id = ? AND empresa_id = ?').get(req.params.vistoriaId, req.empresaId);
  if (!vistoria) throw new ApiError(404, 'Vistoria nao encontrada.');
  const antes = db.prepare('SELECT * FROM checklist_vistoria_itens WHERE vistoria_id = ? AND veiculo_id = ? AND item_id = ?')
    .get(req.params.vistoriaId, req.params.veiculoId, req.params.itemId);
  if (!antes) throw new ApiError(404, 'Item da vistoria nao encontrado.');

  const { presente, observacao } = req.body;
  db.prepare('UPDATE checklist_vistoria_itens SET presente = ?, observacao = ? WHERE id = ?')
    .run(presente ? 1 : 0, observacao || null, antes.id);

  // Mantem veiculo_checklist (ultimo estado conhecido) em sincronia, pra
  // servir de ponto de partida pra proxima vistoria.
  const existente = db.prepare('SELECT id FROM veiculo_checklist WHERE veiculo_id = ? AND item_id = ?').get(req.params.veiculoId, req.params.itemId);
  if (existente) {
    db.prepare("UPDATE veiculo_checklist SET presente = ?, observacao = ?, atualizado_em = datetime('now', '-3 hours') WHERE id = ?")
      .run(presente ? 1 : 0, observacao || null, existente.id);
  } else {
    db.prepare('INSERT INTO veiculo_checklist (empresa_id, veiculo_id, item_id, presente, observacao) VALUES (?, ?, ?, ?, ?)')
      .run(req.empresaId, req.params.veiculoId, req.params.itemId, presente ? 1 : 0, observacao || null);
  }

  const depois = db.prepare('SELECT * FROM checklist_vistoria_itens WHERE id = ?').get(antes.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'checklist_vistoria_itens', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

module.exports = router;
