import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarMultiSearchableSelect } from '../../components/multiSearchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Divergencia de Consumo</h1>
    <p class="mb-4 text-sm text-slate-500">Compara a media de cada viagem com a media historica do veiculo - desvios grandes (principalmente pra baixo) sao o sinal pra investigar possivel desvio de combustivel.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Motorista</label><div data-filtro-motorista></div></div>
      <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
      <div>
        <label class="label">Limite de desvio</label>
        <select class="input" data-filtro-limite>
          <option value="10">10%</option>
          <option value="15" selected>15%</option>
          <option value="25">25%</option>
          <option value="40">40%</option>
        </select>
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

  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const selectLimite = container.querySelector('[data-filtro-limite]');
  const resumoEl = container.querySelector('[data-resumo]');
  selectLimite.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data_inicio', titulo: 'Viagem', render: (r) => `<a href="#/viagens/${r.viagem_id}" class="text-gray-900 hover:underline">#${r.viagem_id} (${formatarDataBr(r.data_inicio)})</a>`, exportar: (r) => `#${r.viagem_id} (${formatarDataBr(r.data_inicio)})` },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa },
      { chave: 'motorista_nome', titulo: 'Motorista', render: (r) => r.motorista_nome || '-' },
      { chave: 'media_viagem_km_l', titulo: 'Media da viagem', render: (r) => `${r.media_viagem_km_l.toFixed(2)} km/l` },
      { chave: 'media_historica_km_l', titulo: 'Media historica', render: (r) => `${r.media_historica_km_l.toFixed(2)} km/l` },
      { chave: 'desvio_pct', titulo: 'Desvio', render: (r) => `<span class="${r.divergente ? 'badge-critico' : 'badge-neutro'}">${r.desvio_pct > 0 ? '+' : ''}${r.desvio_pct.toFixed(1)}%</span>`, exportar: (r) => `${r.desvio_pct.toFixed(1)}%` },
    ],
    ordenacaoInicial: { chave: 'desvio_pct', direcao: 'asc' },
    corLinha: (r) => (r.divergente ? 'bg-red-950/40' : ''),
    exportar: { nomeArquivo: 'divergencia-consumo' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      for (const id of veiculoSelect.getValues()) params.append('veiculo_id', id);
      for (const id of motoristaSelect.getValues()) params.append('motorista_id', id);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      params.set('limite', selectLimite.value);
      const todos = await get(`/relatorios/divergencia-consumo?${params.toString()}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.veiculo_placa, r.motorista_nome].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      const qtdDivergentes = dados.filter((r) => r.divergente).length;
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Viagens analisadas</p><p class="mt-1 text-2xl font-bold text-slate-900">${dados.length}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Divergentes (acima do limite)</p><p class="mt-1 text-2xl font-bold ${qtdDivergentes ? 'text-red-600' : 'text-slate-900'}">${qtdDivergentes}</p></div>
      `;
      return dados;
    },
    vazio: 'Nenhuma viagem com media calculavel encontrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/divergencia-consumo',
    obterFiltros: () => ({
      veiculoIds: veiculoSelect.getValues(), veiculoLabels: veiculoSelect.getLabels(),
      motoristaIds: motoristaSelect.getValues(), motoristaLabels: motoristaSelect.getLabels(),
      dataDe: inputDataDe.value, dataAte: inputDataAte.value, limite: selectLimite.value,
    }),
    aplicarFiltros: (f) => {
      veiculoSelect.setValues(f.veiculoIds || [], f.veiculoLabels || []);
      motoristaSelect.setValues(f.motoristaIds || [], f.motoristaLabels || []);
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      selectLimite.value = f.limite || '15';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const qtdDivergentes = dados.filter((r) => r.divergente).length;
    const filtros = [];
    if (veiculoSelect.getValues().length) filtros.push(`Veiculo: ${veiculoSelect.getLabels().join(', ')}`);
    if (motoristaSelect.getValues().length) filtros.push(`Motorista: ${motoristaSelect.getLabels().join(', ')}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    filtros.push(`Limite de desvio: ${selectLimite.value}%`);
    abrirRelatorioImpressao({
      titulo: 'Divergencia de Consumo',
      filtros,
      resumo: [
        { label: 'Viagens analisadas', valor: String(dados.length) },
        { label: 'Divergentes', valor: String(qtdDivergentes), cor: qtdDivergentes ? 'red' : 'zinc' },
      ],
      colunas: ['Viagem', 'Veiculo', 'Motorista', { titulo: 'Media da viagem', alinhar: 'right' }, { titulo: 'Media historica', alinhar: 'right' }, { titulo: 'Desvio', alinhar: 'right' }],
      linhas: dados.map((r) => [
        `#${r.viagem_id} (${formatarDataBr(r.data_inicio)})`, r.veiculo_placa, r.motorista_nome || '-',
        `${r.media_viagem_km_l.toFixed(2)} km/l`, `${r.media_historica_km_l.toFixed(2)} km/l`,
        `${r.desvio_pct > 0 ? '+' : ''}${r.desvio_pct.toFixed(1)}%${r.divergente ? ' (divergente)' : ''}`,
      ]),
      tituloVazio: 'Nenhuma viagem com media calculavel encontrada.',
    });
  });
}
