import { criarPaginaCrud } from '../crudGenerico.js';

export const render = criarPaginaCrud({
  titulo: 'Tipos de Fornecedor',
  endpoint: '/fornecedor-tipos',
  tituloItem: 'Tipo',
  somenteAdmin: true,
  campos: [{ nome: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true }],
  colunas: [{ chave: 'nome', titulo: 'Nome' }],
});
