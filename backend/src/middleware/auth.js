const jwt = require('jsonwebtoken');
const db = require('../config/db');

// Motorista fica de fora da escala normal (nao e "menor que Visualizacao",
// e um perfil a parte, restrito ao modulo mobile proprio) - sem esse valor
// explicito, RANK_PERFIL['Motorista'] seria undefined e `undefined < N`
// avalia false em JS, liberando acesso em vez de negar em requerPerfilMinimo.
const RANK_PERFIL = { Motorista: -1, Visualizacao: 0, Comum: 1, Admin: 2 };
const RANK_NIVEL = { Nenhum: 0, Visualizar: 1, Gerenciar: 2 };

function gerarToken(usuario) {
  // O token so guarda o id: perfil/permissoes sao sempre lidos do banco a
  // cada request, para que uma mudanca de acesso feita pelo Admin valha na
  // hora, sem exigir que o usuario afetado faca logout/login de novo.
  return jwt.sign({ id: usuario.id }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

// Nivel que um usuario tem em um modulo por padrao, quando nao ha excecao
// especifica em usuario_permissoes (ver comentario da tabela no schema.sql).
// Motorista cai no fallback 'Nenhum' de proposito: ele nao usa a matriz de
// modulos, so o modulo mobile proprio atras de requerMotorista.
function nivelBaseDoPerfil(perfil) {
  if (perfil === 'Comum') return 'Gerenciar';
  if (perfil === 'Visualizacao') return 'Visualizar';
  return 'Nenhum';
}

function nivelEfetivoNoModulo(usuario, modulo) {
  if (usuario.perfil === 'Admin') return 'Gerenciar';
  const excecao = db.prepare('SELECT nivel FROM usuario_permissoes WHERE usuario_id = ? AND modulo = ?').get(usuario.id, modulo);
  return excecao ? excecao.nivel : nivelBaseDoPerfil(usuario.perfil);
}

// Mapa {modulo: nivel} com o acesso efetivo do usuario em todos os modulos
// cadastrados. Usado por GET /auth/me para o frontend montar o menu.
function calcularPermissoesEfetivas(usuario) {
  const modulos = db.prepare('SELECT chave FROM modulos_sistema ORDER BY ordem').all();
  const mapa = {};
  for (const { chave } of modulos) {
    mapa[chave] = nivelEfetivoNoModulo(usuario, chave);
  }
  return mapa;
}

function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');
  if (!token) {
    return res.status(401).json({ erro: 'Token nao informado.' });
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ erro: 'Token invalido ou expirado.' });
  }
  const usuario = db.prepare('SELECT id, nome, email, username, perfil, motorista_id, ativo FROM usuarios WHERE id = ?').get(payload.id);
  if (!usuario || !usuario.ativo) {
    return res.status(401).json({ erro: 'Usuario nao encontrado ou desativado.' });
  }
  req.usuario = usuario;
  next();
}

// Bloqueia quem tem perfil abaixo do minimo exigido (Visualizacao < Comum < Admin).
// Uso reservado as telas administrativas/config que NAO fazem parte da matriz
// de permissoes por modulo (gestao de usuarios, comissao por faixa, taxonomias).
function requerPerfilMinimo(perfilMinimo) {
  return (req, res, next) => {
    if (!req.usuario || RANK_PERFIL[req.usuario.perfil] < RANK_PERFIL[perfilMinimo]) {
      return res.status(403).json({ erro: 'Voce nao tem permissao para esta acao.' });
    }
    next();
  };
}

function requerAdmin(req, res, next) {
  if (!req.usuario || req.usuario.perfil !== 'Admin') {
    return res.status(403).json({ erro: 'Acao restrita ao perfil Admin.' });
  }
  next();
}

// Modulo mobile do motorista: restrito a usuarios perfil Motorista com um
// motorista_id vinculado (sem isso nao ha como resolver "a viagem dele").
function requerMotorista(req, res, next) {
  if (!req.usuario || req.usuario.perfil !== 'Motorista' || !req.usuario.motorista_id) {
    return res.status(403).json({ erro: 'Acao restrita ao perfil Motorista.' });
  }
  next();
}

// Controle de acesso granular por modulo/tela (ver usuario_permissoes no
// schema). nivelMinimo e 'Visualizar' (leitura) ou 'Gerenciar' (escrita).
function requerAcessoModulo(modulo, nivelMinimo) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ erro: 'Nao autenticado.' });
    const nivel = nivelEfetivoNoModulo(req.usuario, modulo);
    if (RANK_NIVEL[nivel] < RANK_NIVEL[nivelMinimo]) {
      return res.status(403).json({ erro: `Voce nao tem acesso de '${nivelMinimo}' neste modulo.` });
    }
    next();
  };
}

module.exports = {
  gerarToken,
  autenticar,
  requerPerfilMinimo,
  requerAdmin,
  requerMotorista,
  requerAcessoModulo,
  calcularPermissoesEfetivas,
  nivelBaseDoPerfil,
  nivelEfetivoNoModulo,
};
