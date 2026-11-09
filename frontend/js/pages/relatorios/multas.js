import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarMultiSearchableSelect } from '../../components/multiSearchableSelect.js';
import { buscarConjuntos } from '../../components/conjuntoOpcoes.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { periodoAnteriorEquivalente, renderComparativoPeriodo } from '../../components/comparativoPeriodo.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';
import { esc } from '../../html.js';

const STATUS_LABEL = {
  AguardandoIndicacao: 'Aguardando indicacao', CondutorIndicado: 'Condutor indicado', NaoIndicado: 'Nao indicado (dobrou)',
  Paga: 'Paga', Recorrida: 'Recorrida', Cancelada: 'Cancelada',
};
const STATUS_BADGE = {
  AguardandoIndicacao: 'badge-atencao', CondutorIndicado: 'badge-neutro', NaoIndicado: 'badge-critico',
  Paga: 'badge-sucesso', Recorrida: 'badge-neutro', Cancelada: 'badge-neutro',
};
const TIPOS_DATA = [
  { value: 'infracao', label: 'Data da infracao' },
  { value: 'notificacao', label: 'Data da notificacao' },
  { value: 'prazo', label: 'Prazo de indicacao' },
];

const dataOuTraco = (iso) => (iso ? formatarDataBr(iso) : '-');
const mesDe = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '-');

function celulaMotorista(r) {
  if (!r.motorista_nome) return '<span class="text-slate-400">-</span>';
  if (r.condutor_origem === 'DadosAntigos') {
    return `<span class="font-semibold text-warning" title="${esc(r.condutor_fonte || '')}">${esc(r.motorista_nome)}</span> <span class="badge-atencao ml-1" title="${esc(r.condutor_fonte || '')}">dados antigos</span>`;
  }
  return esc(r.motorista_nome);
}

function celulaPrazo(r) {
  if (!r.prazo_indicacao) return '-';
  let badge = '';
  if (r.dias_restantes !== null && r.dias_restantes !== undefined) {
    const d = r.dias_restantes;
    const cor = d <= 5 ? 'badge-critico' : d <= 15 ? 'badge-atencao' : 'badge-neutro';
    badge = ` <span class="${cor} ml-1">${d < 0 ? `${Math.abs(d)} dia(s) vencido` : d === 0 ? 'vence hoje' : `${d} dia(s)`}</span>`;
  }
  return `${formatarDataBr(r.prazo_indicacao)}${badge}`;
}

// Colunas disponiveis. `padrao` = ja vem marcada; `texto` = valor puro (PDF e XLSX); o Valor vem sempre no fim.
const CATALOGO_COLUNAS = [
  { chave: 'data_infracao', titulo: 'Data infracao', padrao: true, render: (r) => dataOuTraco(r.data_infracao), texto: (r) => dataOuTraco(r.data_infracao) },
  { chave: 'veiculo_placa', titulo: 'Veiculo', padrao: true, render: (r) => esc(r.veiculo_placa), texto: (r) => r.veiculo_placa },
  { chave: 'conjunto', titulo: 'Conjunto', padrao: true, render: (r) => esc(r.conjunto || '-'), texto: (r) => r.conjunto || '-' },
  { chave: 'motorista_nome', titulo: 'Motorista', padrao: true, render: celulaMotorista,
    texto: (r) => (r.motorista_nome ? `${r.motorista_nome}${r.condutor_origem === 'DadosAntigos' ? ' (dados antigos)' : ''}` : '-') },
  { chave: 'descricao', titulo: 'Descricao', padrao: true, render: (r) => esc(r.descricao), texto: (r) => r.descricao, truncar: true },
  { chave: 'orgao_autuador', titulo: 'Orgao', padrao: true, render: (r) => esc(r.orgao_autuador || '-'), texto: (r) => r.orgao_autuador || '-' },
  { chave: 'prazo_indicacao', titulo: 'Prazo indicacao', padrao: true, render: celulaPrazo, texto: (r) => dataOuTraco(r.prazo_indicacao) },
  { chave: 'status', titulo: 'Status', padrao: true, render: (r) => `<span class="${STATUS_BADGE[r.status] || 'badge-neutro'}">${esc(STATUS_LABEL[r.status] || r.status)}</span>`, texto: (r) => STATUS_LABEL[r.status] || r.status },
  { chave: 'numero_ait', titulo: 'AIT', padrao: false, render: (r) => esc(r.numero_ait || '-'), texto: (r) => r.numero_ait || '-' },
  { chave: 'codigo_infracao', titulo: 'Cod. infracao', padrao: false, render: (r) => esc(r.codigo_infracao || '-'), texto: (r) => r.codigo_infracao || '-' },
  { chave: 'renainf', titulo: 'RENAINF', padrao: false, render: (r) => esc(r.renainf || '-'), texto: (r) => r.renainf || '-' },
  { chave: 'local_infracao', titulo: 'Local', padrao: false, render: (r) => esc(r.local_infracao || '-'), texto: (r) => r.local_infracao || '-', truncar: true },
  { chave: 'data_notificacao', titulo: 'Data notificacao', padrao: false, render: (r) => dataOuTraco(r.data_notificacao), texto: (r) => dataOuTraco(r.data_notificacao) },
  { chave: 'qtd_anexos', titulo: 'Anexos', padrao: false, render: (r) => String(r.qtd_anexos || 0), texto: (r) => String(r.qtd_anexos || 0) },
];
const COLUNA_VALOR = { chave: 'valor_efetivo', titulo: 'Valor', render: (r) => formatarMoeda(r.valor_efetivo), texto: (r) => formatarMoeda(r.valor_efetivo), exportar: (r) => r.valor_efetivo / 100 };

const OPCOES_AGRUPAR = [
  { value: '', label: 'Nenhum' },
  { value: 'motorista_nome', label: 'Motorista' },
  { value: 'veiculo_placa', label: 'Veiculo' },
  { value: 'conjunto', label: 'Conjunto' },
  { value: 'status', label: 'Status' },
  { value: 'orgao_autuador', label: 'Orgao' },
  { value: 'mes', label: 'Mes da infracao' },
];

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}
async function buscarStatus(termo) {
  const t = (termo || '').toLowerCase();
  return Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })).filter((o) => !t || o.label.toLowerCase().includes(t));
}

function valorDoGrupo(r, agruparPor) {
  if (agruparPor === 'mes') return mesDe(r.data_infracao || r.data_notificacao);
  if (agruparPor === 'status') return STATUS_LABEL[r.status] || r.status;
  return r[agruparPor] || '-';
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Multas por Motorista/Veiculo</h1>
    <p class="mb-4 text-sm text-slate-500">Quem esta acumulando multas, quanto isso custou e o que esta com prazo de indicacao vencido ou sem motorista.</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Conjunto</label><div data-filtro-conjunto></div></div>
      <div><label class="label">Motorista</label><div data-filtro-motorista></div></div>
      <div><label class="label">Status</label><div data-filtro-status></div></div>
      <div>
        <label class="label">Periodo por</label>
        <select class="input" data-filtro-tipo-data>${TIPOS_DATA.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}</select>
      </div>
      <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
      <div class="flex flex-col justify-end gap-1.5 text-sm text-slate-700">
        <label class="flex items-center gap-1.5"><input type="checkbox" class="h-4 w-4" data-filtro-sem-motorista /> Somente sem motorista</label>
        <label class="flex items-center gap-1.5"><input type="checkbox" class="h-4 w-4" data-filtro-prazo-vencido /> Prazo de indicacao vencido</label>
        <label class="flex items-center gap-1.5"><input type="checkbox" class="h-4 w-4" data-filtro-dados-antigos /> Motorista por dados antigos</label>
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
      <div class="flex items-center gap-2">
        <input type="checkbox" id="comparar-periodo-multas" class="h-4 w-4" data-comparar-periodo />
        <label for="comparar-periodo-multas" class="text-sm text-slate-700">Comparar com periodo anterior</label>
      </div>
    </div>
    <div class="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4" data-resumo></div>
    <div data-comparativo-periodo></div>
    <div class="mb-4" data-resumo-grupo></div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;

  const selectTipoData = container.querySelector('[data-filtro-tipo-data]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const checkSemMotorista = container.querySelector('[data-filtro-sem-motorista]');
  const checkPrazoVencido = container.querySelector('[data-filtro-prazo-vencido]');
  const checkDadosAntigos = container.querySelector('[data-filtro-dados-antigos]');
  const selectAgrupar = container.querySelector('[data-agrupar]');
  const checkComparar = container.querySelector('[data-comparar-periodo]');
  const resumoEl = container.querySelector('[data-resumo]');
  const comparativoEl = container.querySelector('[data-comparativo-periodo]');
  const resumoGrupoEl = container.querySelector('[data-resumo-grupo]');
  const tabelaContainer = container.querySelector('[data-tabela]');

  let tabela = null;
  function recarregarDados() { if (tabela) tabela.recarregar(); }

  const veiculoSelect = criarMultiSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: () => recarregarDados() });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);
  const conjuntoSelect = criarMultiSearchableSelect({ buscar: buscarConjuntos, placeholder: 'Pesquisar conjunto...', onChange: () => recarregarDados() });
  container.querySelector('[data-filtro-conjunto]').appendChild(conjuntoSelect.el);
  const motoristaSelect = criarMultiSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', onChange: () => recarregarDados() });
  container.querySelector('[data-filtro-motorista]').appendChild(motoristaSelect.el);
  const statusSelect = criarMultiSearchableSelect({ buscar: buscarStatus, placeholder: 'Escolher status...', onChange: () => recarregarDados() });
  container.querySelector('[data-filtro-status]').appendChild(statusSelect.el);

  attachDataMask(inputDataDe);
  attachDataMask(inputDataAte);
  for (const el of [selectTipoData, inputDataDe, inputDataAte, checkSemMotorista, checkPrazoVencido, checkDadosAntigos, selectAgrupar, checkComparar]) {
    el.addEventListener('change', () => recarregarDados());
  }

  function montarParams(sobrepor = {}) {
    const params = new URLSearchParams();
    for (const id of veiculoSelect.getValues()) params.append('veiculo_id', id);
    for (const id of conjuntoSelect.getValues()) params.append('conjunto_id', id);
    for (const id of motoristaSelect.getValues()) params.append('motorista_id', id);
    for (const s of statusSelect.getValues()) params.append('status', s);
    params.set('tipo_data', selectTipoData.value);
    const de = sobrepor.de ?? (inputDataDe.value ? parseDataBrParaIso(inputDataDe.value) : '');
    const ate = sobrepor.ate ?? (inputDataAte.value ? parseDataBrParaIso(inputDataAte.value) : '');
    if (de) params.set('data_de', de);
    if (ate) params.set('data_ate', ate);
    if (checkSemMotorista.checked) params.set('sem_motorista', '1');
    if (checkPrazoVencido.checked) params.set('prazo_vencido', '1');
    if (checkDadosAntigos.checked) params.set('dados_antigos', '1');
    return params;
  }

  const somaValor = (dados) => dados.reduce((t, r) => t + r.valor_efetivo, 0);

  function renderResumo(dados) {
    const vencidas = dados.filter((r) => r.status === 'AguardandoIndicacao' && r.dias_restantes !== null && r.dias_restantes < 0);
    const semMotorista = dados.filter((r) => !r.motorista_id);
    resumoEl.innerHTML = `
      <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Total em multas</p><p class="mt-1 text-2xl font-bold text-danger">${formatarMoeda(somaValor(dados))}</p></div>
      <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Quantidade</p><p class="mt-1 text-2xl font-bold text-slate-900">${dados.length}</p></div>
      <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Prazo de indicacao vencido</p><p class="mt-1 text-2xl font-bold ${vencidas.length ? 'text-warning' : 'text-slate-900'}">${vencidas.length}</p><p class="text-xs text-slate-500">${formatarMoeda(somaValor(vencidas))}</p></div>
      <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Sem motorista</p><p class="mt-1 text-2xl font-bold ${semMotorista.length ? 'text-warning' : 'text-slate-900'}">${semMotorista.length}</p><p class="text-xs text-slate-500">${formatarMoeda(somaValor(semMotorista))}</p></div>
    `;
  }

  // Refaz a mesma consulta com o periodo anterior EQUIVALENTE (mesma duracao, imediatamente antes) e os demais filtros intactos.
  async function atualizarComparativo(dadosAtuais) {
    if (!checkComparar.checked) { comparativoEl.innerHTML = ''; return; }
    const de = inputDataDe.value ? parseDataBrParaIso(inputDataDe.value) : null;
    const ate = inputDataAte.value ? parseDataBrParaIso(inputDataAte.value) : null;
    const anterior = periodoAnteriorEquivalente(de, ate);
    if (!anterior) { comparativoEl.innerHTML = ''; return; }
    const dadosAnteriores = await get(`/relatorios/multas?${montarParams({ de: anterior.de, ate: anterior.ate }).toString()}`);
    renderComparativoPeriodo(comparativoEl, {
      periodoAnteriorTexto: `${formatarDataBr(anterior.de)} a ${formatarDataBr(anterior.ate)}`,
      indicadores: [
        { label: 'Total em multas', atual: somaValor(dadosAtuais), anterior: somaValor(dadosAnteriores), formatador: formatarMoeda, inverterCores: true },
        { label: 'Quantidade de multas', atual: dadosAtuais.length, anterior: dadosAnteriores.length, formatador: (v) => v.toLocaleString('pt-BR'), inverterCores: true },
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
      const chave = valorDoGrupo(r, agruparPor);
      if (!grupos.has(chave)) grupos.set(chave, { total: 0, qtd: 0 });
      const g = grupos.get(chave);
      g.total += r.valor_efetivo;
      g.qtd += 1;
    }
    const linhas = [...grupos.entries()].sort((a, b) => b[1].total - a[1].total);
    return { label: OPCOES_AGRUPAR.find((o) => o.value === agruparPor)?.label || agruparPor, linhas };
  }

  function renderResumoGrupo(dados) {
    const grupo = calcularGrupo(dados);
    if (!grupo) { resumoGrupoEl.innerHTML = ''; return; }
    resumoGrupoEl.innerHTML = `
      <div class="card overflow-x-auto border-gray-300 p-0">
        <div class="px-4 pt-3"><h2 class="font-semibold text-slate-900">Total por ${grupo.label}</h2></div>
        <table class="mt-2 w-full min-w-max border-collapse">
          <thead class="bg-elevated"><tr><th class="table-th">${grupo.label}</th><th class="table-th text-right">Qtd</th><th class="table-th text-right">Total</th></tr></thead>
          <tbody>
            ${grupo.linhas.map(([chave, g]) => `
              <tr class="border-b border-slate-100 last:border-0">
                <td class="table-td">${esc(chave)}</td><td class="table-td text-right">${g.qtd}</td><td class="table-td text-right font-medium">${formatarMoeda(g.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function descricaoFiltros() {
    const filtros = [];
    if (veiculoSelect.getValues().length) filtros.push(`Veiculo: ${veiculoSelect.getLabels().join(', ')}`);
    if (conjuntoSelect.getValues().length) filtros.push(`Conjunto: ${conjuntoSelect.getLabels().join(', ')}`);
    if (motoristaSelect.getValues().length) filtros.push(`Motorista: ${motoristaSelect.getLabels().join(', ')}`);
    if (statusSelect.getValues().length) filtros.push(`Status: ${statusSelect.getLabels().join(', ')}`);
    const tipo = TIPOS_DATA.find((t) => t.value === selectTipoData.value)?.label || '';
    if (inputDataDe.value) filtros.push(`${tipo} de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`${tipo} ate: ${inputDataAte.value}`);
    if (checkSemMotorista.checked) filtros.push('Somente sem motorista');
    if (checkPrazoVencido.checked) filtros.push('Prazo de indicacao vencido');
    if (checkDadosAntigos.checked) filtros.push('Motorista por dados antigos');
    return filtros;
  }

  function abrirPdf(dados, rotuloSelecao) {
    const colunasEscolhidas = [...colunasSelecionadas(), COLUNA_VALOR];
    const grupo = calcularGrupo(dados);
    const filtros = descricaoFiltros();
    if (rotuloSelecao) filtros.push(rotuloSelecao);
    abrirRelatorioImpressao({
      titulo: 'Multas por Motorista/Veiculo',
      filtros,
      resumo: [
        { label: 'Total em multas', valor: formatarMoeda(somaValor(dados)), cor: 'red' },
        { label: 'Quantidade', valor: String(dados.length) },
      ],
      colunas: colunasEscolhidas.map((c) => ({ titulo: c.titulo, alinhar: c.chave === 'valor_efetivo' ? 'right' : undefined })),
      linhas: dados.map((r) => colunasEscolhidas.map((c) => c.texto(r))),
      grupo: grupo ? {
        titulo: `Total por ${grupo.label}`,
        colunas: [grupo.label, { titulo: 'Qtd', alinhar: 'right' }, { titulo: 'Total', alinhar: 'right' }],
        linhas: grupo.linhas.map(([chave, g]) => [chave, String(g.qtd), formatarMoeda(g.total)]),
      } : null,
      tituloVazio: 'Nenhuma multa encontrada com estes filtros.',
    });
  }

  function montarTabela() {
    const colunas = [...colunasSelecionadas(), COLUNA_VALOR].map((c) => ({
      chave: c.chave, titulo: c.titulo, render: c.render, truncar: c.truncar,
      exportar: c.exportar || ((r) => c.texto(r)),
    }));
    tabelaContainer.innerHTML = '';
    tabela = criarDataTable({
      colunas,
      ordenacaoInicial: { chave: 'data_infracao', direcao: 'desc' },
      exportar: { nomeArquivo: 'multas' },
      // Selecao de linhas: soma dos valores marcados na barra flutuante + PDF so das marcadas.
      somaLote: (linhas) => formatarMoeda(somaValor(linhas)),
      acoesLote: [{ label: 'PDF das selecionadas', onClick: (linhas) => abrirPdf(linhas, `Somente ${linhas.length} multa(s) selecionada(s)`) }],
      corLinha: (r) => (r.status === 'AguardandoIndicacao' && r.dias_restantes !== null && r.dias_restantes < 0 ? 'linha-atencao' : ''),
      buscarDados: async (termo) => {
        const todos = await get(`/relatorios/multas?${montarParams().toString()}`);
        const termoLower = (termo || '').toLowerCase();
        const dados = termoLower
          ? todos.filter((r) => [r.veiculo_placa, r.conjunto, r.motorista_nome, r.descricao, r.orgao_autuador, r.numero_ait, r.codigo_infracao, r.renainf, r.local_infracao, STATUS_LABEL[r.status]]
            .some((v) => (v || '').toLowerCase().includes(termoLower)))
          : todos;
        renderResumo(dados);
        renderResumoGrupo(dados);
        atualizarComparativo(dados).catch(() => { comparativoEl.innerHTML = ''; });
        return dados;
      },
      vazio: 'Nenhuma multa encontrada com estes filtros.',
    });
    tabelaContainer.appendChild(tabela.el);
  }

  container.querySelectorAll('[data-coluna]').forEach((chk) => chk.addEventListener('change', montarTabela));
  montarTabela();

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/multas',
    obterFiltros: () => ({
      veiculoIds: veiculoSelect.getValues(), veiculoLabels: veiculoSelect.getLabels(),
      conjuntoIds: conjuntoSelect.getValues(), conjuntoLabels: conjuntoSelect.getLabels(),
      motoristaIds: motoristaSelect.getValues(), motoristaLabels: motoristaSelect.getLabels(),
      statusLista: statusSelect.getValues(), statusLabels: statusSelect.getLabels(),
      tipoData: selectTipoData.value, dataDe: inputDataDe.value, dataAte: inputDataAte.value,
      semMotorista: checkSemMotorista.checked, prazoVencido: checkPrazoVencido.checked, dadosAntigos: checkDadosAntigos.checked,
      agrupar: selectAgrupar.value, comparar: checkComparar.checked,
      colunas: colunasSelecionadas().map((c) => c.chave),
    }),
    aplicarFiltros: (f) => {
      veiculoSelect.setValues(f.veiculoIds || [], f.veiculoLabels || []);
      conjuntoSelect.setValues(f.conjuntoIds || [], f.conjuntoLabels || []);
      motoristaSelect.setValues(f.motoristaIds || [], f.motoristaLabels || []);
      // Relatorios salvos antes desta versao guardavam um unico `status`.
      const statusIds = f.statusLista || (f.status ? [f.status] : []);
      statusSelect.setValues(statusIds, f.statusLabels || statusIds.map((s) => STATUS_LABEL[s] || s));
      selectTipoData.value = f.tipoData || 'infracao';
      inputDataDe.value = f.dataDe || '';
      inputDataAte.value = f.dataAte || '';
      checkSemMotorista.checked = Boolean(f.semMotorista);
      checkPrazoVencido.checked = Boolean(f.prazoVencido);
      checkDadosAntigos.checked = Boolean(f.dadosAntigos);
      selectAgrupar.value = f.agrupar || '';
      checkComparar.checked = Boolean(f.comparar);
      if (Array.isArray(f.colunas)) {
        container.querySelectorAll('[data-coluna]').forEach((chk) => { chk.checked = f.colunas.includes(chk.dataset.coluna); });
      }
      montarTabela();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => abrirPdf(tabela.dados()));
}
