const createCrudRouter = require('../utils/crud');

// Cadastro restrito ao Admin, conforme PRD (secao 6): a tabela de comissao por
// media KM/L e configuracao sensivel, nao operacao diaria do perfil Comum.
module.exports = createCrudRouter({
  table: 'comissao_faixas',
  columns: ['km_l_de', 'km_l_ate', 'percentual_comissao', 'ativo'],
  required: ['km_l_de', 'km_l_ate', 'percentual_comissao'],
  orderBy: 'km_l_de',
  writeMinRole: 'Admin',
});
