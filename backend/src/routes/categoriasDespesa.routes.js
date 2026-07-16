const createCrudRouter = require('../utils/crud');

module.exports = createCrudRouter({
  table: 'categorias_despesa',
  columns: ['nome'],
  required: ['nome'],
  searchFields: ['nome'],
  writeMinRole: 'Admin', // taxonomia/configuracao do sistema
});
