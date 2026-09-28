import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const ORIGEM_LABEL = {
  ContaPagar: 'Conta a Pagar', ContaReceber: 'Conta a Receber', ViagemAdiantamento: 'Adiantamento de Viagem', Ajuste: 'Ajuste Manual',
};

async function buscarContasBancarias(termo) {
  const contas = await get('/contas-bancarias');
  const filtradas = termo ? contas.filter((c) => c.nome.toLowerCase().includes(termo.toLowerCase())) : contas;
  return filtradas.map((c) => ({ value: c.id, label: c.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Fluxo de Caixa</h1>
    <p class="mb-4 text-sm text-slate-500">Entradas e saidas ja realizadas (nao inclui contas a pagar/receber ainda pendentes) por conta bancaria e periodo.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Conta bancaria</label><div data-filtro-conta></div></div>
      <div>
        <label class="label">Tipo</label>
        <select class="input" data-filtro-tipo>
          <option value="">Todos</option>
          <option value="Entrada">Entrada</option>
          <option value="Saida">Saida</option>
        </select>
      </div>
      <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3" data-resumo></div>
    <div class="mb-3 flex justify-end"><button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button></div>
    <div data-tabela></div>
  `;

  let contaId = null;
  const contaSelect = criarSearchableSelect({ buscar: buscarContasBancarias, placeholder: 'Pesquisar conta...', onChange: (id) => { contaId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-conta]').appendChild(contaSelect.el);

  const selectTipo = container.querySelector('[data-filtro-tipo]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const resumoEl = container.querySelector('[data-resumo]');
  selectTipo.addEventListener('change', () => tabela.recarregar());
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataBr(r.data) },
      { chave: 'conta_bancaria_nome', titulo: 'Conta', render: (r) => r.conta_bancaria_nome },
      { chave: 'tipo', titulo: 'Tipo', render: (r) => `<span class="${r.tipo === 'Entrada' ? 'badge-sucesso' : 'badge-critico'}">${r.tipo}</span>`, exportar: (r) => r.tipo },
      { chave: 'descricao', titulo: 'Descricao', render: (r) => r.descricao || '-', truncar: true },
      { chave: 'origem_tipo', titulo: 'Origem', render: (r) => ORIGEM_LABEL[r.origem_tipo] || r.origem_tipo || '-' },
      { chave: 'valor', titulo: 'Valor', render: (r) => `<span class="${r.tipo === 'Entrada' ? 'text-emerald-500' : 'text-red-500'} font-semibold">${r.tipo === 'Entrada' ? '+' : '-'}${formatarMoeda(r.valor)}</span>`, exportar: (r) => (r.tipo === 'Entrada' ? r.valor / 100 : -r.valor / 100) },
    ],
    ordenacaoInicial: { chave: 'data', direcao: 'desc' },
    exportar: { nomeArquivo: 'fluxo-caixa' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (contaId) params.set('conta_bancaria_id', contaId);
      if (selectTipo.value) params.set('tipo', selectTipo.value);
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/fluxo-caixa${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.conta_bancaria_nome, r.descricao].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      const entradas = dados.filter((r) => r.tipo === 'Entrada').reduce((t, r) => t + r.valor, 0);
      const saidas = dados.filter((r) => r.tipo === 'Saida').reduce((t, r) => t + r.valor, 0);
      const saldo = entradas - saidas;
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Entradas</p><p class="mt-1 text-2xl font-bold text-emerald-500">${formatarMoeda(entradas)}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Saidas</p><p class="mt-1 text-2xl font-bold text-red-500">${formatarMoeda(saidas)}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Saldo do periodo filtrado</p><p class="mt-1 text-2xl font-bold ${saldo >= 0 ? 'text-slate-900' : 'text-red-500'}">${formatarMoeda(saldo)}</p></div>
      `;
      return dados;
    },
    vazio: 'Nenhuma movimentacao encontrada com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const entradas = dados.filter((r) => r.tipo === 'Entrada').reduce((t, r) => t + r.valor, 0);
    const saidas = dados.filter((r) => r.tipo === 'Saida').reduce((t, r) => t + r.valor, 0);
    const saldo = entradas - saidas;
    const filtros = [];
    if (contaSelect.getValue()) filtros.push(`Conta: ${contaSelect.getLabel()}`);
    if (selectTipo.value) filtros.push(`Tipo: ${selectTipo.value}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Fluxo de Caixa',
      filtros,
      resumo: [
        { label: 'Entradas', valor: formatarMoeda(entradas), cor: 'emerald' },
        { label: 'Saidas', valor: formatarMoeda(saidas), cor: 'red' },
        { label: 'Saldo do periodo', valor: formatarMoeda(saldo), cor: saldo >= 0 ? 'zinc' : 'red' },
      ],
      colunas: ['Data', 'Conta', 'Tipo', 'Descricao', 'Origem', { titulo: 'Valor', alinhar: 'right' }],
      linhas: dados.map((r) => [
        formatarDataBr(r.data), r.conta_bancaria_nome, r.tipo, r.descricao || '-', ORIGEM_LABEL[r.origem_tipo] || r.origem_tipo || '-',
        `${r.tipo === 'Entrada' ? '+' : '-'}${formatarMoeda(r.valor)}`,
      ]),
      tituloVazio: 'Nenhuma movimentacao encontrada com estes filtros.',
    });
  });
}
