import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarMultiSearchableSelect } from '../../components/multiSearchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { periodoAnteriorEquivalente, renderComparativoPeriodo } from '../../components/comparativoPeriodo.js';
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
      <div class="flex items-center gap-2 pt-6">
        <input type="checkbox" id="comparar-periodo" class="h-4 w-4" data-comparar-periodo />
        <label for="comparar-periodo" class="text-sm text-slate-700">Comparar com periodo anterior</label>
      </div>
    </div>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3" data-resumo></div>
    <div data-comparativo-periodo></div>
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
  const checkComparar = container.querySelector('[data-comparar-periodo]');
  const resumoEl = container.querySelector('[data-resumo]');
  const comparativoEl = container.querySelector('[data-comparativo-periodo]');
  selectStatus.addEventListener('change', () => tabela.recarregar());
  checkComparar.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  async function atualizarComparativo(dadosAtuais) {
    if (!checkComparar.checked) { comparativoEl.innerHTML = ''; return; }
    const dataDeIso = inputDataDe.value ? parseDataBrParaIso(inputDataDe.value) : null;
    const dataAteIso = inputDataAte.value ? parseDataBrParaIso(inputDataAte.value) : null;
    const anterior = periodoAnteriorEquivalente(dataDeIso, dataAteIso);
    if (!anterior) { comparativoEl.innerHTML = ''; return; }
    const params = new URLSearchParams();
    for (const id of veiculoSelect.getValues()) params.append('veiculo_id', id);
    for (const id of motoristaSelect.getValues()) params.append('motorista_id', id);
    if (selectStatus.value) params.set('status', selectStatus.value);
    params.set('data_de', anterior.de);
    params.set('data_ate', anterior.ate);
    const dadosAnteriores = await get(`/relatorios/viagens?${params.toString()}`);
    const faturamentoAnt = dadosAnteriores.reduce((t, r) => t + r.faturamento, 0);
    const lucroAnt = dadosAnteriores.reduce((t, r) => t + r.lucro, 0);
    const faturamentoAtual = dadosAtuais.reduce((t, r) => t + r.faturamento, 0);
    const lucroAtual = dadosAtuais.reduce((t, r) => t + r.lucro, 0);
    renderComparativoPeriodo(comparativoEl, {
      periodoAnteriorTexto: `${formatarDataBr(anterior.de)} a ${formatarDataBr(anterior.ate)}`,
      indicadores: [
        { label: 'Viagens', atual: dadosAtuais.length, anterior: dadosAnteriores.length, formatador: (v) => v.toLocaleString('pt-BR') },
        { label: 'Faturamento total', atual: faturamentoAtual, anterior: faturamentoAnt, formatador: formatarMoeda },
        { label: 'Lucro total', atual: lucroAtual, anterior: lucroAnt, formatador: formatarMoeda },
      ],
    });
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
      for (const id of veiculoSelect.getValues()) params.append('veiculo_id', id);
      for (const id of motoristaSelect.getValues()) params.append('motorista_id', id);
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
      atualizarComparativo(dados);
      return dados;
    },
    vazio: 'Nenhuma viagem encontrada com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/viagens',
    obterFiltros: () => ({
      veiculoIds: veiculoSelect.getValues(), veiculoLabels: veiculoSelect.getLabels(),
      motoristaIds: motoristaSelect.getValues(), motoristaLabels: motoristaSelect.getLabels(),
      status: selectStatus.value, dataDe: inputDataDe.value, dataAte: inputDataAte.value,
      comparar: checkComparar.checked,
    }),
    aplicarFiltros: (f) => {
      veiculoSelect.setValues(f.veiculoIds || [], f.veiculoLabels || []);
      motoristaSelect.setValues(f.motoristaIds || [], f.motoristaLabels || []);
      selectStatus.value = f.status || '';
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      checkComparar.checked = Boolean(f.comparar);
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const faturamentoTotal = dados.reduce((t, r) => t + r.faturamento, 0);
    const lucroTotal = dados.reduce((t, r) => t + r.lucro, 0);
    const filtros = [];
    if (veiculoSelect.getValues().length) filtros.push(`Veiculo: ${veiculoSelect.getLabels().join(', ')}`);
    if (motoristaSelect.getValues().length) filtros.push(`Motorista: ${motoristaSelect.getLabels().join(', ')}`);
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
