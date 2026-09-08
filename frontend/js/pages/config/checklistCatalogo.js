import { criarPaginaCrud } from '../crudGenerico.js';

export const render = criarPaginaCrud({
  titulo: 'Catalogo de Checklist de Bordo',
  endpoint: '/checklist/catalogo',
  tituloItem: 'Item',
  somenteAdmin: true,
  campos: [{ nome: 'nome', label: 'Nome do item', tipo: 'texto', obrigatorio: true }],
  colunas: [
    { chave: 'nome', titulo: 'Nome', editavel: true },
    { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge-sucesso">Ativo</span>' : '<span class="badge-neutro">Inativo</span>') },
  ],
});
