import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarDataHoraBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Alertas de Manutencao</h1>
    <p class="mb-4 text-sm text-slate-500">Versao exportavel/imprimivel dos alertas por KM (revisao, troca preventiva etc).</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div>
        <label class="label">Status</label>
        <select class="input" data-filtro-status>
          <option value="">Todos</option>
          <option value="Pendente">Pendente</option>
          <option value="Resolvido">Resolvido</option>
        </select>
      </div>
      <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
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
      { chave: 'data_disparo', titulo: 'Disparado em', render: (r) => formatarDataHoraBr(r.data_disparo) },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa },
      { chave: 'regra_descricao', titulo: 'Regra', render: (r) => r.regra_descricao },
      { chave: 'intervalo_km', titulo: 'Intervalo (km)', render: (r) => r.intervalo_km.toLocaleString('pt-BR') },
      { chave: 'km_atual_no_disparo', titulo: 'KM no disparo', render: (r) => r.km_atual_no_disparo.toLocaleString('pt-BR') },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="${r.status === 'Pendente' ? 'badge-atencao' : 'badge-sucesso'}">${r.status}</span>`, exportar: (r) => r.status },
      { chave: 'resolvido_em', titulo: 'Resolvido em', render: (r) => (r.resolvido_em ? formatarDataHoraBr(r.resolvido_em) : '-') },
    ],
    ordenacaoInicial: { chave: 'data_disparo', direcao: 'desc' },
    corLinha: (r) => (r.status === 'Pendente' ? 'bg-amber-950/20' : ''),
    exportar: { nomeArquivo: 'alertas-manutencao' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (veiculoId) params.set('veiculo_id', veiculoId);
      if (selectStatus.value) params.set('status', selectStatus.value);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/alertas${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      return termoLower
        ? todos.filter((r) => [r.veiculo_placa, r.regra_descricao].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
    },
    vazio: 'Nenhum alerta encontrado com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/alertas',
    obterFiltros: () => ({
      veiculoId, veiculoLabel: veiculoSelect.getLabel(),
      status: selectStatus.value, dataDe: inputDataDe.value, dataAte: inputDataAte.value,
    }),
    aplicarFiltros: (f) => {
      veiculoId = f.veiculoId || null;
      veiculoSelect.setValue(f.veiculoId || null, f.veiculoLabel || '');
      selectStatus.value = f.status || '';
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const filtros = [];
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    if (selectStatus.value) filtros.push(`Status: ${selectStatus.value}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Alertas de Manutencao',
      filtros,
      colunas: ['Disparado em', 'Veiculo', 'Regra', 'Intervalo (km)', 'KM no disparo', 'Status', 'Resolvido em'],
      linhas: dados.map((r) => [
        formatarDataHoraBr(r.data_disparo), r.veiculo_placa, r.regra_descricao, r.intervalo_km.toLocaleString('pt-BR'),
        r.km_atual_no_disparo.toLocaleString('pt-BR'), r.status, r.resolvido_em ? formatarDataHoraBr(r.resolvido_em) : '-',
      ]),
      tituloVazio: 'Nenhum alerta encontrado com estes filtros.',
    });
  });
}
