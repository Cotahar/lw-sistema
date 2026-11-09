import { criarPaginaCrud } from '../crudGenerico.js';

export const render = criarPaginaCrud({
  titulo: 'Categorias de Despesa',
  endpoint: '/categorias-despesa',
  tituloItem: 'Categoria',
  somenteAdmin: true,
  campos: [
    { nome: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true },
    { nome: 'conta_como_manutencao', label: 'Conta como manutencao (a despesa da viagem tambem aparece em Manutencao como "Estrada", junto das Ordens de Servico)', tipo: 'checkbox' },
  ],
  colunas: [
    { chave: 'nome', titulo: 'Nome', editavel: true },
    { chave: 'conta_como_manutencao', titulo: 'Conta como manutencao', render: (r) => (r.conta_como_manutencao ? '<span class="badge-critico">Estrada</span>' : '-'), exportar: (r) => (r.conta_como_manutencao ? 'Sim' : '') },
  ],
});
