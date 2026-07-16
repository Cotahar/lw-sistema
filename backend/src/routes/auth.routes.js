const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { gerarToken, autenticar, calcularPermissoesEfetivas } = require('../middleware/auth');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) throw new ApiError(400, 'Informe email e senha.');

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(email);
  if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
    throw new ApiError(401, 'Email ou senha invalidos.');
  }

  const token = gerarToken(usuario);
  res.json({
    token,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
    permissoes: calcularPermissoesEfetivas(usuario),
  });
}));

// Retorna o usuario logado + o mapa de permissoes efetivas por modulo (usado
// pelo frontend para montar o menu e esconder/desabilitar telas). E buscado
// aqui em vez de vir so no login para refletir mudancas de acesso feitas
// pelo Admin durante a sessao (o token so guarda o id, ver gerarToken).
router.get('/me', autenticar, asyncHandler(async (req, res) => {
  const usuario = db.prepare('SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!usuario) throw new ApiError(404, 'Usuario nao encontrado.');
  res.json({ ...usuario, permissoes: calcularPermissoesEfetivas(usuario) });
}));

module.exports = router;
