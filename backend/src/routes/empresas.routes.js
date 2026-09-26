const express = require('express');
const createCrudRouter = require('../utils/crud');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerPerfilMinimo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const COLUMNS = [
  'razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual',
  'endereco_logradouro', 'endereco_numero', 'endereco_complemento', 'endereco_bairro', 'endereco_cidade', 'endereco_uf', 'endereco_cep',
  'telefone', 'email', 'onixsat_usuario', 'onixsat_senha', 'onixsat_poll_minutos', 'percentual_desconto_geral', 'ativo',
];
// Texto livre de cadastro (mesmo padrao de attachUppercaseInput no
// frontend) - endereco_cidade ja chega maiusculo do componente de
// autocomplete (cidadeUfSelect.js), mas reforca aqui tambem por seguranca.
const UPPERCASE_FIELDS = ['razao_social', 'nome_fantasia', 'inscricao_estadual', 'endereco_logradouro', 'endereco_complemento', 'endereco_bairro', 'endereco_cidade'];
function valorFinal(campo, valor) {
  return UPPERCASE_FIELDS.includes(campo) && typeof valor === 'string' ? valor.toUpperCase() : valor;
}

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
    const values = fields.map((f) => valorFinal(f, req.body[f]));
    const info = db.prepare(`INSERT INTO empresas (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    const nova = db.prepare('SELECT * FROM empresas WHERE id = ?').get(info.lastInsertRowid);
    db.prepare(`INSERT INTO centros_custo (empresa_id, tipo, veiculo_id, nome) VALUES (?, 'Base', NULL, 'BASE/ADMINISTRATIVO')`).run(nova.id);
    return nova;
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: empresa.id, tabela: 'empresas', registroId: empresa.id, acao: 'INSERT', depois: empresa });
  res.status(201).json(empresa);
}));

// Exposto a qualquer usuario logado (nao so Admin) - so o percentual de
// imposto da empresa ativa, usado pela calculadora de Frete. O resto do
// cadastro (inclusive credenciais Onixsat) continua Admin-only no CRUD
// generico abaixo.
router.get('/ativa/imposto', exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const empresa = db.prepare('SELECT razao_social, percentual_desconto_geral FROM empresas WHERE id = ?').get(req.empresaId);
  if (!empresa) throw new ApiError(404, 'Empresa nao encontrada.');
  res.json(empresa);
}));

router.use('/', createCrudRouter({
  table: 'empresas',
  columns: COLUMNS,
  required: ['razao_social', 'cnpj'],
  searchFields: ['razao_social', 'nome_fantasia', 'cnpj'],
  readMinRole: 'Admin',  // a tabela guarda credenciais do Onixsat - nao expor nem para leitura fora do Admin
  writeMinRole: 'Admin', // cadastro da propria empresa - configuracao do sistema
  uppercaseFields: UPPERCASE_FIELDS,
}));

module.exports = router;
