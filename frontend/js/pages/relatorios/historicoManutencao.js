import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { criarMultiSearchableSelect } from '../../components/multiSearchableSelect.js';
import { buscarConjuntos } from '../../components/conjuntoOpcoes.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

function textoItens(itens) {
  if (!itens || !itens.length) return '-';
  return itens.map((i) => `${i.descricao}${i.quantidade !== 1 ? ` (${i.quantidade}x)` : ''}`).join(', ');
}

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Historico de Manutencao</h1>
    <p class="mb-4 text-sm text-slate-500">O que ja foi feito em cada conjunto (cavalo e carreta), em ordem cronologica.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Conjunto</label><div data-filtro-conjunto></div></div>
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div>
        <label class="label">Tipo</label>
        <select class="input" data-filtro-tipo>
          <option value="">Todos</option>
          <option value="Preventiva">Preventiva</option>
          <option value="Corretiva">Corretiva</option>
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
  const conjuntoSelect = criarMultiSearchableSelect({ buscar: buscarConjuntos, placeholder: 'Pesquisar conjunto...', onChange: () => tabela.recarregar() });
  container.querySelector('[data-filtro-conjunto]').appendChild(conjuntoSelect.el);

  const selectTipo = container.querySelector('[data-filtro-tipo]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  selectTipo.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataBr(r.data) },
      { chave: 'conjunto', titulo: 'Conjunto', render: (r) => r.conjunto || '-' },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa },
      { chave: 'hodometro', titulo: 'Hodometro', render: (r) => (r.hodometro != null ? r.hodometro.toLocaleString('pt-BR') : '-') },
      { chave: 'tipo', titulo: 'Tipo', render: (r) => r.tipo },
      { chave: 'descricao', titulo: 'Descricao', render: (r) => r.descricao || '-', truncar: true },
      { chave: 'itens', titulo: 'Itens', render: (r) => textoItens(r.itens), truncar: true },
      { chave: 'fornecedor_nome', titulo: 'Oficina', render: (r) => r.fornecedor_nome || '-' },
      { chave: 'valor_total', titulo: 'Total', render: (r) => formatarMoeda(r.valor_total), exportar: (r) => r.valor_total / 100 },
    ],
    ordenacaoInicial: { chave: 'data', direcao: 'asc' },
    exportar: { nomeArquivo: 'historico-manutencao' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (veiculoId) params.set('veiculo_id', veiculoId);
      for (const id of conjuntoSelect.getValues()) params.append('conjunto_id', id);
      if (selectTipo.value) params.set('tipo', selectTipo.value);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/ordens-servico${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      return termoLower
        ? todos.filter((r) => [r.veiculo_placa, r.conjunto, r.fornecedor_nome, r.descricao].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
    },
    vazio: 'Nenhuma ordem de servico encontrada com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/manutencao-historico',
    obterFiltros: () => ({
      veiculoId, veiculoLabel: veiculoSelect.getLabel(),
      conjuntoIds: conjuntoSelect.getValues(), conjuntoLabels: conjuntoSelect.getLabels(),
      tipo: selectTipo.value, dataDe: inputDataDe.value, dataAte: inputDataAte.value,
    }),
    aplicarFiltros: (f) => {
      veiculoId = f.veiculoId || null;
      veiculoSelect.setValue(f.veiculoId || null, f.veiculoLabel || '');
      conjuntoSelect.setValues(f.conjuntoIds || [], f.conjuntoLabels || []);
      selectTipo.value = f.tipo || '';
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const filtros = [];
    if (conjuntoSelect.getValues().length) filtros.push(`Conjunto: ${conjuntoSelect.getLabels().join(', ')}`);
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    if (selectTipo.value) filtros.push(`Tipo: ${selectTipo.value}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Historico de Manutencao',
      filtros,
      colunas: ['Data', 'Conjunto', 'Veiculo', 'Hodometro', 'Tipo', 'Descricao', 'Itens', 'Oficina', { titulo: 'Total', alinhar: 'right' }],
      linhas: dados.map((r) => [
        formatarDataBr(r.data), r.conjunto || '-', r.veiculo_placa, r.hodometro != null ? r.hodometro.toLocaleString('pt-BR') : '-',
        r.tipo, r.descricao || '-', textoItens(r.itens), r.fornecedor_nome || '-', formatarMoeda(r.valor_total),
      ]),
      tituloVazio: 'Nenhuma ordem de servico encontrada com estes filtros.',
    });
  });
}
