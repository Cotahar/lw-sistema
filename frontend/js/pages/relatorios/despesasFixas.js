import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const CATALOGO_COLUNAS = [
  { chave: 'data', titulo: 'Data', padrao: true, render: (r) => formatarDataBr(r.data) },
  { chave: 'categoria_nome', titulo: 'Categoria', padrao: true, render: (r) => r.categoria_nome || '-' },
  { chave: 'veiculo_placa', titulo: 'Veiculo/Centro de custo', padrao: true, render: (r) => r.veiculo_placa || '-' },
  { chave: 'descricao', titulo: 'Descricao', padrao: true, render: (r) => r.descricao || '-', truncar: true },
  { chave: 'recorrente', titulo: 'Recorrente', padrao: false, render: (r) => (r.recorrente ? 'Sim' : 'Nao') },
  { chave: 'qtd_parcelas', titulo: 'Parcelas', padrao: false, render: (r) => (r.qtd_parcelas ? `${r.qtd_parcelas}x` : '-') },
];
const COLUNA_VALOR = { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor), exportar: (r) => r.valor / 100 };

const OPCOES_AGRUPAR = [
  { value: '', label: 'Nenhum' },
  { value: 'categoria_nome', label: 'Categoria' },
  { value: 'veiculo_placa', label: 'Veiculo/Centro de custo' },
];

async function buscarCategorias() {
  return get('/categorias-despesa');
}
async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

export async function render(container) {
  const categorias = await buscarCategorias();

  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Despesas Fixas por Categoria</h1>
    <p class="mb-4 text-sm text-slate-500">Aluguel, seguro, salario e demais gastos fixos, por categoria e periodo.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div>
        <label class="label">Categoria</label>
        <select class="input" data-filtro-categoria>
          <option value="">Todas</option>
          ${categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('')}
        </select>
      </div>
      <div><label class="label">Veiculo/Centro de custo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="card mb-4 p-4">
      <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="mb-2 text-sm font-medium text-slate-700">Colunas visiveis</p>
          <div class="flex flex-wrap gap-3" data-colunas-checkbox>
            ${CATALOGO_COLUNAS.map((c) => `
              <label class="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" class="h-4 w-4" data-coluna="${c.chave}" ${c.padrao ? 'checked' : ''} />
                ${c.titulo}
              </label>
            `).join('')}
          </div>
        </div>
        <div class="w-48">
          <label class="label">Agrupar por</label>
          <select class="input" data-agrupar>${OPCOES_AGRUPAR.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
        </div>
      </div>
    </div>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-resumo></div>
    <div class="mb-4" data-resumo-grupo></div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  const selectCategoria = container.querySelector('[data-filtro-categoria]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const selectAgrupar = container.querySelector('[data-agrupar]');
  const resumoEl = container.querySelector('[data-resumo]');
  const resumoGrupoEl = container.querySelector('[data-resumo-grupo]');
  const tabelaContainer = container.querySelector('[data-tabela]');

  let veiculoId = null;
  let tabela = null;
  function recarregarDados() { if (tabela) tabela.recarregar(); }

  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: (id) => { veiculoId = id; recarregarDados(); } });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);

  attachDataMask(inputDataDe);
  attachDataMask(inputDataAte);
  for (const el of [selectCategoria, inputDataDe, inputDataAte]) el.addEventListener('change', () => recarregarDados());
  selectAgrupar.addEventListener('change', () => recarregarDados());

  function colunasSelecionadas() {
    return CATALOGO_COLUNAS.filter((c) => container.querySelector(`[data-coluna="${c.chave}"]`).checked);
  }

  function calcularGrupo(dados) {
    const agruparPor = selectAgrupar.value;
    if (!agruparPor) return null;
    const grupos = new Map();
    for (const r of dados) {
      const chave = r[agruparPor] || '-';
      if (!grupos.has(chave)) grupos.set(chave, { total: 0, qtd: 0 });
      const g = grupos.get(chave);
      g.total += r.valor;
      g.qtd += 1;
    }
    const linhas = [...grupos.entries()].sort((a, b) => b[1].total - a[1].total);
    const label = OPCOES_AGRUPAR.find((o) => o.value === agruparPor)?.label || agruparPor;
    return { label, linhas };
  }

  function renderResumoGrupo(dados) {
    const grupo = calcularGrupo(dados);
    if (!grupo) { resumoGrupoEl.innerHTML = ''; return; }
    resumoGrupoEl.innerHTML = `
      <div class="card overflow-x-auto border-gray-300 p-0">
        <div class="px-4 pt-3"><h2 class="font-semibold text-slate-900">Total por ${grupo.label}</h2></div>
        <table class="mt-2 w-full min-w-max border-collapse">
          <thead class="bg-brand-black"><tr><th class="table-th">${grupo.label}</th><th class="table-th text-right">Qtd</th><th class="table-th text-right">Total</th></tr></thead>
          <tbody>
            ${grupo.linhas.map(([chave, g]) => `
              <tr class="border-b border-slate-100 last:border-0">
                <td class="table-td">${chave}</td><td class="table-td text-right">${g.qtd}</td><td class="table-td text-right font-medium">${formatarMoeda(g.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function montarTabela() {
    const colunasEscolhidas = colunasSelecionadas();
    tabelaContainer.innerHTML = '';
    tabela = criarDataTable({
      colunas: [...colunasEscolhidas, COLUNA_VALOR],
      ordenacaoInicial: { chave: 'data', direcao: 'desc' },
      exportar: { nomeArquivo: 'despesas-fixas' },
      buscarDados: async (termo) => {
        const params = new URLSearchParams();
        if (selectCategoria.value) params.set('categoria_id', selectCategoria.value);
        if (veiculoId) params.set('veiculo_id', veiculoId);
        if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
        if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
        const query = params.toString();
        const todos = await get(`/relatorios/despesas-fixas${query ? `?${query}` : ''}`);
        const termoLower = (termo || '').toLowerCase();
        const dados = termoLower
          ? todos.filter((r) => [r.categoria_nome, r.veiculo_placa, r.descricao].some((v) => (v || '').toLowerCase().includes(termoLower)))
          : todos;
        const total = dados.reduce((t, r) => t + r.valor, 0);
        resumoEl.innerHTML = `
          <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Total no filtro</p><p class="mt-1 text-2xl font-bold text-red-500">${formatarMoeda(total)}</p></div>
          <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Lancamentos</p><p class="mt-1 text-2xl font-bold text-slate-900">${dados.length}</p></div>
        `;
        renderResumoGrupo(dados);
        return dados;
      },
      vazio: 'Nenhuma despesa fixa encontrada com estes filtros.',
    });
    tabelaContainer.appendChild(tabela.el);
  }

  container.querySelectorAll('[data-coluna]').forEach((chk) => chk.addEventListener('change', montarTabela));
  montarTabela();

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/despesas-fixas',
    obterFiltros: () => ({
      categoriaId: selectCategoria.value,
      veiculoId, veiculoLabel: veiculoSelect.getLabel(),
      dataDe: inputDataDe.value, dataAte: inputDataAte.value,
      agrupar: selectAgrupar.value,
      colunas: colunasSelecionadas().map((c) => c.chave),
    }),
    aplicarFiltros: (f) => {
      selectCategoria.value = f.categoriaId || '';
      veiculoId = f.veiculoId || null;
      veiculoSelect.setValue(f.veiculoId || null, f.veiculoLabel || '');
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      selectAgrupar.value = f.agrupar || '';
      if (Array.isArray(f.colunas)) {
        container.querySelectorAll('[data-coluna]').forEach((chk) => { chk.checked = f.colunas.includes(chk.dataset.coluna); });
      }
      montarTabela();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const colunasEscolhidas = [...colunasSelecionadas(), COLUNA_VALOR];
    const total = dados.reduce((t, r) => t + r.valor, 0);
    const grupo = calcularGrupo(dados);
    const filtros = [];
    if (selectCategoria.value) filtros.push(`Categoria: ${selectCategoria.options[selectCategoria.selectedIndex].text}`);
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Despesas Fixas por Categoria',
      filtros,
      resumo: [
        { label: 'Total no filtro', valor: formatarMoeda(total), cor: 'red' },
        { label: 'Lancamentos', valor: String(dados.length) },
      ],
      colunas: colunasEscolhidas.map((c) => ({ titulo: c.titulo, alinhar: c.chave === 'valor' ? 'right' : undefined })),
      linhas: dados.map((r) => colunasEscolhidas.map((c) => c.render(r))),
      grupo: grupo ? {
        titulo: `Total por ${grupo.label}`,
        colunas: [grupo.label, { titulo: 'Qtd', alinhar: 'right' }, { titulo: 'Total', alinhar: 'right' }],
        linhas: grupo.linhas.map(([chave, g]) => [chave, String(g.qtd), formatarMoeda(g.total)]),
      } : null,
      tituloVazio: 'Nenhuma despesa fixa encontrada com estes filtros.',
    });
  });
}
