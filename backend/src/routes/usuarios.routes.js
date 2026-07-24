const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAdmin, nivelBaseDoPerfil } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const NIVEIS = ['Nenhum', 'Visualizar', 'Gerenciar'];
const PERFIS = ['Admin', 'Comum', 'Visualizacao', 'Motorista'];

const router = express.Router();
// LEFT JOIN so pra exibir o nome do motorista vinculado no formulario de
// edicao (perfil Motorista) - motorista_id continua vindo da propria tabela.
const SELECT_SEGURO = `
  SELECT u.id, u.nome, u.email, u.username, u.perfil, u.motorista_id, u.ativo, u.criado_em, u.atualizado_em, m.nome AS motorista_nome
  FROM usuarios u LEFT JOIN motoristas m ON m.id = u.motorista_id
`;

router.use(requerAdmin); // gestao de usuarios e restrita ao Admin (regra do PRD)

// Garante que o usuario Motorista tenha uma linha em usuario_empresas pra
// empresa do motorista vinculado (resolverEmpresa exige o grant explicito,
// mesma regra que ja vale pros demais perfis) - sem isso, o motorista logaria
// mas nao conseguiria selecionar/usar a propria empresa.
function garantirGrantEmpresaDoMotorista(usuarioId, motoristaId) {
  const motorista = db.prepare('SELECT empresa_id FROM motoristas WHERE id = ?').get(motoristaId);
  if (!motorista) throw new ApiError(400, 'Motorista informado nao encontrado.');
  const jaTem = db.prepare('SELECT 1 FROM usuario_empresas WHERE usuario_id = ? AND empresa_id = ?').get(usuarioId, motorista.empresa_id);
  if (!jaTem) {
    db.prepare('INSERT INTO usuario_empresas (usuario_id, empresa_id) VALUES (?, ?)').run(usuarioId, motorista.empresa_id);
  }
}

router.get('/', asyncHandler(async (req, res) => {
  res.json(db.prepare(`${SELECT_SEGURO} ORDER BY u.nome`).all());
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const usuario = db.prepare(`${SELECT_SEGURO} WHERE u.id = ?`).get(req.params.id);
  if (!usuario) throw new ApiError(404, 'Usuario nao encontrado.');
  res.json(usuario);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nome, email, username, senha, perfil, motorista_id } = req.body;
  if (!nome || !email || !username || !senha || !perfil) throw new ApiError(400, 'Preencha nome, email, usuario, senha e perfil.');
  if (!PERFIS.includes(perfil)) throw new ApiError(400, 'Perfil invalido.');
  if (perfil === 'Motorista' && !motorista_id) throw new ApiError(400, 'Selecione o motorista vinculado a este usuario.');

  const senhaHash = bcrypt.hashSync(senha, 10);
  const usuario = withTransaction(db, () => {
    const info = db
      .prepare('INSERT INTO usuarios (nome, email, username, senha_hash, perfil, motorista_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nome, email, username, senhaHash, perfil, perfil === 'Motorista' ? motorista_id : null);
    if (perfil === 'Motorista') garantirGrantEmpresaDoMotorista(info.lastInsertRowid, motorista_id);
    return db.prepare(`${SELECT_SEGURO} WHERE u.id = ?`).get(info.lastInsertRowid);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'usuarios', registroId: usuario.id, acao: 'INSERT', depois: usuario });
  res.status(201).json(usuario);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const antes = db.prepare(`${SELECT_SEGURO} WHERE u.id = ?`).get(req.params.id);
  if (!antes) throw new ApiError(404, 'Usuario nao encontrado.');

  const { nome, email, username, senha, perfil, motorista_id, ativo } = req.body;
  if (perfil && !PERFIS.includes(perfil)) throw new ApiError(400, 'Perfil invalido.');
  const perfilFinal = perfil !== undefined ? perfil : antes.perfil;
  const motoristaIdFinal = motorista_id !== undefined ? motorista_id : antes.motorista_id;
  if (perfilFinal === 'Motorista' && !motoristaIdFinal) throw new ApiError(400, 'Selecione o motorista vinculado a este usuario.');

  const campos = [];
  const valores = [];
  if (nome !== undefined) { campos.push('nome = ?'); valores.push(nome); }
  if (email !== undefined) { campos.push('email = ?'); valores.push(email); }
  if (username !== undefined) { campos.push('username = ?'); valores.push(username); }
  if (perfil !== undefined) { campos.push('perfil = ?'); valores.push(perfil); }
  if (motorista_id !== undefined) { campos.push('motorista_id = ?'); valores.push(perfilFinal === 'Motorista' ? motorista_id : null); }
  if (ativo !== undefined) { campos.push('ativo = ?'); valores.push(ativo ? 1 : 0); }
  if (senha) { campos.push('senha_hash = ?'); valores.push(bcrypt.hashSync(senha, 10)); }
  if (!campos.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  campos.push("atualizado_em = datetime('now', '-3 hours')");

  const depois = withTransaction(db, () => {
    db.prepare(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
    if (perfilFinal === 'Motorista') garantirGrantEmpresaDoMotorista(Number(req.params.id), motoristaIdFinal);
    return db.prepare(`${SELECT_SEGURO} WHERE u.id = ?`).get(req.params.id);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'usuarios', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const antes = db.prepare(`${SELECT_SEGURO} WHERE u.id = ?`).get(req.params.id);
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

// ---- Concessao de empresas (ver usuario_empresas no schema) ----
// Admin sempre acessa todas as empresas (e o modo "Todas"), sem precisar de
// linha em usuario_empresas - por isso essa tela nem aparece para linhas Admin.
router.get('/:id/empresas', asyncHandler(async (req, res) => {
  const usuario = db.prepare('SELECT id, nome, perfil FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) throw new ApiError(404, 'Usuario nao encontrado.');

  const empresasAtivas = db.prepare('SELECT id, razao_social FROM empresas WHERE ativo = 1 ORDER BY razao_social').all();
  const concedidas = new Set(
    db.prepare('SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ?').all(req.params.id).map((r) => r.empresa_id)
  );

  const empresas = empresasAtivas.map((e) => ({
    id: e.id,
    razao_social: e.razao_social,
    concedida: usuario.perfil === 'Admin' || concedidas.has(e.id),
  }));

  res.json({ usuario, empresas });
}));

// Substitui as concessoes do usuario pela lista informada de empresa_id.
router.put('/:id/empresas', asyncHandler(async (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) throw new ApiError(404, 'Usuario nao encontrado.');
  if (usuario.perfil === 'Admin') throw new ApiError(400, 'Admin sempre tem acesso a todas as empresas; nao ha concessoes para configurar.');

  const { empresaIds } = req.body;
  if (!Array.isArray(empresaIds)) throw new ApiError(400, 'Informe a lista de empresaIds.');

  const empresasValidas = db.prepare('SELECT id FROM empresas WHERE ativo = 1').all().map((e) => e.id);
  for (const id of empresaIds) {
    if (!empresasValidas.includes(id)) throw new ApiError(400, `Empresa ${id} invalida.`);
  }

  db.prepare('DELETE FROM usuario_empresas WHERE usuario_id = ?').run(req.params.id);
  const inserir = db.prepare('INSERT INTO usuario_empresas (usuario_id, empresa_id) VALUES (?, ?)');
  for (const empresaId of empresaIds) {
    inserir.run(req.params.id, empresaId);
  }

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'usuario_empresas', registroId: Number(req.params.id), acao: 'UPDATE', depois: { empresaIds } });

  const atualizado = db.prepare('SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ?').all(req.params.id);
  res.json({ usuarioId: Number(req.params.id), empresas: atualizado.map((r) => r.empresa_id) });
}));

module.exports = router;
