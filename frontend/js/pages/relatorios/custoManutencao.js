import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const OPCOES_AGRUPAR = [
  { value: '', label: 'Nenhum' },
  { value: 'veiculo_placa', label: 'Veiculo' },
  { value: 'tipo', label: 'Tipo (Preventiva/Corretiva)' },
  { value: 'fornecedor_nome', label: 'Oficina' },
];

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarOficinas(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Custo de Manutencao por Veiculo</h1>
    <p class="mb-4 text-sm text-slate-500">Quanto cada veiculo custou em pecas e mao de obra no periodo.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div>
        <label class="label">Tipo</label>
        <select class="input" data-filtro-tipo>
          <option value="">Todos</option>
          <option value="Preventiva">Preventiva</option>
          <option value="Corretiva">Corretiva</option>
        </select>
      </div>
      <div><label class="label">Oficina</label><div data-filtro-oficina></div></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
        <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
      </div>
    </div>
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-wrap items-end gap-3">
        <div data-relatorios-salvos></div>
        <div class="w-56">
          <label class="label">Agrupar por</label>
          <select class="input" data-agrupar>${OPCOES_AGRUPAR.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
        </div>
      </div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-resumo></div>
    <div class="mb-4" data-resumo-grupo></div>
    <div data-tabela></div>
  `;

  let veiculoId = null;
  let oficinaId = null;
  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: (id) => { veiculoId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);
  const oficinaSelect = criarSearchableSelect({ buscar: buscarOficinas, placeholder: 'Pesquisar oficina...', onChange: (id) => { oficinaId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-oficina]').appendChild(oficinaSelect.el);

  const selectTipo = container.querySelector('[data-filtro-tipo]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const selectAgrupar = container.querySelector('[data-agrupar]');
  const resumoEl = container.querySelector('[data-resumo]');
  const resumoGrupoEl = container.querySelector('[data-resumo-grupo]');
  selectTipo.addEventListener('change', () => tabela.recarregar());
  selectAgrupar.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  function calcularGrupo(dados) {
    const agruparPor = selectAgrupar.value;
    if (!agruparPor) return null;
    const grupos = new Map();
    for (const r of dados) {
      const chave = r[agruparPor] || '-';
      if (!grupos.has(chave)) grupos.set(chave, { total: 0, qtd: 0 });
      const g = grupos.get(chave);
      g.total += r.valor_total;
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
              <tr class="border-b border-slate-100 last:border-0"><td class="table-td">${chave}</td><td class="table-td text-right">${g.qtd}</td><td class="table-td text-right font-medium">${formatarMoeda(g.total)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataBr(r.data) },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa },
      { chave: 'tipo', titulo: 'Tipo', render: (r) => r.tipo },
      { chave: 'fornecedor_nome', titulo: 'Oficina', render: (r) => r.fornecedor_nome || '-' },
      { chave: 'valor_pecas', titulo: 'Pecas', render: (r) => formatarMoeda(r.valor_pecas), exportar: (r) => r.valor_pecas / 100 },
      { chave: 'valor_mao_obra', titulo: 'Mao de obra', render: (r) => formatarMoeda(r.valor_mao_obra), exportar: (r) => r.valor_mao_obra / 100 },
      { chave: 'valor_total', titulo: 'Total', render: (r) => `<span class="font-semibold">${formatarMoeda(r.valor_total)}</span>`, exportar: (r) => r.valor_total / 100 },
    ],
    ordenacaoInicial: { chave: 'data', direcao: 'desc' },
    exportar: { nomeArquivo: 'custo-manutencao' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (veiculoId) params.set('veiculo_id', veiculoId);
      if (selectTipo.value) params.set('tipo', selectTipo.value);
      if (oficinaId) params.set('fornecedor_id', oficinaId);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/ordens-servico${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.veiculo_placa, r.fornecedor_nome, r.descricao].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      const total = dados.reduce((t, r) => t + r.valor_total, 0);
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Total no filtro</p><p class="mt-1 text-2xl font-bold text-red-500">${formatarMoeda(total)}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Ordens de servico</p><p class="mt-1 text-2xl font-bold text-slate-900">${dados.length}</p></div>
      `;
      renderResumoGrupo(dados);
      return dados;
    },
    vazio: 'Nenhuma ordem de servico encontrada com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/manutencao-custo',
    obterFiltros: () => ({
      veiculoId, veiculoLabel: veiculoSelect.getLabel(),
      tipo: selectTipo.value,
      oficinaId, oficinaLabel: oficinaSelect.getLabel(),
      dataDe: inputDataDe.value, dataAte: inputDataAte.value, agrupar: selectAgrupar.value,
    }),
    aplicarFiltros: (f) => {
      veiculoId = f.veiculoId || null;
      veiculoSelect.setValue(f.veiculoId || null, f.veiculoLabel || '');
      selectTipo.value = f.tipo || '';
      oficinaId = f.oficinaId || null;
      oficinaSelect.setValue(f.oficinaId || null, f.oficinaLabel || '');
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      selectAgrupar.value = f.agrupar || '';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const total = dados.reduce((t, r) => t + r.valor_total, 0);
    const grupo = calcularGrupo(dados);
    const filtros = [];
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    if (selectTipo.value) filtros.push(`Tipo: ${selectTipo.value}`);
    if (oficinaSelect.getValue()) filtros.push(`Oficina: ${oficinaSelect.getLabel()}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Custo de Manutencao por Veiculo',
      filtros,
      resumo: [
        { label: 'Total no filtro', valor: formatarMoeda(total), cor: 'red' },
        { label: 'Ordens de servico', valor: String(dados.length) },
      ],
      colunas: ['Data', 'Veiculo', 'Tipo', 'Oficina', { titulo: 'Pecas', alinhar: 'right' }, { titulo: 'Mao de obra', alinhar: 'right' }, { titulo: 'Total', alinhar: 'right' }],
      linhas: dados.map((r) => [
        formatarDataBr(r.data), r.veiculo_placa, r.tipo, r.fornecedor_nome || '-',
        formatarMoeda(r.valor_pecas), formatarMoeda(r.valor_mao_obra), formatarMoeda(r.valor_total),
      ]),
      grupo: grupo ? {
        titulo: `Total por ${grupo.label}`,
        colunas: [grupo.label, { titulo: 'Qtd', alinhar: 'right' }, { titulo: 'Total', alinhar: 'right' }],
        linhas: grupo.linhas.map(([chave, g]) => [chave, String(g.qtd), formatarMoeda(g.total)]),
      } : null,
      tituloVazio: 'Nenhuma ordem de servico encontrada com estes filtros.',
    });
  });
}
