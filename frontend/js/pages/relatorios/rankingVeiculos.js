import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarMoeda, formatarDataBr, hojeIsoLocal, attachDataMask, parseDataBrParaIso } from '../../masks.js';

function primeiroDiaMesAtualIso() {
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00`);
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Ranking de Veiculos</h1>
    <p class="mb-4 text-sm text-slate-500">Receita, custo e lucro de cada veiculo no periodo - mesma conta da DRE, em lista comparavel.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">De</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  attachDataMask(inputDataDe, primeiroDiaMesAtualIso());
  attachDataMask(inputDataAte, hojeIsoLocal());
  for (const input of [inputDataDe, inputDataAte]) input.addEventListener('change', () => tabela.recarregar());

  const tabela = criarDataTable({
    colunas: [
      { chave: 'placa', titulo: 'Placa', render: (r) => r.placa },
      { chave: 'tipo', titulo: 'Tipo', render: (r) => r.tipo },
      { chave: 'receita', titulo: 'Receita', render: (r) => formatarMoeda(r.receita), exportar: (r) => r.receita / 100 },
      { chave: 'custo', titulo: 'Custo', render: (r) => formatarMoeda(r.custo), exportar: (r) => r.custo / 100 },
      { chave: 'lucro', titulo: 'Lucro', render: (r) => `<span class="font-semibold ${r.lucro >= 0 ? 'text-emerald-500' : 'text-red-500'}">${formatarMoeda(r.lucro)}</span>`, exportar: (r) => r.lucro / 100 },
      { chave: 'margem_pct', titulo: 'Margem', render: (r) => (r.margem_pct !== null ? `${r.margem_pct.toFixed(1)}%` : '-'), exportar: (r) => (r.margem_pct !== null ? r.margem_pct.toFixed(1) : '') },
    ],
    ordenacaoInicial: { chave: 'lucro', direcao: 'desc' },
    exportar: { nomeArquivo: 'ranking-veiculos' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const todos = await get(`/relatorios/ranking-veiculos?${params.toString()}`);
      const termoLower = (termo || '').toLowerCase();
      return termoLower ? todos.filter((r) => r.placa.toLowerCase().includes(termoLower)) : todos;
    },
    vazio: 'Nenhum veiculo encontrado.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/ranking-veiculos',
    obterFiltros: () => ({ dataDe: inputDataDe.value, dataAte: inputDataAte.value }),
    aplicarFiltros: (f) => {
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    abrirRelatorioImpressao({
      titulo: 'Ranking de Veiculos',
      filtros: [`Periodo: ${inputDataDe.value || 'inicio'} a ${inputDataAte.value || 'hoje'}`],
      colunas: ['Placa', 'Tipo', { titulo: 'Receita', alinhar: 'right' }, { titulo: 'Custo', alinhar: 'right' }, { titulo: 'Lucro', alinhar: 'right' }, { titulo: 'Margem', alinhar: 'right' }],
      linhas: [...dados].sort((a, b) => b.lucro - a.lucro).map((r) => [
        r.placa, r.tipo, formatarMoeda(r.receita), formatarMoeda(r.custo), formatarMoeda(r.lucro),
        r.margem_pct !== null ? `${r.margem_pct.toFixed(1)}%` : '-',
      ]),
      tituloVazio: 'Nenhum veiculo encontrado.',
    });
  });
}
