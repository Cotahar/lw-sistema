import { get } from '../api.js';
import { criarPaginaCrud } from './crudGenerico.js';
import { formatarCpfCnpj } from '../masks.js';

async function camposFormulario() {
  const tipos = await get('/fornecedor-tipos');
  return [
    { nome: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true },
    { nome: 'cnpj', label: 'CPF/CNPJ', tipo: 'cpf_cnpj' },
    { nome: 'tipo_id', label: 'Tipo', tipo: 'select', obrigatorio: true, opcoes: tipos.map((t) => ({ label: t.nome, value: t.id })) },
    { nome: 'telefone', label: 'Telefone', tipo: 'texto' },
  ];
}

export const render = criarPaginaCrud({
  titulo: 'Fornecedores',
  tituloItem: 'Fornecedor',
  endpoint: '/fornecedores',
  modulo: 'fornecedores',
  campos: camposFormulario,
  colunas: [
    { chave: 'nome', titulo: 'Nome' },
    { chave: 'cnpj', titulo: 'CPF/CNPJ', render: (r) => (r.cnpj ? formatarCpfCnpj(r.cnpj) : '-') },
    { chave: 'tipo_nome', titulo: 'Tipo' },
    { chave: 'telefone', titulo: 'Telefone', render: (r) => r.telefone || '-' },
    { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativo</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativo</span>') },
  ],
  transformarListagem: async (linhas) => {
    const tipos = await get('/fornecedor-tipos');
    const porId = Object.fromEntries(tipos.map((t) => [t.id, t.nome]));
    return linhas.map((f) => ({ ...f, tipo_nome: porId[f.tipo_id] || '-' }));
  },
});
