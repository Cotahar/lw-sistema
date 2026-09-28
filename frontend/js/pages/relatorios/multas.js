import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarMultiSearchableSelect } from '../../components/multiSearchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const STATUS_OPCOES = ['AguardandoIndicacao', 'CondutorIndicado', 'NaoIndicado', 'Paga', 'Recorrida', 'Cancelada'];
const STATUS_BADGE = {
  AguardandoIndicacao: 'badge-atencao', CondutorIndicado: 'badge-neutro', NaoIndicado: 'badge-critico',
  Paga: 'badge-sucesso', Recorrida: 'badge-neutro', Cancelada: 'badge-neutro',
};

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Multas por Motorista/Veiculo</h1>
    <p class="mb-4 text-sm text-slate-500">Quem esta acumulando multas, e quanto isso custou.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Motorista</label><div data-filtro-motorista></div></div>
      <div>
        <label class="label">Status</label>
        <select class="input" data-filtro-status>
          <option value="">Todos</option>
          ${STATUS_OPCOES.map((s) => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
        <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
      </div>
    </div>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-resumo></div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  const veiculoSelect = criarMultiSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: () => tabela.recarregar() });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);
  const motoristaSelect = criarMultiSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', onChange: () => tabela.recarregar() });
  container.querySelector('[data-filtro-motorista]').appendChild(motoristaSelect.el);

  const selectStatus = container.querySelector('[data-filtro-status]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  selectStatus.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const resumoEl = container.querySelector('[data-resumo]');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data_infracao', titulo: 'Data infracao', render: (r) => (r.data_infracao ? formatarDataBr(r.data_infracao) : '-') },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa },
      { chave: 'motorista_nome', titulo: 'Motorista', render: (r) => r.motorista_nome || '-' },
      { chave: 'descricao', titulo: 'Descricao', render: (r) => r.descricao, truncar: true },
      { chave: 'orgao_autuador', titulo: 'Orgao', render: (r) => r.orgao_autuador || '-' },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="${STATUS_BADGE[r.status] || 'badge-neutro'}">${r.status}</span>`, exportar: (r) => r.status },
      { chave: 'valor_original', titulo: 'Valor', render: (r) => formatarMoeda(r.valor_original), exportar: (r) => r.valor_original / 100 },
    ],
    ordenacaoInicial: { chave: 'data_infracao', direcao: 'desc' },
    exportar: { nomeArquivo: 'multas' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      for (const id of veiculoSelect.getValues()) params.append('veiculo_id', id);
      for (const id of motoristaSelect.getValues()) params.append('motorista_id', id);
      if (selectStatus.value) params.set('status', selectStatus.value);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/multas${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.veiculo_placa, r.motorista_nome, r.descricao, r.orgao_autuador].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      const total = dados.reduce((t, r) => t + r.valor_original, 0);
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Total em multas</p><p class="mt-1 text-2xl font-bold text-red-500">${formatarMoeda(total)}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Quantidade</p><p class="mt-1 text-2xl font-bold text-slate-900">${dados.length}</p></div>
      `;
      return dados;
    },
    vazio: 'Nenhuma multa encontrada com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/multas',
    obterFiltros: () => ({
      veiculoIds: veiculoSelect.getValues(), veiculoLabels: veiculoSelect.getLabels(),
      motoristaIds: motoristaSelect.getValues(), motoristaLabels: motoristaSelect.getLabels(),
      status: selectStatus.value, dataDe: inputDataDe.value, dataAte: inputDataAte.value,
    }),
    aplicarFiltros: (f) => {
      veiculoSelect.setValues(f.veiculoIds || [], f.veiculoLabels || []);
      motoristaSelect.setValues(f.motoristaIds || [], f.motoristaLabels || []);
      selectStatus.value = f.status || '';
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const total = dados.reduce((t, r) => t + r.valor_original, 0);
    const filtros = [];
    if (veiculoSelect.getValues().length) filtros.push(`Veiculo: ${veiculoSelect.getLabels().join(', ')}`);
    if (motoristaSelect.getValues().length) filtros.push(`Motorista: ${motoristaSelect.getLabels().join(', ')}`);
    if (selectStatus.value) filtros.push(`Status: ${selectStatus.value}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Multas por Motorista/Veiculo',
      filtros,
      resumo: [
        { label: 'Total em multas', valor: formatarMoeda(total), cor: 'red' },
        { label: 'Quantidade', valor: String(dados.length) },
      ],
      colunas: ['Data infracao', 'Veiculo', 'Motorista', 'Descricao', 'Orgao', 'Status', { titulo: 'Valor', alinhar: 'right' }],
      linhas: dados.map((r) => [
        r.data_infracao ? formatarDataBr(r.data_infracao) : '-', r.veiculo_placa, r.motorista_nome || '-',
        r.descricao, r.orgao_autuador || '-', r.status, formatarMoeda(r.valor_original),
      ]),
      tituloVazio: 'Nenhuma multa encontrada com estes filtros.',
    });
  });
}
