import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const TIPOS_EVENTO = ['Aquisicao', 'Instalacao', 'Remocao', 'EnvioRecapagem', 'RetornoRecapagem', 'Sucateamento'];

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Pneus - Custo e Vida Util</h1>
    <p class="mb-4 text-sm text-slate-500">Eventos de aquisicao/instalacao/remocao/recapagem - agrupe por pneu para ver custo total e km rodado no periodo filtrado.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Numero de fogo</label><input type="text" class="input" data-filtro-fogo placeholder="Buscar por numero de fogo" /></div>
      <div>
        <label class="label">Tipo de evento</label>
        <select class="input" data-filtro-tipo-evento>
          <option value="">Todos</option>
          ${TIPOS_EVENTO.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
        <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
      </div>
    </div>
    <div class="mb-4 flex items-center justify-end gap-2">
      <input type="checkbox" id="agrupar-pneu" class="h-4 w-4" data-agrupar-pneu />
      <label for="agrupar-pneu" class="text-sm text-slate-700">Agrupar por pneu (custo total e km rodado)</label>
      <button type="button" class="btn-secondary btn-sm ml-4" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div class="mb-4" data-resumo-grupo></div>
    <div data-tabela></div>
  `;

  let veiculoId = null;
  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: (id) => { veiculoId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);

  const inputFogo = container.querySelector('[data-filtro-fogo]');
  const selectTipoEvento = container.querySelector('[data-filtro-tipo-evento]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const checkAgrupar = container.querySelector('[data-agrupar-pneu]');
  const resumoGrupoEl = container.querySelector('[data-resumo-grupo]');
  let debounceId = null;
  inputFogo.addEventListener('input', () => { clearTimeout(debounceId); debounceId = setTimeout(() => tabela.recarregar(), 300); });
  selectTipoEvento.addEventListener('change', () => tabela.recarregar());
  checkAgrupar.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  // Agrupar por pneu: soma de custo (todos os eventos com custo lancado) e
  // "km rodado no periodo filtrado" como proxy de vida util = maior
  // km_veiculo menos o menor km_veiculo entre os eventos daquele pneu no
  // conjunto ja filtrado (nao e o ciclo de vida inteiro do pneu, so o que
  // esta dentro do filtro atual).
  function agruparPorPneu(dados) {
    const grupos = new Map();
    for (const r of dados) {
      if (!grupos.has(r.pneu_id)) grupos.set(r.pneu_id, { numero_fogo: r.numero_fogo, custoTotal: 0, qtdEventos: 0, kms: [] });
      const g = grupos.get(r.pneu_id);
      g.custoTotal += r.custo || 0;
      g.qtdEventos += 1;
      if (r.km_veiculo != null) g.kms.push(r.km_veiculo);
    }
    return [...grupos.values()].map((g) => ({
      numero_fogo: g.numero_fogo,
      custoTotal: g.custoTotal,
      qtdEventos: g.qtdEventos,
      kmRodado: g.kms.length >= 2 ? Math.max(...g.kms) - Math.min(...g.kms) : null,
    })).sort((a, b) => b.custoTotal - a.custoTotal);
  }

  function renderResumoGrupo(dados) {
    if (!checkAgrupar.checked) { resumoGrupoEl.innerHTML = ''; return; }
    const grupos = agruparPorPneu(dados);
    resumoGrupoEl.innerHTML = `
      <div class="card overflow-x-auto border-gray-300 p-0">
        <div class="px-4 pt-3"><h2 class="font-semibold text-slate-900">Por pneu</h2></div>
        <table class="mt-2 w-full min-w-max border-collapse">
          <thead class="bg-brand-black"><tr>
            <th class="table-th">Numero de fogo</th><th class="table-th text-right">Eventos</th><th class="table-th text-right">Km rodado (no filtro)</th><th class="table-th text-right">Custo total</th>
          </tr></thead>
          <tbody>
            ${grupos.map((g) => `
              <tr class="border-b border-slate-100 last:border-0">
                <td class="table-td">${g.numero_fogo}</td>
                <td class="table-td text-right">${g.qtdEventos}</td>
                <td class="table-td text-right">${g.kmRodado != null ? `${g.kmRodado.toLocaleString('pt-BR')} km` : '-'}</td>
                <td class="table-td text-right font-medium">${formatarMoeda(g.custoTotal)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataBr(r.data) },
      { chave: 'numero_fogo', titulo: 'Numero de fogo', render: (r) => r.numero_fogo },
      { chave: 'tipo_evento', titulo: 'Evento', render: (r) => r.tipo_evento },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa || '-' },
      { chave: 'posicao', titulo: 'Posicao', render: (r) => (r.eixo ? `Eixo ${r.eixo} - ${r.lado}` : '-') },
      { chave: 'km_veiculo', titulo: 'KM', render: (r) => (r.km_veiculo != null ? r.km_veiculo.toLocaleString('pt-BR') : '-') },
      { chave: 'fornecedor_nome', titulo: 'Fornecedor/Recapadora', render: (r) => r.fornecedor_nome || '-' },
      { chave: 'custo', titulo: 'Custo', render: (r) => (r.custo != null ? formatarMoeda(r.custo) : '-'), exportar: (r) => (r.custo != null ? r.custo / 100 : '') },
    ],
    ordenacaoInicial: { chave: 'data', direcao: 'desc' },
    exportar: { nomeArquivo: 'pneus' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (veiculoId) params.set('veiculo_id', veiculoId);
      if (inputFogo.value.trim()) params.set('numero_fogo', inputFogo.value.trim());
      if (selectTipoEvento.value) params.set('tipo_evento', selectTipoEvento.value);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/pneus${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.numero_fogo, r.veiculo_placa, r.fornecedor_nome].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      renderResumoGrupo(dados);
      return dados;
    },
    vazio: 'Nenhum evento de pneu encontrado com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const filtros = [];
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    if (inputFogo.value.trim()) filtros.push(`Numero de fogo: ${inputFogo.value.trim()}`);
    if (selectTipoEvento.value) filtros.push(`Evento: ${selectTipoEvento.value}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    const grupo = checkAgrupar.checked ? agruparPorPneu(dados) : null;
    abrirRelatorioImpressao({
      titulo: 'Pneus - Custo e Vida Util',
      filtros,
      colunas: ['Data', 'Numero de fogo', 'Evento', 'Veiculo', 'Posicao', 'KM', 'Fornecedor/Recapadora', { titulo: 'Custo', alinhar: 'right' }],
      linhas: dados.map((r) => [
        formatarDataBr(r.data), r.numero_fogo, r.tipo_evento, r.veiculo_placa || '-',
        r.eixo ? `Eixo ${r.eixo} - ${r.lado}` : '-', r.km_veiculo != null ? r.km_veiculo.toLocaleString('pt-BR') : '-',
        r.fornecedor_nome || '-', r.custo != null ? formatarMoeda(r.custo) : '-',
      ]),
      grupo: grupo ? {
        titulo: 'Por pneu',
        colunas: ['Numero de fogo', { titulo: 'Eventos', alinhar: 'right' }, { titulo: 'Km rodado (no filtro)', alinhar: 'right' }, { titulo: 'Custo total', alinhar: 'right' }],
        linhas: grupo.map((g) => [g.numero_fogo, String(g.qtdEventos), g.kmRodado != null ? `${g.kmRodado.toLocaleString('pt-BR')} km` : '-', formatarMoeda(g.custoTotal)]),
      } : null,
      tituloVazio: 'Nenhum evento de pneu encontrado com estes filtros.',
    });
  });
}
