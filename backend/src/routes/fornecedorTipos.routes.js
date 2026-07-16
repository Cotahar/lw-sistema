const createCrudRouter = require('../utils/crud');

module.exports = createCrudRouter({
  table: 'fornecedor_tipos',
  columns: ['nome'],
  required: ['nome'],
  searchFields: ['nome'],
  writeMinRole: 'Admin', // taxonomia/configuracao do sistema
});
