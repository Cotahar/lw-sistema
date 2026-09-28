import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { formatarMoeda, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const CATEGORIAS = ['Peca', 'Acessorio', 'EPI', 'Utensilio'];

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Posicao e Consumo de Estoque</h1>
    <p class="mb-4 text-sm text-slate-500">Quanto esta parado em pecas/itens, e o que entrou/saiu no periodo filtrado.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div>
        <label class="label">Categoria</label>
        <select class="input" data-filtro-categoria>
          <option value="">Todas</option>
          ${CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="flex items-center gap-2 pt-6">
        <input type="checkbox" id="filtro-abaixo-minimo" class="h-4 w-4" data-filtro-abaixo-minimo />
        <label for="filtro-abaixo-minimo" class="text-sm text-slate-700">Somente abaixo do minimo</label>
      </div>
      <div><label class="label">Movimentacao de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Movimentacao ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-resumo></div>
    <div class="mb-3 flex justify-end"><button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button></div>
    <div data-tabela></div>
  `;

  const selectCategoria = container.querySelector('[data-filtro-categoria]');
  const checkAbaixoMinimo = container.querySelector('[data-filtro-abaixo-minimo]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const resumoEl = container.querySelector('[data-resumo]');
  selectCategoria.addEventListener('change', () => tabela.recarregar());
  checkAbaixoMinimo.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'nome', titulo: 'Item', render: (r) => `${r.nome}${r.abaixo_minimo ? ' <span class="badge-critico ml-1">Abaixo do minimo</span>' : ''}`, exportar: (r) => r.nome },
      { chave: 'categoria', titulo: 'Categoria', render: (r) => r.categoria },
      { chave: 'quantidade_atual', titulo: 'Qtd atual', render: (r) => `${r.quantidade_atual} ${r.unidade_medida}` },
      { chave: 'estoque_minimo', titulo: 'Minimo', render: (r) => `${r.estoque_minimo} ${r.unidade_medida}` },
      { chave: 'custo_medio', titulo: 'Custo medio', render: (r) => formatarMoeda(r.custo_medio), exportar: (r) => r.custo_medio / 100 },
      { chave: 'valor_em_estoque', titulo: 'Valor em estoque', render: (r) => `<span class="font-semibold">${formatarMoeda(r.valor_em_estoque)}</span>`, exportar: (r) => r.valor_em_estoque / 100 },
      { chave: 'entrada_periodo', titulo: 'Entrada no periodo', render: (r) => `${r.entrada_periodo} ${r.unidade_medida}` },
      { chave: 'saida_periodo', titulo: 'Saida no periodo', render: (r) => `${r.saida_periodo} ${r.unidade_medida}` },
    ],
    ordenacaoInicial: { chave: 'valor_em_estoque', direcao: 'desc' },
    corLinha: (r) => (r.abaixo_minimo ? 'bg-red-950/40' : ''),
    exportar: { nomeArquivo: 'posicao-estoque' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (selectCategoria.value) params.set('categoria', selectCategoria.value);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/estoque${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      let dados = termoLower ? todos.filter((r) => r.nome.toLowerCase().includes(termoLower)) : todos;
      if (checkAbaixoMinimo.checked) dados = dados.filter((r) => r.abaixo_minimo);
      const totalValor = dados.reduce((t, r) => t + r.valor_em_estoque, 0);
      const qtdAbaixoMinimo = dados.filter((r) => r.abaixo_minimo).length;
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Valor total em estoque</p><p class="mt-1 text-2xl font-bold text-slate-900">${formatarMoeda(totalValor)}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Itens abaixo do minimo</p><p class="mt-1 text-2xl font-bold ${qtdAbaixoMinimo ? 'text-red-600' : 'text-slate-900'}">${qtdAbaixoMinimo}</p></div>
      `;
      return dados;
    },
    vazio: 'Nenhum item de estoque encontrado com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const totalValor = dados.reduce((t, r) => t + r.valor_em_estoque, 0);
    const qtdAbaixoMinimo = dados.filter((r) => r.abaixo_minimo).length;
    const filtros = [];
    if (selectCategoria.value) filtros.push(`Categoria: ${selectCategoria.value}`);
    if (checkAbaixoMinimo.checked) filtros.push('Somente abaixo do minimo');
    if (inputDataDe.value) filtros.push(`Movimentacao de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Movimentacao ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Posicao e Consumo de Estoque',
      filtros,
      resumo: [
        { label: 'Valor total em estoque', valor: formatarMoeda(totalValor) },
        { label: 'Itens abaixo do minimo', valor: String(qtdAbaixoMinimo), cor: qtdAbaixoMinimo ? 'red' : 'zinc' },
      ],
      colunas: ['Item', 'Categoria', 'Qtd atual', 'Minimo', { titulo: 'Custo medio', alinhar: 'right' }, { titulo: 'Valor em estoque', alinhar: 'right' }, 'Entrada periodo', 'Saida periodo'],
      linhas: dados.map((r) => [
        `${r.nome}${r.abaixo_minimo ? ' (abaixo do minimo)' : ''}`, r.categoria, `${r.quantidade_atual} ${r.unidade_medida}`, `${r.estoque_minimo} ${r.unidade_medida}`,
        formatarMoeda(r.custo_medio), formatarMoeda(r.valor_em_estoque), `${r.entrada_periodo} ${r.unidade_medida}`, `${r.saida_periodo} ${r.unidade_medida}`,
      ]),
      tituloVazio: 'Nenhum item de estoque encontrado com estes filtros.',
    });
  });
}
