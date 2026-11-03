const db = require('../config/db');
const ApiError = require('./ApiError');

// Categorias "de sistema" achadas pelo NOME (Abastecimento, Arla): o id muda de banco para banco.
// Antes a mesma consulta estava copiada em 6 lugares.
function idDaCategoria(nome) {
  const categoria = db.prepare('SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = ?').get(nome.toLowerCase());
  return categoria ? categoria.id : null;
}

// Mesma busca, para quem vai GRAVAR com a categoria: sem ela no cadastro, recusa com mensagem clara.
function exigirIdDaCategoria(nome) {
  const id = idDaCategoria(nome);
  if (!id) throw new ApiError(400, `Categoria "${nome.charAt(0).toUpperCase()}${nome.slice(1)}" nao encontrada no cadastro.`);
  return id;
}

module.exports = { idDaCategoria, exigirIdDaCategoria };
