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

// Freio contra tentativa de senha em massa: no maximo LIMITE_FALHAS erros por IP+usuario a cada
// JANELA_MS; acertar a senha zera o contador. Em memoria (um processo so), o que basta aqui.
const LIMITE_FALHAS = 10;
const JANELA_MS = 15 * 60 * 1000;
const falhasLogin = new Map();

function chaveLogin(req, username) {
  return `${req.ip}|${String(username).toLowerCase()}`;
}

function falhasRecentes(chave) {
  const registro = falhasLogin.get(chave);
  if (!registro || Date.now() - registro.inicio > JANELA_MS) return 0;
  return registro.total;
}

function registrarFalha(chave) {
  const registro = falhasLogin.get(chave);
  if (!registro || Date.now() - registro.inicio > JANELA_MS) falhasLogin.set(chave, { inicio: Date.now(), total: 1 });
  else registro.total += 1;
  if (falhasLogin.size > 10000) falhasLogin.clear(); // nunca cresce sem limite
}

// Hash de uma senha qualquer: usuario inexistente tambem paga o custo do bcrypt, senao o tempo de
// resposta denunciaria quais usuarios existem.
const HASH_FICTICIO = bcrypt.hashSync('usuario-inexistente', 10);

router.post('/login', asyncHandler(async (req, res) => {
  const { username, senha } = req.body;
  if (!username || !senha) throw new ApiError(400, 'Informe usuario e senha.');

  const chave = chaveLogin(req, username);
  if (falhasRecentes(chave) >= LIMITE_FALHAS) {
    throw new ApiError(429, 'Muitas tentativas de login erradas. Aguarde 15 minutos e tente de novo.');
  }

  const usuario = db.prepare('SELECT * FROM usuarios WHERE username = ? AND ativo = 1').get(username);
  const senhaConfere = bcrypt.compareSync(String(senha), usuario ? usuario.senha_hash : HASH_FICTICIO);
  if (!usuario || !senhaConfere) {
    registrarFalha(chave);
    throw new ApiError(401, 'Usuario ou senha invalidos.');
  }
  falhasLogin.delete(chave);

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
