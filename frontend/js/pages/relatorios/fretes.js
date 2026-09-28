import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { criarMultiSearchableSelect } from '../../components/multiSearchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { periodoAnteriorEquivalente, renderComparativoPeriodo } from '../../components/comparativoPeriodo.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

// Sem badge de cor no status aqui (diferente de contasReceber.js/
// saldosEmAberto.js): o render() de cada coluna deste catalogo e
// reaproveitado direto tambem no "Exportar PDF" (ver mais abaixo), que trata
// o retorno como texto puro - um badge em HTML apareceria como tag literal
// na impressao.
const CATALOGO_COLUNAS = [
  { chave: 'data_carregamento', titulo: 'Carregamento', padrao: true, render: (r) => (r.data_carregamento ? formatarDataBr(r.data_carregamento) : '-') },
  { chave: 'conjunto', titulo: 'Conjunto', padrao: true, render: (r) => r.conjunto || '-' },
  { chave: 'motorista_nome', titulo: 'Motorista', padrao: true, render: (r) => r.motorista_nome || '-' },
  { chave: 'rota', titulo: 'Origem/Destino', padrao: true, render: (r) => `${r.origem_cidade}/${r.origem_uf} &rarr; ${r.destino_cidade}/${r.destino_uf}` },
  { chave: 'transportadora_nome', titulo: 'Transportadora', padrao: true, render: (r) => r.transportadora_nome || '-' },
  { chave: 'data_descarga', titulo: 'Entrega', padrao: false, render: (r) => (r.data_descarga ? formatarDataBr(r.data_descarga) : '-') },
  { chave: 'peso_carga_kg', titulo: 'Peso', padrao: false, render: (r) => (r.peso_carga_kg ? `${r.peso_carga_kg.toLocaleString('pt-BR')} kg` : '-') },
  { chave: 'status', titulo: 'Status', padrao: true, render: (r) => r.status },
  { chave: 'saldo_pendente', titulo: 'Saldo pendente', padrao: false, render: (r) => formatarMoeda(r.saldo_pendente) },
];
const COLUNA_VALOR = { chave: 'valor', titulo: 'Frete Bruto', render: (r) => formatarMoeda(r.valor), exportar: (r) => r.valor / 100 };

const OPCOES_AGRUPAR = [
  { value: '', label: 'Nenhum' },
  { value: 'transportadora_nome', label: 'Transportadora' },
  { value: 'conjunto', label: 'Conjunto' },
  { value: 'motorista_nome', label: 'Motorista' },
];

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}
async function buscarTransportadoras(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}
async function buscarViagens(termo) {
  const viagens = await get('/viagens');
  const termoLower = (termo || '').toLowerCase();
  const filtradas = termo
    ? viagens.filter((v) => String(v.id).includes(termoLower) || (v.placa_tratora || '').toLowerCase().includes(termoLower))
    : viagens;
  return filtradas.slice(0, 30).map((v) => ({ value: v.id, label: `#${v.id} - ${v.placa_tratora || '?'} (${formatarDataBr(v.data_inicio)})` }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Relatorio de Fretes / Receitas</h1>
    <p class="mb-4 text-sm text-slate-500">Todos os fretes (recebidos ou nao), com filtros e colunas escolhiveis - o par deste relatorio com o de Despesas.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Motorista</label><div data-filtro-motorista></div></div>
      <div><label class="label">Viagem</label><div data-filtro-viagem></div></div>
      <div><label class="label">Transportadora</label><div data-filtro-transportadora></div></div>
      <div><label class="label">Carregamento de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Carregamento ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
      <div class="flex items-center gap-2 pt-6">
        <input type="checkbox" id="comparar-periodo" class="h-4 w-4" data-comparar-periodo />
        <label for="comparar-periodo" class="text-sm text-slate-700">Comparar com periodo anterior</label>
      </div>
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
    <div data-comparativo-periodo></div>
    <div class="mb-4" data-resumo-grupo></div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const selectAgrupar = container.querySelector('[data-agrupar]');
  const checkComparar = container.querySelector('[data-comparar-periodo]');
  const resumoEl = container.querySelector('[data-resumo]');
  const comparativoEl = container.querySelector('[data-comparativo-periodo]');
  const resumoGrupoEl = container.querySelector('[data-resumo-grupo]');
  const tabelaContainer = container.querySelector('[data-tabela]');

  let transportadoraId = null;
  let tabela = null;
  function recarregarDados() { if (tabela) tabela.recarregar(); }

  const veiculoSelect = criarMultiSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: () => recarregarDados() });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);
  const motoristaSelect = criarMultiSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', onChange: () => recarregarDados() });
  container.querySelector('[data-filtro-motorista]').appendChild(motoristaSelect.el);
  const viagemSelect = criarMultiSearchableSelect({ buscar: buscarViagens, placeholder: 'Pesquisar viagem...', onChange: () => recarregarDados() });
  container.querySelector('[data-filtro-viagem]').appendChild(viagemSelect.el);
  const transportadoraSelect = criarSearchableSelect({ buscar: buscarTransportadoras, placeholder: 'Pesquisar transportadora...', onChange: (id) => { transportadoraId = id; recarregarDados(); } });
  container.querySelector('[data-filtro-transportadora]').appendChild(transportadoraSelect.el);

  attachDataMask(inputDataDe);
  attachDataMask(inputDataAte);
  for (const el of [inputDataDe, inputDataAte]) el.addEventListener('change', () => recarregarDados());
  selectAgrupar.addEventListener('change', () => recarregarDados());
  checkComparar.addEventListener('change', () => recarregarDados());

  async function atualizarComparativo(dadosAtuais) {
    if (!checkComparar.checked) { comparativoEl.innerHTML = ''; return; }
    const dataDeIso = inputDataDe.value ? parseDataBrParaIso(inputDataDe.value) : null;
    const dataAteIso = inputDataAte.value ? parseDataBrParaIso(inputDataAte.value) : null;
    const anterior = periodoAnteriorEquivalente(dataDeIso, dataAteIso);
    if (!anterior) { comparativoEl.innerHTML = ''; return; }
    const params = new URLSearchParams();
    for (const id of veiculoSelect.getValues()) params.append('veiculo_id', id);
    for (const id of motoristaSelect.getValues()) params.append('motorista_id', id);
    for (const id of viagemSelect.getValues()) params.append('viagem_id', id);
    if (transportadoraId) params.set('transportadora_id', transportadoraId);
    params.set('data_carregamento_de', anterior.de);
    params.set('data_carregamento_ate', anterior.ate);
    const dadosAnteriores = await get(`/relatorios/fretes?${params.toString()}`);
    const totalAnterior = dadosAnteriores.reduce((t, r) => t + r.valor, 0);
    const totalAtual = dadosAtuais.reduce((t, r) => t + r.valor, 0);
    renderComparativoPeriodo(comparativoEl, {
      periodoAnteriorTexto: `${formatarDataBr(anterior.de)} a ${formatarDataBr(anterior.ate)}`,
      indicadores: [
        { label: 'Frete bruto total', atual: totalAtual, anterior: totalAnterior, formatador: formatarMoeda },
        { label: 'Fretes', atual: dadosAtuais.length, anterior: dadosAnteriores.length, formatador: (v) => v.toLocaleString('pt-BR') },
      ],
    });
  }

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
      ordenacaoInicial: { chave: 'data_carregamento', direcao: 'desc' },
      corLinha: (r) => (r.status === 'Atrasado' ? 'bg-red-950/40' : ''),
      exportar: { nomeArquivo: 'relatorio-fretes' },
      buscarDados: async (termo) => {
        const params = new URLSearchParams();
        for (const id of veiculoSelect.getValues()) params.append('veiculo_id', id);
        for (const id of motoristaSelect.getValues()) params.append('motorista_id', id);
        for (const id of viagemSelect.getValues()) params.append('viagem_id', id);
        if (transportadoraId) params.set('transportadora_id', transportadoraId);
        if (inputDataDe.value) params.set('data_carregamento_de', parseDataBrParaIso(inputDataDe.value));
        if (inputDataAte.value) params.set('data_carregamento_ate', parseDataBrParaIso(inputDataAte.value));
        const query = params.toString();
        const todos = await get(`/relatorios/fretes${query ? `?${query}` : ''}`);
        const termoLower = (termo || '').toLowerCase();
        const dados = termoLower
          ? todos.filter((r) => [r.conjunto, r.motorista_nome, r.transportadora_nome, r.origem_cidade, r.destino_cidade]
              .some((v) => (v || '').toLowerCase().includes(termoLower)))
          : todos;
        const total = dados.reduce((t, r) => t + r.valor, 0);
        const pendente = dados.reduce((t, r) => t + r.saldo_pendente, 0);
        resumoEl.innerHTML = `
          <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Frete bruto total</p><p class="mt-1 text-2xl font-bold text-emerald-500">${formatarMoeda(total)}</p></div>
          <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Saldo ainda pendente</p><p class="mt-1 text-2xl font-bold text-amber-400">${formatarMoeda(pendente)}</p></div>
        `;
        renderResumoGrupo(dados);
        atualizarComparativo(dados);
        return dados;
      },
      vazio: 'Nenhum frete encontrado com estes filtros.',
    });
    tabelaContainer.appendChild(tabela.el);
  }

  container.querySelectorAll('[data-coluna]').forEach((chk) => chk.addEventListener('change', montarTabela));
  montarTabela();

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/fretes',
    obterFiltros: () => ({
      veiculoIds: veiculoSelect.getValues(), veiculoLabels: veiculoSelect.getLabels(),
      motoristaIds: motoristaSelect.getValues(), motoristaLabels: motoristaSelect.getLabels(),
      viagemIds: viagemSelect.getValues(), viagemLabels: viagemSelect.getLabels(),
      transportadoraId, transportadoraLabel: transportadoraSelect.getLabel(),
      dataDe: inputDataDe.value, dataAte: inputDataAte.value,
      agrupar: selectAgrupar.value,
      colunas: colunasSelecionadas().map((c) => c.chave),
      comparar: checkComparar.checked,
    }),
    aplicarFiltros: (f) => {
      veiculoSelect.setValues(f.veiculoIds || [], f.veiculoLabels || []);
      motoristaSelect.setValues(f.motoristaIds || [], f.motoristaLabels || []);
      viagemSelect.setValues(f.viagemIds || [], f.viagemLabels || []);
      transportadoraId = f.transportadoraId || null;
      transportadoraSelect.setValue(f.transportadoraId || null, f.transportadoraLabel || '');
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      selectAgrupar.value = f.agrupar || '';
      if (Array.isArray(f.colunas)) {
        container.querySelectorAll('[data-coluna]').forEach((chk) => { chk.checked = f.colunas.includes(chk.dataset.coluna); });
      }
      checkComparar.checked = Boolean(f.comparar);
      montarTabela();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const colunasEscolhidas = [...colunasSelecionadas(), COLUNA_VALOR];
    const total = dados.reduce((t, r) => t + r.valor, 0);
    const pendente = dados.reduce((t, r) => t + r.saldo_pendente, 0);
    const grupo = calcularGrupo(dados);
    const filtros = [];
    if (veiculoSelect.getValues().length) filtros.push(`Veiculo: ${veiculoSelect.getLabels().join(', ')}`);
    if (motoristaSelect.getValues().length) filtros.push(`Motorista: ${motoristaSelect.getLabels().join(', ')}`);
    if (viagemSelect.getValues().length) filtros.push(`Viagem: ${viagemSelect.getLabels().join(', ')}`);
    if (transportadoraSelect.getValue()) filtros.push(`Transportadora: ${transportadoraSelect.getLabel()}`);
    if (inputDataDe.value) filtros.push(`Carregamento de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Carregamento ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Relatorio de Fretes / Receitas',
      filtros,
      resumo: [
        { label: 'Frete bruto total', valor: formatarMoeda(total), cor: 'emerald' },
        { label: 'Saldo ainda pendente', valor: formatarMoeda(pendente), cor: 'amber' },
        { label: 'Fretes', valor: String(dados.length) },
      ],
      colunas: colunasEscolhidas.map((c) => ({ titulo: c.titulo, alinhar: c.chave === 'valor' || c.chave === 'saldo_pendente' ? 'right' : undefined })),
      linhas: dados.map((r) => colunasEscolhidas.map((c) => (c.chave === 'rota'
        ? `${r.origem_cidade}/${r.origem_uf} -> ${r.destino_cidade}/${r.destino_uf}`
        : c.render(r)))),
      grupo: grupo ? {
        titulo: `Total por ${grupo.label}`,
        colunas: [grupo.label, { titulo: 'Qtd', alinhar: 'right' }, { titulo: 'Total', alinhar: 'right' }],
        linhas: grupo.linhas.map(([chave, g]) => [chave, String(g.qtd), formatarMoeda(g.total)]),
      } : null,
      tituloVazio: 'Nenhum frete encontrado com estes filtros.',
    });
  });
}
