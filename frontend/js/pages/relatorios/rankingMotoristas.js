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
    <h1 class="mb-1 text-xl font-bold text-slate-900">Ranking de Motoristas</h1>
    <p class="mb-4 text-sm text-slate-500">Faturamento gerado, comissao, media de consumo e multas - das viagens iniciadas no periodo.</p>
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
    const dadosAnteriores = await get(`/relatorios/ranking-motoristas?${params.toString()}`);
    const faturamentoAnt = dadosAnteriores.reduce((t, r) => t + r.faturamento_gerado, 0);
    const comissaoAnt = dadosAnteriores.reduce((t, r) => t + r.comissao_total, 0);
    const multasAnt = dadosAnteriores.reduce((t, r) => t + r.qtd_multas, 0);
    const faturamentoAtual = dadosAtuais.reduce((t, r) => t + r.faturamento_gerado, 0);
    const comissaoAtual = dadosAtuais.reduce((t, r) => t + r.comissao_total, 0);
    const multasAtual = dadosAtuais.reduce((t, r) => t + r.qtd_multas, 0);
    renderComparativoPeriodo(comparativoEl, {
      periodoAnteriorTexto: `${formatarDataBr(anterior.de)} a ${formatarDataBr(anterior.ate)}`,
      indicadores: [
        { label: 'Faturamento gerado', atual: faturamentoAtual, anterior: faturamentoAnt, formatador: formatarMoeda },
        { label: 'Comissao total', atual: comissaoAtual, anterior: comissaoAnt, formatador: formatarMoeda, inverterCores: true },
        { label: 'Multas', atual: multasAtual, anterior: multasAnt, formatador: (v) => v.toLocaleString('pt-BR'), inverterCores: true },
      ],
    });
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'motorista_nome', titulo: 'Motorista', render: (r) => r.motorista_nome },
      { chave: 'faturamento_gerado', titulo: 'Faturamento gerado', render: (r) => formatarMoeda(r.faturamento_gerado), exportar: (r) => r.faturamento_gerado / 100 },
      { chave: 'comissao_total', titulo: 'Comissao', render: (r) => formatarMoeda(r.comissao_total), exportar: (r) => r.comissao_total / 100 },
      { chave: 'media_consumo_km_l', titulo: 'Media de consumo', render: (r) => (r.media_consumo_km_l !== null ? `${r.media_consumo_km_l.toFixed(2)} km/l` : '-'), exportar: (r) => (r.media_consumo_km_l !== null ? r.media_consumo_km_l.toFixed(2) : '') },
      { chave: 'qtd_multas', titulo: 'Multas', render: (r) => `<span class="${r.qtd_multas > 0 ? 'badge-critico' : 'badge-neutro'}">${r.qtd_multas}</span>`, exportar: (r) => String(r.qtd_multas) },
    ],
    ordenacaoInicial: { chave: 'faturamento_gerado', direcao: 'desc' },
    exportar: { nomeArquivo: 'ranking-motoristas' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const todos = await get(`/relatorios/ranking-motoristas?${params.toString()}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower ? todos.filter((r) => r.motorista_nome.toLowerCase().includes(termoLower)) : todos;
      atualizarComparativo(dados);
      return dados;
    },
    vazio: 'Nenhum motorista encontrado.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/ranking-motoristas',
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
      titulo: 'Ranking de Motoristas',
      filtros: [`Periodo: ${inputDataDe.value || 'inicio'} a ${inputDataAte.value || 'hoje'}`],
      colunas: ['Motorista', { titulo: 'Faturamento gerado', alinhar: 'right' }, { titulo: 'Comissao', alinhar: 'right' }, { titulo: 'Media de consumo', alinhar: 'right' }, { titulo: 'Multas', alinhar: 'right' }],
      linhas: [...dados].sort((a, b) => b.faturamento_gerado - a.faturamento_gerado).map((r) => [
        r.motorista_nome, formatarMoeda(r.faturamento_gerado), formatarMoeda(r.comissao_total),
        r.media_consumo_km_l !== null ? `${r.media_consumo_km_l.toFixed(2)} km/l` : '-', String(r.qtd_multas),
      ]),
      tituloVazio: 'Nenhum motorista encontrado.',
    });
  });
}
