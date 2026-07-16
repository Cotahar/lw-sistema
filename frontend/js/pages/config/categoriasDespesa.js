import { criarPaginaCrud } from '../crudGenerico.js';

export const render = criarPaginaCrud({
  titulo: 'Categorias de Despesa',
  endpoint: '/categorias-despesa',
  tituloItem: 'Categoria',
  somenteAdmin: true,
  campos: [{ nome: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true }],
  colunas: [{ chave: 'nome', titulo: 'Nome' }],
});
