const createCrudRouter = require('../utils/crud');

module.exports = createCrudRouter({
  table: 'fornecedores',
  columns: ['nome', 'cnpj', 'tipo_id', 'telefone', 'ativo'],
  required: ['nome', 'tipo_id'],
  searchFields: ['nome', 'cnpj'],
  modulo: 'fornecedores',
  empresaScoped: true,
});
