import { get } from '../api.js';
import { criarPaginaCrud } from './crudGenerico.js';
import { formatarCpfCnpj } from '../masks.js';
import { comCopiar } from '../components/copiar.js';

async function camposFormulario() {
  const tipos = await get('/fornecedor-tipos');
  return [
    { nome: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true },
    { nome: 'cnpj', label: 'CPF/CNPJ', tipo: 'cpf_cnpj' },
    {
      nome: 'tipo_id', label: 'Tipo', tipo: 'select', obrigatorio: true, opcoes: tipos.map((t) => ({ label: t.nome, value: t.id })),
      avisoSemOpcoes: { mensagem: 'Nenhum tipo de fornecedor cadastrado ainda.', rota: '/config/fornecedor-tipos' },
    },
    { nome: 'telefone', label: 'Telefone', tipo: 'texto' },
    { nome: 'localizacao', label: 'Localizacao', tipo: 'texto' },
    { nome: 'favorito', label: 'Favorito (posto) - aparece no app do motorista', tipo: 'checkbox' },
    { nome: 'posto_assina_nota', label: 'Posto assina nota (fatura, nao paga na hora)', tipo: 'checkbox' },
    { nome: 'posto_prazo_dias', label: 'Prazo p/ vencimento em dias (quando assina nota)', tipo: 'numero' },
    { nome: 'posto_forma_pagamento', label: 'Forma de pagamento acertada (ex.: Pix, Dinheiro)', tipo: 'texto' },
    { nome: 'posto_preco_diesel', label: 'Preco acertado - Diesel (R$/L)', tipo: 'moeda' },
    { nome: 'posto_preco_arla', label: 'Preco acertado - Arla (R$/L)', tipo: 'moeda' },
  ];
}

export const render = criarPaginaCrud({
  titulo: 'Fornecedores',
  tituloItem: 'Fornecedor',
  endpoint: '/fornecedores',
  modulo: 'fornecedores',
  campos: camposFormulario,
  colunas: [
    { chave: 'favorito', titulo: '', render: (r) => (r.favorito ? '<span title="Favorito" class="text-amber-500">★</span>' : '') },
    { chave: 'nome', titulo: 'Nome' },
    { chave: 'cnpj', titulo: 'CPF/CNPJ', render: (r) => (r.cnpj ? comCopiar(formatarCpfCnpj(r.cnpj)) : '-') },
    { chave: 'tipo_nome', titulo: 'Tipo' },
    { chave: 'telefone', titulo: 'Telefone', render: (r) => r.telefone || '-' },
    { chave: 'localizacao', titulo: 'Localizacao', render: (r) => r.localizacao || '-' },
    { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge-sucesso">Ativo</span>' : '<span class="badge-neutro">Inativo</span>') },
  ],
  transformarListagem: async (linhas) => {
    const tipos = await get('/fornecedor-tipos');
    const porId = Object.fromEntries(tipos.map((t) => [t.id, t.nome]));
    return linhas.map((f) => ({ ...f, tipo_nome: porId[f.tipo_id] || '-' }));
  },
});
