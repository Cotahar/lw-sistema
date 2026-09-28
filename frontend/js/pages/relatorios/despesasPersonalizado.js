import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const CHAVE_COLUNAS = 'frottex-colunas-relatorio-despesas';

// Catalogo de colunas disponiveis (opcao 2 do relatorio flexivel: nao e
// "qualquer tabela", e um domino so - despesas de viagem - mas o usuario
// escolhe quais destas colunas aparecem/exportam). "valor" nao entra aqui:
// fica sempre fixo como ultima coluna, um relatorio de despesas sem o valor
// nao faz sentido.
const CATALOGO_COLUNAS = [
  { chave: 'data', titulo: 'Data', padrao: true, render: (r) => formatarDataBr(r.data) },
  { chave: 'categoria_nome', titulo: 'Categoria', padrao: true, render: (r) => r.categoria_nome || '-' },
  { chave: 'veiculo_placa', titulo: 'Veiculo', padrao: true, render: (r) => r.veiculo_placa || '-' },
  { chave: 'motorista_nome', titulo: 'Motorista', padrao: true, render: (r) => r.motorista_nome || '-' },
  { chave: 'fornecedor_nome', titulo: 'Fornecedor', padrao: true, render: (r) => r.fornecedor_nome || '-' },
  { chave: 'pago_por', titulo: 'Pago por', padrao: true, render: (r) => r.pago_por },
  { chave: 'descricao', titulo: 'Descricao', padrao: false, render: (r) => r.descricao || '-', truncar: true },
  { chave: 'litragem', titulo: 'Litros', padrao: false, render: (r) => (r.litragem ? `${Number(r.litragem).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} L` : '-') },
  { chave: 'preco_litro', titulo: 'R$/Litro', padrao: false, render: (r) => (r.preco_litro !== null ? formatarMoeda(r.preco_litro) : '-') },
  { chave: 'km_abastecimento', titulo: 'KM', padrao: false, render: (r) => (r.km_abastecimento !== null ? r.km_abastecimento.toLocaleString('pt-BR') : '-') },
  { chave: 'tanque_completo', titulo: 'Tanque', padrao: false, render: (r) => (r.tanque_completo ? 'Cheio' : '-') },
  { chave: 'data_vencimento', titulo: 'Vencimento', padrao: false, render: (r) => (r.data_vencimento ? formatarDataBr(r.data_vencimento) : '-') },
  { chave: 'status_pagamento', titulo: 'Status pagamento', padrao: false, render: (r) => r.status_pagamento || '-' },
];
const COLUNA_VALOR = { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor), exportar: (r) => r.valor / 100 };

const OPCOES_AGRUPAR = [
  { value: '', label: 'Nenhum' },
  { value: 'categoria_nome', label: 'Categoria' },
  { value: 'veiculo_placa', label: 'Veiculo' },
  { value: 'motorista_nome', label: 'Motorista' },
  { value: 'pago_por', label: 'Pago por' },
];

function lerColunasSalvas() {
  try {
    const bruto = localStorage.getItem(CHAVE_COLUNAS);
    const salvas = bruto ? JSON.parse(bruto) : null;
    if (!Array.isArray(salvas)) return null;
    // So aceita chaves que ainda existem no catalogo (protege contra o
    // catalogo mudar entre versoes e o usuario ficar com uma escolha velha
    // "invisivel", sem nenhuma coluna valida sobrando).
    const filtradas = salvas.filter((c) => CATALOGO_COLUNAS.some((cat) => cat.chave === c));
    return filtradas.length ? filtradas : null;
  } catch {
    return null;
  }
}

function salvarColunas(chaves) {
  try { localStorage.setItem(CHAVE_COLUNAS, JSON.stringify(chaves)); } catch { /* localStorage indisponivel - so perde a conveniencia */ }
}

async function buscarCategorias() {
  return get('/categorias-despesa');
}
async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}
async function buscarFornecedores(termo) {
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
  const colunasSalvas = lerColunasSalvas();
  const categorias = await buscarCategorias();

  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Relatorio de Despesas</h1>
    <p class="mb-4 text-sm text-slate-500">Filtre e escolha as colunas que quer ver - suas colunas ficam salvas neste navegador.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div>
        <label class="label">Categoria</label>
        <select class="input" data-filtro-categoria>
          <option value="">Todas</option>
          ${categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('')}
        </select>
      </div>
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Motorista</label><div data-filtro-motorista></div></div>
      <div><label class="label">Viagem</label><div data-filtro-viagem></div></div>
      <div>
        <label class="label">Pago por</label>
        <select class="input" data-filtro-pago-por>
          <option value="">Todos</option>
          <option value="Empresa">Empresa</option>
          <option value="Motorista">Motorista</option>
          <option value="AdminOutros">Admin/Outros</option>
        </select>
      </div>
      <div><label class="label">Fornecedor</label><div data-filtro-fornecedor></div></div>
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
                <input type="checkbox" class="h-4 w-4" data-coluna="${c.chave}" ${(colunasSalvas ? colunasSalvas.includes(c.chave) : c.padrao) ? 'checked' : ''} />
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
    <div class="mb-3 flex justify-end"><button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button></div>
    <div data-tabela></div>
  `;

  const selectCategoria = container.querySelector('[data-filtro-categoria]');
  const selectPagoPor = container.querySelector('[data-filtro-pago-por]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const selectAgrupar = container.querySelector('[data-agrupar]');
  const resumoEl = container.querySelector('[data-resumo]');
  const resumoGrupoEl = container.querySelector('[data-resumo-grupo]');
  const tabelaContainer = container.querySelector('[data-tabela]');

  let veiculoId = null;
  let motoristaId = null;
  let viagemId = null;
  let fornecedorId = null;

  // Recarrega so a listagem (filtros mudaram) - nao precisa reconstruir a
  // tabela inteira, so o conjunto de colunas exibidas exige isso.
  let tabela = null;
  function recarregarDados() { if (tabela) tabela.recarregar(); }

  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: (id) => { veiculoId = id; recarregarDados(); } });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);
  const motoristaSelect = criarSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', onChange: (id) => { motoristaId = id; recarregarDados(); } });
  container.querySelector('[data-filtro-motorista]').appendChild(motoristaSelect.el);
  const viagemSelect = criarSearchableSelect({ buscar: buscarViagens, placeholder: 'Pesquisar viagem...', onChange: (id) => { viagemId = id; recarregarDados(); } });
  container.querySelector('[data-filtro-viagem]').appendChild(viagemSelect.el);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar fornecedor...', onChange: (id) => { fornecedorId = id; recarregarDados(); } });
  container.querySelector('[data-filtro-fornecedor]').appendChild(fornecedorSelect.el);

  attachDataMask(inputDataDe);
  attachDataMask(inputDataAte);
  for (const el of [selectCategoria, selectPagoPor, inputDataDe, inputDataAte]) {
    el.addEventListener('change', () => recarregarDados());
  }
  selectAgrupar.addEventListener('change', () => recarregarDados());

  function colunasSelecionadas() {
    return CATALOGO_COLUNAS.filter((c) => container.querySelector(`[data-coluna="${c.chave}"]`).checked);
  }

  // Extraido de renderResumoGrupo pra ser reaproveitado tambem no "Exportar
  // PDF" (mesma agregacao, so troca like onde o resultado e escrito).
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
                <td class="table-td">${chave}</td>
                <td class="table-td text-right">${g.qtd}</td>
                <td class="table-td text-right font-medium">${formatarMoeda(g.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // A tabela e reconstruida do zero sempre que o conjunto de colunas muda -
  // criarDataTable monta o cabecalho uma vez so na criacao, nao e reativo a
  // colunas trocando depois.
  function montarTabela() {
    const colunasEscolhidas = colunasSelecionadas();
    salvarColunas(colunasEscolhidas.map((c) => c.chave));
    tabelaContainer.innerHTML = '';
    tabela = criarDataTable({
      colunas: [...colunasEscolhidas, COLUNA_VALOR],
      ordenacaoInicial: { chave: 'data', direcao: 'desc' },
      exportar: { nomeArquivo: 'relatorio-despesas' },
      buscarDados: async (termo) => {
        const params = new URLSearchParams();
        if (selectCategoria.value) params.set('categoria_id', selectCategoria.value);
        if (veiculoId) params.set('veiculo_id', veiculoId);
        if (motoristaId) params.set('motorista_id', motoristaId);
        if (viagemId) params.set('viagem_id', viagemId);
        if (selectPagoPor.value) params.set('pago_por', selectPagoPor.value);
        if (fornecedorId) params.set('posto_fornecedor_id', fornecedorId);
        if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
        if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
        const query = params.toString();
        const todos = await get(`/relatorios/despesas${query ? `?${query}` : ''}`);
        const termoLower = (termo || '').toLowerCase();
        const dados = termoLower
          ? todos.filter((r) => [r.categoria_nome, r.veiculo_placa, r.motorista_nome, r.fornecedor_nome, r.descricao]
              .some((v) => (v || '').toLowerCase().includes(termoLower)))
          : todos;
        const total = dados.reduce((t, r) => t + r.valor, 0);
        resumoEl.innerHTML = `
          <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Total no filtro</p><p class="mt-1 text-2xl font-bold text-red-500">${formatarMoeda(total)}</p></div>
          <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Lancamentos</p><p class="mt-1 text-2xl font-bold text-slate-900">${dados.length}</p></div>
        `;
        renderResumoGrupo(dados);
        return dados;
      },
      vazio: 'Nenhuma despesa encontrada com estes filtros.',
    });
    tabelaContainer.appendChild(tabela.el);
  }

  container.querySelectorAll('[data-coluna]').forEach((chk) => chk.addEventListener('change', montarTabela));
  montarTabela();

  function filtrosAtivos() {
    const filtros = [];
    if (selectCategoria.value) filtros.push(`Categoria: ${selectCategoria.options[selectCategoria.selectedIndex].text}`);
    if (veiculoSelect.getValue()) filtros.push(`Veiculo: ${veiculoSelect.getLabel()}`);
    if (motoristaSelect.getValue()) filtros.push(`Motorista: ${motoristaSelect.getLabel()}`);
    if (viagemSelect.getValue()) filtros.push(`Viagem: ${viagemSelect.getLabel()}`);
    if (selectPagoPor.value) filtros.push(`Pago por: ${selectPagoPor.value}`);
    if (fornecedorSelect.getValue()) filtros.push(`Fornecedor: ${fornecedorSelect.getLabel()}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    return filtros;
  }

  // As colunas do PDF sao exatamente as marcadas em "Colunas visiveis" (+
  // Valor, sempre fixo) - os render() do catalogo ja devolvem texto puro
  // (sem HTML), entao servem direto tambem pra impressao, sem duplicar a
  // formatacao de cada campo numa segunda funcao.
  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const colunasEscolhidas = [...colunasSelecionadas(), COLUNA_VALOR];
    const total = dados.reduce((t, r) => t + r.valor, 0);
    const grupo = calcularGrupo(dados);
    abrirRelatorioImpressao({
      titulo: 'Relatorio de Despesas',
      filtros: filtrosAtivos(),
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
      tituloVazio: 'Nenhuma despesa encontrada com estes filtros.',
    });
  });
}
