import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Comparativo de Consumo</h1>
    <p class="mb-4 text-sm text-slate-500">Media "tanque cheio a tanque cheio" de cada veiculo, considerando todo o historico de abastecimentos - sem filtro de periodo (a media aqui e por janela de KM, nao por data).</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
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

  const tabela = criarDataTable({
    colunas: [
      { chave: 'placa', titulo: 'Veiculo', render: (r) => r.placa },
      { chave: 'motorista_atual', titulo: 'Motorista atual', render: (r) => r.motorista_atual || '-' },
      { chave: 'media_consumo_km_l', titulo: 'Media (janela completa)', render: (r) => (r.media_consumo_km_l !== null ? `${r.media_consumo_km_l.toFixed(2)} km/l` : '-'), exportar: (r) => (r.media_consumo_km_l !== null ? r.media_consumo_km_l.toFixed(2) : '') },
      { chave: 'media_ultima_abastecida_km_l', titulo: 'Media (ultima abastecida)', render: (r) => (r.media_ultima_abastecida_km_l !== null ? `${r.media_ultima_abastecida_km_l.toFixed(2)} km/l` : '-'), exportar: (r) => (r.media_ultima_abastecida_km_l !== null ? r.media_ultima_abastecida_km_l.toFixed(2) : '') },
      { chave: 'litros_no_historico', titulo: 'Litros no historico', render: (r) => `${r.litros_no_historico.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} L` },
    ],
    ordenacaoInicial: { chave: 'media_consumo_km_l', direcao: 'asc' },
    corLinha: (r) => (r.media_consumo_km_l === null ? '' : r.media_consumo_km_l < 2 ? 'bg-red-950/40' : ''),
    exportar: { nomeArquivo: 'comparativo-consumo' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (veiculoId) params.set('veiculo_id', veiculoId);
      const todos = await get(`/relatorios/comparativo-consumo?${params.toString()}`);
      const termoLower = (termo || '').toLowerCase();
      return termoLower
        ? todos.filter((r) => [r.placa, r.motorista_atual].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
    },
    vazio: 'Nenhum veiculo com media calculavel encontrado.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/comparativo-consumo',
    obterFiltros: () => ({ veiculoId, veiculoLabel: veiculoSelect.getLabel() }),
    aplicarFiltros: (f) => {
      veiculoId = f.veiculoId || null;
      veiculoSelect.setValue(f.veiculoId || null, f.veiculoLabel || '');
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const filtros = [];
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    abrirRelatorioImpressao({
      titulo: 'Comparativo de Consumo',
      filtros,
      colunas: ['Veiculo', 'Motorista atual', { titulo: 'Media (janela completa)', alinhar: 'right' }, { titulo: 'Media (ultima abastecida)', alinhar: 'right' }, { titulo: 'Litros no historico', alinhar: 'right' }],
      linhas: dados.map((r) => [
        r.placa, r.motorista_atual || '-',
        r.media_consumo_km_l !== null ? `${r.media_consumo_km_l.toFixed(2)} km/l` : '-',
        r.media_ultima_abastecida_km_l !== null ? `${r.media_ultima_abastecida_km_l.toFixed(2)} km/l` : '-',
        `${r.litros_no_historico.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} L`,
      ]),
      tituloVazio: 'Nenhum veiculo com media calculavel encontrado.',
    });
  });
}
