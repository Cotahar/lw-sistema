const createCrudRouter = require('../utils/crud');

module.exports = createCrudRouter({
  table: 'fornecedores',
  columns: [
    'nome', 'cnpj', 'tipo_id', 'telefone', 'localizacao', 'ativo',
    'favorito', 'posto_assina_nota', 'posto_prazo_dias', 'posto_forma_pagamento',
    'posto_preco_diesel', 'posto_preco_arla',
  ],
  required: ['nome', 'tipo_id'],
  searchFields: ['nome', 'cnpj'],
  modulo: 'fornecedores',
  empresaScoped: true,
  uppercaseFields: ['nome', 'localizacao', 'posto_forma_pagamento'],
});
