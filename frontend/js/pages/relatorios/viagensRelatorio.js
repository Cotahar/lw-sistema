import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const STATUS_LABEL = { EmAndamento: 'Em Andamento', AguardandoAcerto: 'Aguardando Acerto', Finalizada: 'Finalizada' };

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Relatorio de Viagens</h1>
    <p class="mb-4 text-sm text-slate-500">Uma linha por viagem - duracao, km, faturamento, despesas, lucro e media de consumo, pra comparar varias de uma vez.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Motorista</label><div data-filtro-motorista></div></div>
      <div>
        <label class="label">Status</label>
        <select class="input" data-filtro-status>
          <option value="">Todos</option>
          <option value="EmAndamento">Em Andamento</option>
          <option value="AguardandoAcerto">Aguardando Acerto</option>
          <option value="Finalizada">Finalizada</option>
        </select>
      </div>
      <div><label class="label">Inicio de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Inicio ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3" data-resumo></div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  let veiculoId = null;
  let motoristaId = null;
  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: (id) => { veiculoId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);
  const motoristaSelect = criarSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', onChange: (id) => { motoristaId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-motorista]').appendChild(motoristaSelect.el);

  const selectStatus = container.querySelector('[data-filtro-status]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const resumoEl = container.querySelector('[data-resumo]');
  selectStatus.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'viagem_id', titulo: 'Viagem', render: (r) => `<a href="#/viagens/${r.viagem_id}" class="text-gray-900 hover:underline">#${r.viagem_id}</a>`, exportar: (r) => `#${r.viagem_id}` },
      { chave: 'data_inicio', titulo: 'Inicio', render: (r) => formatarDataBr(r.data_inicio) },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa || '-' },
      { chave: 'motorista_nome', titulo: 'Motorista', render: (r) => r.motorista_nome || '-' },
      { chave: 'status', titulo: 'Status', render: (r) => STATUS_LABEL[r.status] || r.status, exportar: (r) => STATUS_LABEL[r.status] || r.status },
      { chave: 'duracao_dias', titulo: 'Duracao', render: (r) => (r.duracao_dias !== null ? `${r.duracao_dias} dia(s)` : '-') },
      { chave: 'km_rodado', titulo: 'KM rodado', render: (r) => (r.km_rodado !== null ? r.km_rodado.toLocaleString('pt-BR') : '-') },
      { chave: 'media_consumo_km_l', titulo: 'Media consumo', render: (r) => (r.media_consumo_km_l !== null ? `${r.media_consumo_km_l.toFixed(2)} km/l` : '-') },
      { chave: 'faturamento', titulo: 'Faturamento', render: (r) => formatarMoeda(r.faturamento), exportar: (r) => r.faturamento / 100 },
      { chave: 'despesas', titulo: 'Despesas', render: (r) => formatarMoeda(r.despesas), exportar: (r) => r.despesas / 100 },
      { chave: 'lucro', titulo: 'Lucro', render: (r) => `<span class="font-semibold ${r.lucro >= 0 ? 'text-emerald-500' : 'text-red-500'}">${formatarMoeda(r.lucro)}</span>`, exportar: (r) => r.lucro / 100 },
    ],
    ordenacaoInicial: { chave: 'data_inicio', direcao: 'desc' },
    exportar: { nomeArquivo: 'relatorio-viagens' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (veiculoId) params.set('veiculo_id', veiculoId);
      if (motoristaId) params.set('motorista_id', motoristaId);
      if (selectStatus.value) params.set('status', selectStatus.value);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/viagens${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.veiculo_placa, r.motorista_nome].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      const faturamentoTotal = dados.reduce((t, r) => t + r.faturamento, 0);
      const lucroTotal = dados.reduce((t, r) => t + r.lucro, 0);
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Viagens</p><p class="mt-1 text-2xl font-bold text-slate-900">${dados.length}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Faturamento total</p><p class="mt-1 text-2xl font-bold text-emerald-500">${formatarMoeda(faturamentoTotal)}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Lucro total</p><p class="mt-1 text-2xl font-bold ${lucroTotal >= 0 ? 'text-emerald-500' : 'text-red-500'}">${formatarMoeda(lucroTotal)}</p></div>
      `;
      return dados;
    },
    vazio: 'Nenhuma viagem encontrada com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/viagens',
    obterFiltros: () => ({
      veiculoId, veiculoLabel: veiculoSelect.getLabel(),
      motoristaId, motoristaLabel: motoristaSelect.getLabel(),
      status: selectStatus.value, dataDe: inputDataDe.value, dataAte: inputDataAte.value,
    }),
    aplicarFiltros: (f) => {
      veiculoId = f.veiculoId || null;
      veiculoSelect.setValue(f.veiculoId || null, f.veiculoLabel || '');
      motoristaId = f.motoristaId || null;
      motoristaSelect.setValue(f.motoristaId || null, f.motoristaLabel || '');
      selectStatus.value = f.status || '';
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const faturamentoTotal = dados.reduce((t, r) => t + r.faturamento, 0);
    const lucroTotal = dados.reduce((t, r) => t + r.lucro, 0);
    const filtros = [];
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    if (motoristaSelect.getValue()) filtros.push(`Motorista: ${motoristaSelect.getLabel()}`);
    if (selectStatus.value) filtros.push(`Status: ${STATUS_LABEL[selectStatus.value] || selectStatus.value}`);
    if (inputDataDe.value) filtros.push(`Inicio de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Inicio ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Relatorio de Viagens',
      filtros,
      resumo: [
        { label: 'Viagens', valor: String(dados.length) },
        { label: 'Faturamento total', valor: formatarMoeda(faturamentoTotal), cor: 'emerald' },
        { label: 'Lucro total', valor: formatarMoeda(lucroTotal), cor: lucroTotal >= 0 ? 'emerald' : 'red' },
      ],
      colunas: [
        'Viagem', 'Inicio', 'Veiculo', 'Motorista', 'Status', 'Duracao', 'KM rodado', 'Media consumo',
        { titulo: 'Faturamento', alinhar: 'right' }, { titulo: 'Despesas', alinhar: 'right' }, { titulo: 'Lucro', alinhar: 'right' },
      ],
      linhas: dados.map((r) => [
        `#${r.viagem_id}`, formatarDataBr(r.data_inicio), r.veiculo_placa || '-', r.motorista_nome || '-', STATUS_LABEL[r.status] || r.status,
        r.duracao_dias !== null ? `${r.duracao_dias} dia(s)` : '-', r.km_rodado !== null ? r.km_rodado.toLocaleString('pt-BR') : '-',
        r.media_consumo_km_l !== null ? `${r.media_consumo_km_l.toFixed(2)} km/l` : '-',
        formatarMoeda(r.faturamento), formatarMoeda(r.despesas), formatarMoeda(r.lucro),
      ]),
      tituloVazio: 'Nenhuma viagem encontrada com estes filtros.',
    });
  });
}
