import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { periodoAnteriorEquivalente, renderComparativoPeriodo } from '../../components/comparativoPeriodo.js';
import { formatarMoeda, formatarDataBr, hojeIsoLocal, attachDataMask, parseDataBrParaIso } from '../../masks.js';

function primeiroDiaMesAtualIso() {
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00`);
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Ranking de Conjuntos</h1>
    <p class="mb-4 text-sm text-slate-500">Receita, custo e lucro de cada conjunto (cavalo + carreta) no periodo - mesma conta da DRE, em lista comparavel. O custo mostra quanto e do cavalo e quanto e da carreta.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">De</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
      <div class="flex items-center gap-2 pt-6">
        <input type="checkbox" id="comparar-periodo" class="h-4 w-4" data-comparar-periodo />
        <label for="comparar-periodo" class="text-sm text-slate-700">Comparar com periodo anterior</label>
      </div>
    </div>
    <div data-comparativo-periodo></div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const checkComparar = container.querySelector('[data-comparar-periodo]');
  const comparativoEl = container.querySelector('[data-comparativo-periodo]');
  attachDataMask(inputDataDe, primeiroDiaMesAtualIso());
  attachDataMask(inputDataAte, hojeIsoLocal());
  for (const input of [inputDataDe, inputDataAte]) input.addEventListener('change', () => tabela.recarregar());
  checkComparar.addEventListener('change', () => tabela.recarregar());

  async function atualizarComparativo(dadosAtuais) {
    if (!checkComparar.checked) { comparativoEl.innerHTML = ''; return; }
    const dataDeIso = inputDataDe.value ? parseDataBrParaIso(inputDataDe.value) : null;
    const dataAteIso = inputDataAte.value ? parseDataBrParaIso(inputDataAte.value) : null;
    const anterior = periodoAnteriorEquivalente(dataDeIso, dataAteIso);
    if (!anterior) { comparativoEl.innerHTML = ''; return; }
    const params = new URLSearchParams({ data_de: anterior.de, data_ate: anterior.ate });
    const dadosAnteriores = await get(`/relatorios/ranking-conjuntos?${params.toString()}`);
    const receitaAnt = dadosAnteriores.reduce((t, r) => t + r.receita, 0);
    const custoAnt = dadosAnteriores.reduce((t, r) => t + r.custo, 0);
    const receitaAtual = dadosAtuais.reduce((t, r) => t + r.receita, 0);
    const custoAtual = dadosAtuais.reduce((t, r) => t + r.custo, 0);
    renderComparativoPeriodo(comparativoEl, {
      periodoAnteriorTexto: `${formatarDataBr(anterior.de)} a ${formatarDataBr(anterior.ate)}`,
      indicadores: [
        { label: 'Receita total', atual: receitaAtual, anterior: receitaAnt, formatador: formatarMoeda },
        { label: 'Custo total', atual: custoAtual, anterior: custoAnt, formatador: formatarMoeda, inverterCores: true },
        { label: 'Lucro total', atual: receitaAtual - custoAtual, anterior: receitaAnt - custoAnt, formatador: formatarMoeda },
      ],
    });
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'nome', titulo: 'Conjunto', render: (r) => `<span class="font-medium">${r.nome}</span><br /><span class="text-xs text-slate-500">${r.placas}</span>`, exportar: (r) => r.conjunto },
      { chave: 'receita', titulo: 'Receita', render: (r) => formatarMoeda(r.receita), exportar: (r) => r.receita / 100 },
      { chave: 'custo', titulo: 'Custo', render: (r) => formatarMoeda(r.custo), exportar: (r) => r.custo / 100 },
      { chave: 'custo_tratora', titulo: 'Custo do cavalo', render: (r) => formatarMoeda(r.custo_tratora), exportar: (r) => r.custo_tratora / 100 },
      { chave: 'custo_reboque', titulo: 'Custo da carreta', render: (r) => formatarMoeda(r.custo_reboque), exportar: (r) => r.custo_reboque / 100 },
      { chave: 'lucro', titulo: 'Lucro', render: (r) => `<span class="font-semibold ${r.lucro >= 0 ? 'text-emerald-500' : 'text-red-500'}">${formatarMoeda(r.lucro)}</span>`, exportar: (r) => r.lucro / 100 },
      { chave: 'margem_pct', titulo: 'Margem', render: (r) => (r.margem_pct !== null ? `${r.margem_pct.toFixed(1)}%` : '-'), exportar: (r) => (r.margem_pct !== null ? r.margem_pct.toFixed(1) : '') },
    ],
    ordenacaoInicial: { chave: 'lucro', direcao: 'desc' },
    exportar: { nomeArquivo: 'ranking-conjuntos' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const todos = await get(`/relatorios/ranking-conjuntos?${params.toString()}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower ? todos.filter((r) => r.conjunto.toLowerCase().includes(termoLower)) : todos;
      atualizarComparativo(dados);
      return dados;
    },
    vazio: 'Nenhum conjunto encontrado.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/ranking-veiculos',
    obterFiltros: () => ({ dataDe: inputDataDe.value, dataAte: inputDataAte.value, comparar: checkComparar.checked }),
    aplicarFiltros: (f) => {
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      checkComparar.checked = Boolean(f.comparar);
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    abrirRelatorioImpressao({
      titulo: 'Ranking de Conjuntos',
      filtros: [`Periodo: ${inputDataDe.value || 'inicio'} a ${inputDataAte.value || 'hoje'}`],
      colunas: ['Conjunto', { titulo: 'Receita', alinhar: 'right' }, { titulo: 'Custo', alinhar: 'right' }, { titulo: 'Custo do cavalo', alinhar: 'right' }, { titulo: 'Custo da carreta', alinhar: 'right' }, { titulo: 'Lucro', alinhar: 'right' }, { titulo: 'Margem', alinhar: 'right' }],
      linhas: [...dados].sort((a, b) => b.lucro - a.lucro).map((r) => [
        r.conjunto, formatarMoeda(r.receita), formatarMoeda(r.custo), formatarMoeda(r.custo_tratora), formatarMoeda(r.custo_reboque), formatarMoeda(r.lucro),
        r.margem_pct !== null ? `${r.margem_pct.toFixed(1)}%` : '-',
      ]),
      tituloVazio: 'Nenhum conjunto encontrado.',
    });
  });
}
