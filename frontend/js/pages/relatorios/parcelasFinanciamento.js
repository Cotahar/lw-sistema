import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const STATUS_BADGE = { Pendente: 'badge-atencao', Paga: 'badge-sucesso', Atrasada: 'badge-critico' };

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Parcelas de Financiamento</h1>
    <p class="mb-4 text-sm text-slate-500">Quais parcelas estao pagas, a vencer ou atrasadas, por veiculo.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div>
        <label class="label">Status</label>
        <select class="input" data-filtro-status>
          <option value="">Todos</option>
          <option value="Pendente">Pendente</option>
          <option value="Paga">Paga</option>
          <option value="Atrasada">Atrasada</option>
        </select>
      </div>
      <div><label class="label">Vencimento de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Vencimento ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-3 flex justify-end"><button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button></div>
    <div data-tabela></div>
  `;

  let veiculoId = null;
  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: (id) => { veiculoId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);

  const selectStatus = container.querySelector('[data-filtro-status]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  selectStatus.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data_vencimento', titulo: 'Vencimento', render: (r) => formatarDataBr(r.data_vencimento) },
      { chave: 'financiamento_descricao', titulo: 'Financiamento', render: (r) => r.financiamento_descricao },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa || '-' },
      { chave: 'credor_nome', titulo: 'Credor', render: (r) => r.credor_nome || '-' },
      { chave: 'numero_parcela', titulo: 'Parcela', render: (r) => `${r.numero_parcela}` },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="${STATUS_BADGE[r.status] || 'badge-neutro'}">${r.status}</span>`, exportar: (r) => r.status },
      { chave: 'valor_parcela', titulo: 'Valor', render: (r) => formatarMoeda(r.valor_parcela), exportar: (r) => r.valor_parcela / 100 },
    ],
    ordenacaoInicial: { chave: 'data_vencimento', direcao: 'asc' },
    exportar: { nomeArquivo: 'parcelas-financiamento' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (veiculoId) params.set('veiculo_id', veiculoId);
      if (selectStatus.value) params.set('status', selectStatus.value);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/parcelas-financiamento${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      return termoLower
        ? todos.filter((r) => [r.financiamento_descricao, r.veiculo_placa, r.credor_nome].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
    },
    vazio: 'Nenhuma parcela encontrada com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const filtros = [];
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    if (selectStatus.value) filtros.push(`Status: ${selectStatus.value}`);
    if (inputDataDe.value) filtros.push(`Vencimento de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Vencimento ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Parcelas de Financiamento',
      filtros,
      colunas: ['Vencimento', 'Financiamento', 'Veiculo', 'Credor', 'Parcela', 'Status', { titulo: 'Valor', alinhar: 'right' }],
      linhas: dados.map((r) => [
        formatarDataBr(r.data_vencimento), r.financiamento_descricao, r.veiculo_placa || '-', r.credor_nome || '-',
        String(r.numero_parcela), r.status, formatarMoeda(r.valor_parcela),
      ]),
      tituloVazio: 'Nenhuma parcela encontrada com estes filtros.',
    });
  });
}
