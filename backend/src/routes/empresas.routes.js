const express = require('express');
const createCrudRouter = require('../utils/crud');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerPerfilMinimo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const COLUMNS = [
  'razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual',
  'endereco_logradouro', 'endereco_numero', 'endereco_complemento', 'endereco_bairro', 'endereco_cidade', 'endereco_uf', 'endereco_cep',
  'telefone', 'email', 'onixsat_usuario', 'onixsat_senha', 'ativo',
];

const router = express.Router();

// POST customizado (fora do crud generico): toda empresa nova precisa nascer
// com seu proprio centro de custo "Base/Administrativo" (garantido unico por
// empresa pelo indice parcial em centros_custo), senao ela fica sem lugar
// para lancar despesas fixas/financiamento ate alguem criar isso na mao.
// GET/PUT/DELETE/batch continuam no router generico logo abaixo.
router.post('/', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  if (!req.body.razao_social || !req.body.cnpj) {
    throw new ApiError(400, 'Campos obrigatorios ausentes: razao_social e cnpj.');
  }
  const fields = COLUMNS.filter((c) => req.body[c] !== undefined);
  const empresa = withTransaction(db, () => {
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map((f) => req.body[f]);
    const info = db.prepare(`INSERT INTO empresas (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    const nova = db.prepare('SELECT * FROM empresas WHERE id = ?').get(info.lastInsertRowid);
    db.prepare(`INSERT INTO centros_custo (empresa_id, tipo, veiculo_id, nome) VALUES (?, 'Base', NULL, 'Base/Administrativo')`).run(nova.id);
    return nova;
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: empresa.id, tabela: 'empresas', registroId: empresa.id, acao: 'INSERT', depois: empresa });
  res.status(201).json(empresa);
}));

router.use('/', createCrudRouter({
  table: 'empresas',
  columns: COLUMNS,
  required: ['razao_social', 'cnpj'],
  searchFields: ['razao_social', 'nome_fantasia', 'cnpj'],
  readMinRole: 'Admin',  // a tabela guarda credenciais do Onixsat - nao expor nem para leitura fora do Admin
  writeMinRole: 'Admin', // cadastro da propria empresa - configuracao do sistema
}));

module.exports = router;
