import { criarPaginaCrud } from '../crudGenerico.js';

export const render = criarPaginaCrud({
  titulo: 'Catalogo de Checklist de Bordo',
  endpoint: '/checklist/catalogo',
  tituloItem: 'Item',
  somenteAdmin: true,
  campos: [{ nome: 'nome', label: 'Nome do item', tipo: 'texto', obrigatorio: true }],
  colunas: [
    { chave: 'nome', titulo: 'Nome' },
    { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativo</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativo</span>') },
  ],
});
