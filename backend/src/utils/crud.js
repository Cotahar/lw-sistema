const express = require('express');
const db = require('../config/db');
const asyncHandler = require('./asyncHandler');
const ApiError = require('./ApiError');
const { requerPerfilMinimo, requerAcessoModulo } = require('../middleware/auth');
const { registrarAuditoria } = require('./audit');
const { withTransaction } = require('./transaction');

// Router CRUD generico para cadastros simples (fornecedores, motoristas,
// tipos de dominio etc.). Tabelas com regras de negocio proprias (estoque,
// pneus, viagens...) tem rotas dedicadas em vez de usar isto.
//
// options:
//   table         nome da tabela
//   columns       colunas aceitas em create/update (whitelist)
//   required      colunas obrigatorias em create
//   searchFields  colunas usadas no filtro ?search= (suporta select com busca)
//   orderBy       coluna de ordenacao da listagem (default: primeira de searchFields ou 'id')
//   modulo        quando informado, o acesso usa a matriz de permissoes por
//                 modulo (usuario_permissoes) em vez de readMinRole/writeMinRole.
//                 Use isto para cadastros operacionais (fornecedores, motoristas...).
//   readMinRole   perfil minimo para leitura quando NAO ha modulo (default 'Visualizacao')
//   writeMinRole  perfil minimo para escrita quando NAO ha modulo (default 'Comum').
//                 Use writeMinRole: 'Admin' sem modulo para taxonomias/config
//                 restritas ao Admin (fornecedor_tipos, categorias_despesa...).
function createCrudRouter({
  table,
  columns,
  required = [],
  searchFields = [],
  orderBy,
  modulo,
  readMinRole = 'Visualizacao',
  writeMinRole = 'Comum',
}) {
  const router = express.Router();
  const order = orderBy || searchFields[0] || 'id';
  const podeLer = modulo ? requerAcessoModulo(modulo, 'Visualizar') : requerPerfilMinimo(readMinRole);
  const podeEscrever = modulo ? requerAcessoModulo(modulo, 'Gerenciar') : requerPerfilMinimo(writeMinRole);

  router.get('/', podeLer, asyncHandler(async (req, res) => {
    const { search } = req.query;
    if (search && searchFields.length) {
      const where = searchFields.map((f) => `${f} LIKE ?`).join(' OR ');
      const params = searchFields.map(() => `%${search}%`);
      const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}`).all(...params);
      return res.json(rows);
    }
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
    res.json(rows);
  }));

  router.get('/:id', podeLer, asyncHandler(async (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) throw new ApiError(404, 'Registro nao encontrado.');
    res.json(row);
  }));

  router.post('/', podeEscrever, asyncHandler(async (req, res) => {
    for (const field of required) {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
        throw new ApiError(400, `Campo obrigatorio ausente: ${field}`);
      }
    }
    const fields = columns.filter((c) => req.body[c] !== undefined);
    if (!fields.length) throw new ApiError(400, 'Nenhum campo valido informado.');
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map((f) => req.body[f]);
    const info = db
      .prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`)
      .run(...values);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
    registrarAuditoria({ usuarioId: req.usuario.id, tabela: table, registroId: row.id, acao: 'INSERT', depois: row });
    res.status(201).json(row);
  }));

  router.put('/:id', podeEscrever, asyncHandler(async (req, res) => {
    const antes = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!antes) throw new ApiError(404, 'Registro nao encontrado.');
    const fields = columns.filter((c) => req.body[c] !== undefined);
    if (!fields.length) throw new ApiError(400, 'Nenhum campo valido informado.');
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => req.body[f]);
    db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values, req.params.id);
    const depois = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    registrarAuditoria({ usuarioId: req.usuario.id, tabela: table, registroId: depois.id, acao: 'UPDATE', antes, depois });
    res.json(depois);
  }));

  router.delete('/:id', podeEscrever, asyncHandler(async (req, res) => {
    const antes = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!antes) throw new ApiError(404, 'Registro nao encontrado.');
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    registrarAuditoria({ usuarioId: req.usuario.id, tabela: table, registroId: antes.id, acao: 'DELETE', antes });
    res.status(204).send();
  }));

  router.post('/batch-delete', podeEscrever, asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'Informe a lista de ids a excluir.');
    withTransaction(db, () => {
      for (const id of ids) {
        const antes = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        if (!antes) continue;
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        registrarAuditoria({ usuarioId: req.usuario.id, tabela: table, registroId: id, acao: 'DELETE', antes });
      }
    });
    res.status(204).send();
  }));

  router.patch('/batch', podeEscrever, asyncHandler(async (req, res) => {
    const { ids, changes } = req.body;
    if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'Informe a lista de ids a alterar.');
    const fields = columns.filter((c) => changes && changes[c] !== undefined);
    if (!fields.length) throw new ApiError(400, 'Nenhuma alteracao valida informada.');
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => changes[f]);
    withTransaction(db, () => {
      for (const id of ids) {
        const antes = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        if (!antes) continue;
        db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values, id);
        const depois = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        registrarAuditoria({ usuarioId: req.usuario.id, tabela: table, registroId: id, acao: 'UPDATE', antes, depois });
      }
    });
    res.json({ atualizados: ids.length });
  }));

  return router;
}

module.exports = createCrudRouter;
