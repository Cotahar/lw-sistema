import { criarPaginaCrud } from '../crudGenerico.js';

export const render = criarPaginaCrud({
  titulo: 'Faixas de Comissao por Media (KM/L)',
  endpoint: '/comissao-faixas',
  tituloItem: 'Faixa',
  somenteAdmin: true,
  campos: [
    { nome: 'km_l_de', label: 'KM/L de', tipo: 'numero', obrigatorio: true },
    { nome: 'km_l_ate', label: 'KM/L ate', tipo: 'numero', obrigatorio: true },
    { nome: 'percentual_comissao', label: 'Comissao (%)', tipo: 'numero', obrigatorio: true },
  ],
  colunas: [
    { chave: 'km_l_de', titulo: 'KM/L de' },
    { chave: 'km_l_ate', titulo: 'KM/L ate' },
    { chave: 'percentual_comissao', titulo: 'Comissao', render: (r) => `${r.percentual_comissao}%` },
    { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativa</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativa</span>') },
  ],
});
