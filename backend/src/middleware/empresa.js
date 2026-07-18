const db = require('../config/db');

// "Quem sou" (auth.js) e "em qual empresa estou atuando" (aqui) sao eixos
// ortogonais de proposito - ver usuario_empresas no schema.sql. A empresa
// ativa vem por header (X-Empresa-Id) em vez de claim no token: o token
// ja e minimalista por design (so {id}, tudo mais e recalculado por
// request), e um header permite inclusive 2 abas trocando de empresa sem
// precisar reemitir token.

function possuiTodasAsEmpresasAtivas(usuarioId) {
  const { total: totalEmpresas } = db.prepare('SELECT COUNT(*) AS total FROM empresas WHERE ativo = 1').get();
  if (totalEmpresas === 0) return false;
  const { total: totalConcedidas } = db.prepare(`
    SELECT COUNT(*) AS total FROM usuario_empresas ue
    JOIN empresas e ON e.id = ue.empresa_id
    WHERE ue.usuario_id = ? AND e.ativo = 1
  `).get(usuarioId);
  return totalConcedidas === totalEmpresas;
}

function resolverEmpresa(req, res, next) {
  const header = req.headers['x-empresa-id'];

  if (header === 'todas') {
    if (req.usuario.perfil !== 'Admin' && !possuiTodasAsEmpresasAtivas(req.usuario.id)) {
      return res.status(403).json({ erro: 'Voce nao tem acesso a todas as empresas.' });
    }
    req.empresaId = null;
    req.empresaTodas = true;
    return next();
  }

  const empresaId = Number(header) || null;
  if (empresaId && req.usuario.perfil !== 'Admin') {
    const grant = db.prepare('SELECT 1 FROM usuario_empresas WHERE usuario_id = ? AND empresa_id = ?').get(req.usuario.id, empresaId);
    if (!grant) return res.status(403).json({ erro: 'Voce nao tem acesso a esta empresa.' });
  }
  req.empresaId = empresaId;
  req.empresaTodas = false;
  next();
}

function exigirEmpresaEspecifica(req, res, next) {
  if (req.empresaId === null) return res.status(400).json({ erro: 'Selecione uma empresa.' });
  next();
}

module.exports = { resolverEmpresa, exigirEmpresaEspecifica, possuiTodasAsEmpresasAtivas };
