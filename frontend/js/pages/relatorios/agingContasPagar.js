import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const ORIGEM_LABEL = {
  EstoqueMovimentacao: 'Compra de Estoque', PneuEvento: 'Pneu', OrdemServico: 'Ordem de Servico',
  OrdemServicoParcela: 'Parcela de OS', DespesaViagem: 'Despesa de Viagem', DespesaFixa: 'Despesa Fixa',
  DespesaFixaParcela: 'Parcela de Despesa Fixa', FinanciamentoParcela: 'Parcela de Financiamento',
  ReembolsoMotorista: 'Reembolso ao Motorista', AcertoViagem: 'Acerto de Viagem', Outro: 'Outro',
};

// Faixas de atraso - a mesma logica de qualquer relatorio de aging (dias
// negativos = ainda nao venceu). Ordem fixa (nao alfabetica) pra ficar da
// mais proxima/urgente pra mais distante nos cards de resumo.
const FAIXAS = [
  { chave: 'a_vencer', titulo: 'A vencer', teste: (d) => d < 0, cor: 'zinc' },
  { chave: 'ate_15', titulo: '0-15 dias', teste: (d) => d >= 0 && d <= 15, cor: 'amber' },
  { chave: '16_30', titulo: '16-30 dias', teste: (d) => d > 15 && d <= 30, cor: 'amber' },
  { chave: '31_60', titulo: '31-60 dias', teste: (d) => d > 30 && d <= 60, cor: 'red' },
  { chave: 'acima_60', titulo: '60+ dias', teste: (d) => d > 60, cor: 'red' },
];
function faixaDe(dias) {
  return FAIXAS.find((f) => f.teste(dias)) || FAIXAS[0];
}
function textoDias(dias) {
  if (dias < 0) return `Vence em ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return 'Vence hoje';
  return `${dias} dia(s) vencido`;
}

async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Aging de Contas a Pagar</h1>
    <p class="mb-4 text-sm text-slate-500">O que devo, para quem, e ha quanto tempo (ou faltando quanto para vencer).</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Fornecedor</label><div data-filtro-fornecedor></div></div>
      <div>
        <label class="label">Origem</label>
        <select class="input" data-filtro-origem>
          <option value="">Todas</option>
          ${Object.entries(ORIGEM_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      <div><label class="label">Vencimento de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Vencimento ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5" data-faixas></div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  let fornecedorId = null;
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar fornecedor...', onChange: (id) => { fornecedorId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-fornecedor]').appendChild(fornecedorSelect.el);

  const selectOrigem = container.querySelector('[data-filtro-origem]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const faixasEl = container.querySelector('[data-faixas]');
  selectOrigem.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  function calcularFaixas(dados) {
    return FAIXAS.map((f) => {
      const itens = dados.filter((r) => faixaDe(r.dias_vencido).chave === f.chave);
      return { ...f, qtd: itens.length, total: itens.reduce((t, r) => t + r.saldo_pendente, 0) };
    });
  }

  const COR_TEXTO = { zinc: 'text-slate-900', amber: 'text-amber-400', red: 'text-red-600' };
  function renderFaixas(dados) {
    const faixas = calcularFaixas(dados);
    faixasEl.innerHTML = faixas.map((f) => `
      <div class="card p-4">
        <p class="text-xs font-medium uppercase text-slate-500">${f.titulo}</p>
        <p class="mt-1 text-xl font-bold ${COR_TEXTO[f.cor]}">${formatarMoeda(f.total)}</p>
        <p class="text-xs text-slate-400">${f.qtd} conta${f.qtd === 1 ? '' : 's'}</p>
      </div>
    `).join('');
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data_vencimento', titulo: 'Vencimento', render: (r) => formatarDataBr(r.data_vencimento) },
      { chave: 'fornecedor_nome', titulo: 'Fornecedor', render: (r) => r.fornecedor_nome || '-' },
      { chave: 'descricao', titulo: 'Descricao', render: (r) => r.descricao, truncar: true },
      { chave: 'origem_tipo', titulo: 'Origem', render: (r) => ORIGEM_LABEL[r.origem_tipo] || r.origem_tipo || '-' },
      { chave: 'dias_vencido', titulo: 'Situacao', render: (r) => `<span class="badge-${faixaDe(r.dias_vencido).cor === 'zinc' ? 'neutro' : faixaDe(r.dias_vencido).cor === 'amber' ? 'atencao' : 'critico'}">${textoDias(r.dias_vencido)}</span>`, exportar: (r) => textoDias(r.dias_vencido) },
      { chave: 'saldo_pendente', titulo: 'Saldo pendente', render: (r) => `<span class="font-semibold">${formatarMoeda(r.saldo_pendente)}</span>`, exportar: (r) => r.saldo_pendente / 100 },
    ],
    ordenacaoInicial: { chave: 'data_vencimento', direcao: 'asc' },
    corLinha: (r) => (r.dias_vencido > 30 ? 'bg-red-950/40' : ''),
    exportar: { nomeArquivo: 'aging-contas-pagar' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (fornecedorId) params.set('fornecedor_id', fornecedorId);
      if (selectOrigem.value) params.set('origem_tipo', selectOrigem.value);
      if (inputDataDe.value) params.set('data_vencimento_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_vencimento_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/aging-contas-pagar${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.fornecedor_nome, r.descricao].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      renderFaixas(dados);
      return dados;
    },
    vazio: 'Nenhuma conta a pagar em aberto com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/aging-contas-pagar',
    obterFiltros: () => ({
      fornecedorId, fornecedorLabel: fornecedorSelect.getLabel(),
      origem: selectOrigem.value, dataDe: inputDataDe.value, dataAte: inputDataAte.value,
    }),
    aplicarFiltros: (f) => {
      fornecedorId = f.fornecedorId || null;
      fornecedorSelect.setValue(f.fornecedorId || null, f.fornecedorLabel || '');
      selectOrigem.value = f.origem || '';
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const faixas = calcularFaixas(dados);
    const filtros = [];
    if (fornecedorSelect.getValue()) filtros.push(`Fornecedor: ${fornecedorSelect.getLabel()}`);
    if (selectOrigem.value) filtros.push(`Origem: ${ORIGEM_LABEL[selectOrigem.value] || selectOrigem.value}`);
    if (inputDataDe.value) filtros.push(`Vencimento de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Vencimento ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Aging de Contas a Pagar',
      filtros,
      resumo: faixas.map((f) => ({ label: f.titulo, valor: formatarMoeda(f.total), cor: f.cor === 'zinc' ? 'zinc' : f.cor })),
      colunas: ['Vencimento', 'Fornecedor', 'Descricao', 'Origem', 'Situacao', { titulo: 'Saldo pendente', alinhar: 'right' }],
      linhas: dados.map((r) => [
        formatarDataBr(r.data_vencimento), r.fornecedor_nome || '-', r.descricao, ORIGEM_LABEL[r.origem_tipo] || r.origem_tipo || '-',
        textoDias(r.dias_vencido), formatarMoeda(r.saldo_pendente),
      ]),
      tituloVazio: 'Nenhuma conta a pagar em aberto com estes filtros.',
    });
  });
}
