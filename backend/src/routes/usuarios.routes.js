const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAdmin, nivelBaseDoPerfil } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');

const NIVEIS = ['Nenhum', 'Visualizar', 'Gerenciar'];

const router = express.Router();
const SELECT_SEGURO = 'SELECT id, nome, email, perfil, ativo, criado_em, atualizado_em FROM usuarios';

router.use(requerAdmin); // gestao de usuarios e restrita ao Admin (regra do PRD)

router.get('/', asyncHandler(async (req, res) => {
  res.json(db.prepare(`${SELECT_SEGURO} ORDER BY nome`).all());
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const usuario = db.prepare(`${SELECT_SEGURO} WHERE id = ?`).get(req.params.id);
  if (!usuario) throw new ApiError(404, 'Usuario nao encontrado.');
  res.json(usuario);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nome, email, senha, perfil } = req.body;
  if (!nome || !email || !senha || !perfil) throw new ApiError(400, 'Preencha nome, email, senha e perfil.');
  if (!['Admin', 'Comum', 'Visualizacao'].includes(perfil)) throw new ApiError(400, 'Perfil invalido.');

  const senhaHash = bcrypt.hashSync(senha, 10);
  const info = db
    .prepare('INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?, ?, ?, ?)')
    .run(nome, email, senhaHash, perfil);
  const usuario = db.prepare(`${SELECT_SEGURO} WHERE id = ?`).get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'usuarios', registroId: usuario.id, acao: 'INSERT', depois: usuario });
  res.status(201).json(usuario);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const antes = db.prepare(`${SELECT_SEGURO} WHERE id = ?`).get(req.params.id);
  if (!antes) throw new ApiError(404, 'Usuario nao encontrado.');

  const { nome, email, senha, perfil, ativo } = req.body;
  if (perfil && !['Admin', 'Comum', 'Visualizacao'].includes(perfil)) throw new ApiError(400, 'Perfil invalido.');

  const campos = [];
  const valores = [];
  if (nome !== undefined) { campos.push('nome = ?'); valores.push(nome); }
  if (email !== undefined) { campos.push('email = ?'); valores.push(email); }
  if (perfil !== undefined) { campos.push('perfil = ?'); valores.push(perfil); }
  if (ativo !== undefined) { campos.push('ativo = ?'); valores.push(ativo ? 1 : 0); }
  if (senha) { campos.push('senha_hash = ?'); valores.push(bcrypt.hashSync(senha, 10)); }
  if (!campos.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  campos.push("atualizado_em = datetime('now')");

  db.prepare(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare(`${SELECT_SEGURO} WHERE id = ?`).get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'usuarios', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const antes = db.prepare(`${SELECT_SEGURO} WHERE id = ?`).get(req.params.id);
  if (!antes) throw new ApiError(404, 'Usuario nao encontrado.');
  if (Number(req.params.id) === req.usuario.id) throw new ApiError(400, 'Voce nao pode excluir o proprio usuario.');
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'usuarios', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// ---- Excecoes de permissao por modulo (ver usuario_permissoes no schema) ----
// Devolve TODOS os modulos do sistema, com o nivel efetivo (excecao, se
// houver, senao o padrao do perfil base) e se aquela linha e uma excecao
// explicita ou so o valor herdado - o frontend usa isso pra montar a matriz.
router.get('/:id/permissoes', asyncHandler(async (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) throw new ApiError(404, 'Usuario nao encontrado.');

  const modulos = db.prepare('SELECT chave, nome FROM modulos_sistema ORDER BY ordem').all();
  const excecoes = db.prepare('SELECT modulo, nivel FROM usuario_permissoes WHERE usuario_id = ?').all(req.params.id);
  const excecoesPorModulo = Object.fromEntries(excecoes.map((e) => [e.modulo, e.nivel]));
  const nivelPadrao = nivelBaseDoPerfil(usuario.perfil);

  const permissoes = modulos.map((m) => ({
    modulo: m.chave,
    nome: m.nome,
    nivelPadrao,
    nivel: usuario.perfil === 'Admin' ? 'Gerenciar' : (excecoesPorModulo[m.chave] || nivelPadrao),
    excecao: usuario.perfil !== 'Admin' && m.chave in excecoesPorModulo,
  }));

  res.json({ usuario: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil }, permissoes });
}));

// Substitui as excecoes do usuario pelas informadas. Enviar o mesmo nivel do
// perfil base remove a excecao (volta a herdar), mantendo a tabela enxuta -
// so guarda o que realmente diverge do padrao.
router.put('/:id/permissoes', asyncHandler(async (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) throw new ApiError(404, 'Usuario nao encontrado.');
  if (usuario.perfil === 'Admin') throw new ApiError(400, 'Admin sempre tem acesso total; nao ha excecoes para configurar.');

  const { permissoes } = req.body;
  if (!Array.isArray(permissoes)) throw new ApiError(400, 'Informe a lista de permissoes.');

  const nivelPadrao = nivelBaseDoPerfil(usuario.perfil);
  const upsert = db.prepare(`
    INSERT INTO usuario_permissoes (usuario_id, modulo, nivel) VALUES (?, ?, ?)
    ON CONFLICT (usuario_id, modulo) DO UPDATE SET nivel = excluded.nivel
  `);
  const remover = db.prepare('DELETE FROM usuario_permissoes WHERE usuario_id = ? AND modulo = ?');

  for (const item of permissoes) {
    if (!item.modulo || !NIVEIS.includes(item.nivel)) throw new ApiError(400, 'Cada item precisa de modulo e nivel validos.');
    if (item.nivel === nivelPadrao) {
      remover.run(req.params.id, item.modulo);
    } else {
      upsert.run(req.params.id, item.modulo, item.nivel);
    }
  }

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'usuario_permissoes', registroId: Number(req.params.id), acao: 'UPDATE', depois: { permissoes } });

  const atualizado = db.prepare('SELECT modulo, nivel FROM usuario_permissoes WHERE usuario_id = ?').all(req.params.id);
  res.json({ usuarioId: Number(req.params.id), excecoes: atualizado });
}));

module.exports = router;
