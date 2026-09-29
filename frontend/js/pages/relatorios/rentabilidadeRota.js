import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { periodoAnteriorEquivalente, renderComparativoPeriodo } from '../../components/comparativoPeriodo.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

async function buscarTransportadoras(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Rentabilidade por Rota</h1>
    <p class="mb-4 text-sm text-slate-500">Quais trechos (origem &rarr; destino) sao mais frequentes e mais lucrativos. Sem calculo de R$/km (nao ha distancia cadastrada), so frequencia e faturamento.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Transportadora</label><div data-filtro-transportadora></div></div>
      <div><label class="label">Carregamento de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Carregamento ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
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

  let transportadoraId = null;
  const transportadoraSelect = criarSearchableSelect({ buscar: buscarTransportadoras, placeholder: 'Pesquisar transportadora...', onChange: (id) => { transportadoraId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-transportadora]').appendChild(transportadoraSelect.el);

  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const checkComparar = container.querySelector('[data-comparar-periodo]');
  const comparativoEl = container.querySelector('[data-comparativo-periodo]');
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }
  checkComparar.addEventListener('change', () => tabela.recarregar());

  async function atualizarComparativo(dadosAtuais) {
    if (!checkComparar.checked) { comparativoEl.innerHTML = ''; return; }
    const dataDeIso = inputDataDe.value ? parseDataBrParaIso(inputDataDe.value) : null;
    const dataAteIso = inputDataAte.value ? parseDataBrParaIso(inputDataAte.value) : null;
    const anterior = periodoAnteriorEquivalente(dataDeIso, dataAteIso);
    if (!anterior) { comparativoEl.innerHTML = ''; return; }
    const params = new URLSearchParams();
    if (transportadoraId) params.set('transportadora_id', transportadoraId);
    params.set('data_de', anterior.de);
    params.set('data_ate', anterior.ate);
    const dadosAnteriores = await get(`/relatorios/rentabilidade-rota?${params.toString()}`);
    const totalAnt = dadosAnteriores.reduce((t, r) => t + r.total, 0);
    const qtdAnt = dadosAnteriores.reduce((t, r) => t + r.qtd, 0);
    const totalAtual = dadosAtuais.reduce((t, r) => t + r.total, 0);
    const qtdAtual = dadosAtuais.reduce((t, r) => t + r.qtd, 0);
    renderComparativoPeriodo(comparativoEl, {
      periodoAnteriorTexto: `${formatarDataBr(anterior.de)} a ${formatarDataBr(anterior.ate)}`,
      indicadores: [
        { label: 'Faturamento total', atual: totalAtual, anterior: totalAnt, formatador: formatarMoeda },
        { label: 'Qtd de fretes', atual: qtdAtual, anterior: qtdAnt, formatador: (v) => v.toLocaleString('pt-BR') },
      ],
    });
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'rota', titulo: 'Rota', render: (r) => r.rota },
      { chave: 'qtd', titulo: 'Qtd de fretes', render: (r) => String(r.qtd) },
      { chave: 'total', titulo: 'Faturamento total', render: (r) => formatarMoeda(r.total), exportar: (r) => r.total / 100 },
      { chave: 'ticket_medio', titulo: 'Ticket medio', render: (r) => formatarMoeda(r.ticket_medio), exportar: (r) => r.ticket_medio / 100 },
    ],
    ordenacaoInicial: { chave: 'total', direcao: 'desc' },
    exportar: { nomeArquivo: 'rentabilidade-rota' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (transportadoraId) params.set('transportadora_id', transportadoraId);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const todos = await get(`/relatorios/rentabilidade-rota?${params.toString()}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower ? todos.filter((r) => r.rota.toLowerCase().includes(termoLower)) : todos;
      atualizarComparativo(dados);
      return dados;
    },
    vazio: 'Nenhum frete encontrado com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/rentabilidade-rota',
    obterFiltros: () => ({
      transportadoraId, transportadoraLabel: transportadoraSelect.getLabel(),
      dataDe: inputDataDe.value, dataAte: inputDataAte.value,
      comparar: checkComparar.checked,
    }),
    aplicarFiltros: (f) => {
      transportadoraId = f.transportadoraId || null;
      transportadoraSelect.setValue(f.transportadoraId || null, f.transportadoraLabel || '');
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      checkComparar.checked = Boolean(f.comparar);
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const filtros = [];
    if (transportadoraSelect.getValue()) filtros.push(`Transportadora: ${transportadoraSelect.getLabel()}`);
    if (inputDataDe.value) filtros.push(`Carregamento de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Carregamento ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Rentabilidade por Rota',
      filtros,
      colunas: ['Rota', { titulo: 'Qtd de fretes', alinhar: 'right' }, { titulo: 'Faturamento total', alinhar: 'right' }, { titulo: 'Ticket medio', alinhar: 'right' }],
      linhas: [...dados].sort((a, b) => b.total - a.total).map((r) => [r.rota, String(r.qtd), formatarMoeda(r.total), formatarMoeda(r.ticket_medio)]),
      tituloVazio: 'Nenhum frete encontrado com estes filtros.',
    });
  });
}
