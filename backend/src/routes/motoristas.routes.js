const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const createCrudRouter = require('../utils/crud');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');

// saldo_conta_corrente fica de fora da whitelist: so pode mudar via o
// razao (motorista_conta_corrente_lancamentos), nunca por PUT direto.
const router = createCrudRouter({
  table: 'motoristas',
  columns: ['nome', 'cpf', 'cnh', 'cnh_validade', 'ativo'],
  required: ['nome', 'cpf', 'cnh', 'cnh_validade'],
  searchFields: ['nome', 'cpf'],
  modulo: 'motoristas',
  empresaScoped: true,
});

router.get('/:id/conta-corrente', requerAcessoModulo('motoristas', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const lancamentos = db
    .prepare('SELECT * FROM motorista_conta_corrente_lancamentos WHERE motorista_id = ? AND empresa_id = ? ORDER BY data DESC, id DESC')
    .all(req.params.id, req.empresaId);
  res.json(lancamentos);
}));

module.exports = router;
