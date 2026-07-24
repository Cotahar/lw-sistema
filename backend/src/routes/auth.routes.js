const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { gerarToken, autenticar, calcularPermissoesEfetivas } = require('../middleware/auth');
const { possuiTodasAsEmpresasAtivas } = require('../middleware/empresa');

const router = express.Router();

// Empresas que o usuario pode selecionar no seletor do cabecalho: todas as
// ativas se Admin (acesso implicito, mesma logica de usuario_permissoes),
// senao so as concedidas via usuario_empresas.
function empresasDoUsuario(usuario) {
  if (usuario.perfil === 'Admin') {
    return db.prepare('SELECT id, razao_social, nome_fantasia FROM empresas WHERE ativo = 1 ORDER BY razao_social').all();
  }
  return db.prepare(`
    SELECT e.id, e.razao_social, e.nome_fantasia FROM empresas e
    JOIN usuario_empresas ue ON ue.empresa_id = e.id
    WHERE ue.usuario_id = ? AND e.ativo = 1
    ORDER BY e.razao_social
  `).all(usuario.id);
}

router.post('/login', asyncHandler(async (req, res) => {
  const { username, senha } = req.body;
  if (!username || !senha) throw new ApiError(400, 'Informe usuario e senha.');

  const usuario = db.prepare('SELECT * FROM usuarios WHERE username = ? AND ativo = 1').get(username);
  if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
    throw new ApiError(401, 'Usuario ou senha invalidos.');
  }

  const token = gerarToken(usuario);
  res.json({
    token,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, username: usuario.username, perfil: usuario.perfil, motorista_id: usuario.motorista_id },
    permissoes: calcularPermissoesEfetivas(usuario),
    empresas: empresasDoUsuario(usuario),
    podeTodas: usuario.perfil === 'Admin' || possuiTodasAsEmpresasAtivas(usuario.id),
  });
}));

// Retorna o usuario logado + o mapa de permissoes efetivas por modulo (usado
// pelo frontend para montar o menu e esconder/desabilitar telas). E buscado
// aqui em vez de vir so no login para refletir mudancas de acesso feitas
// pelo Admin durante a sessao (o token so guarda o id, ver gerarToken).
router.get('/me', autenticar, asyncHandler(async (req, res) => {
  const usuario = db.prepare('SELECT id, nome, email, username, perfil, motorista_id, ativo FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!usuario) throw new ApiError(404, 'Usuario nao encontrado.');
  res.json({
    ...usuario,
    permissoes: calcularPermissoesEfetivas(usuario),
    empresas: empresasDoUsuario(usuario),
    podeTodas: usuario.perfil === 'Admin' || possuiTodasAsEmpresasAtivas(usuario.id),
  });
}));

module.exports = router;
