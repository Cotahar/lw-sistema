import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { formatarMoeda, formatarDataHoraBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const TIPO_LABEL = { DebitoResidual: 'Debito residual', CreditoAbatido: 'Credito abatido', AjusteManual: 'Ajuste manual' };

async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Extrato de Conta Corrente do Motorista</h1>
    <p class="mb-4 text-sm text-slate-500">Evolucao do saldo que cada motorista deve (ou tem a receber) da empresa, lancamento por lancamento.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
      <div><label class="label">Motorista</label><div data-filtro-motorista></div></div>
      <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-3 flex justify-end"><button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button></div>
    <div data-tabela></div>
  `;

  let motoristaId = null;
  const motoristaSelect = criarSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', onChange: (id) => { motoristaId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-motorista]').appendChild(motoristaSelect.el);

  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataHoraBr(r.data) },
      { chave: 'motorista_nome', titulo: 'Motorista', render: (r) => r.motorista_nome },
      { chave: 'tipo', titulo: 'Tipo', render: (r) => TIPO_LABEL[r.tipo] || r.tipo },
      { chave: 'descricao', titulo: 'Descricao', render: (r) => r.descricao || '-', truncar: true },
      { chave: 'saldo_anterior', titulo: 'Saldo antes', render: (r) => formatarMoeda(r.saldo_anterior), exportar: (r) => r.saldo_anterior / 100 },
      { chave: 'saldo_posterior', titulo: 'Saldo depois', render: (r) => `<span class="font-semibold">${formatarMoeda(r.saldo_posterior)}</span>`, exportar: (r) => r.saldo_posterior / 100 },
      { chave: 'valor', titulo: 'Valor do lancamento', render: (r) => formatarMoeda(r.valor), exportar: (r) => r.valor / 100 },
    ],
    ordenacaoInicial: { chave: 'data', direcao: 'desc' },
    exportar: { nomeArquivo: 'extrato-conta-corrente-motorista' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (motoristaId) params.set('motorista_id', motoristaId);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/conta-corrente-motorista${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      return termoLower
        ? todos.filter((r) => [r.motorista_nome, r.descricao].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
    },
    vazio: 'Nenhum lancamento de conta corrente encontrado.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const filtros = [];
    if (motoristaSelect.getValue()) filtros.push(`Motorista: ${motoristaSelect.getLabel()}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Extrato de Conta Corrente do Motorista',
      filtros,
      colunas: ['Data', 'Motorista', 'Tipo', 'Descricao', { titulo: 'Saldo antes', alinhar: 'right' }, { titulo: 'Saldo depois', alinhar: 'right' }, { titulo: 'Valor', alinhar: 'right' }],
      linhas: dados.map((r) => [
        formatarDataHoraBr(r.data), r.motorista_nome, TIPO_LABEL[r.tipo] || r.tipo, r.descricao || '-',
        formatarMoeda(r.saldo_anterior), formatarMoeda(r.saldo_posterior), formatarMoeda(r.valor),
      ]),
      tituloVazio: 'Nenhum lancamento de conta corrente encontrado.',
    });
  });
}
