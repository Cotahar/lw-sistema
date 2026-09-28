import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { formatarDataHoraBr, attachDataMask, parseDataBrParaIso } from '../../masks.js';

const OPCOES_AGRUPAR = [
  { value: '', label: 'Nenhum' },
  { value: 'usuario_nome', label: 'Usuario' },
  { value: 'tabela_afetada', label: 'Tabela' },
  { value: 'acao', label: 'Acao' },
];

async function buscarUsuarios(termo) {
  const usuarios = await get('/usuarios');
  const termoLower = (termo || '').toLowerCase();
  const filtrados = termo ? usuarios.filter((u) => u.nome.toLowerCase().includes(termoLower)) : usuarios;
  return filtrados.map((u) => ({ value: u.id, label: u.nome }));
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Atividade por Usuario</h1>
    <p class="mb-4 text-sm text-slate-500">Quem do escritorio lancou o que, e quando (restrito a Admin).</p>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Usuario</label><div data-filtro-usuario></div></div>
      <div><label class="label">Tabela</label><input type="text" class="input" data-filtro-tabela placeholder="ex.: viagens, despesas_viagem" /></div>
      <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div class="mb-3 flex items-end justify-between gap-3">
      <div class="w-48">
        <label class="label">Agrupar por</label>
        <select class="input" data-agrupar>${OPCOES_AGRUPAR.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
      </div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div class="mb-4" data-resumo-grupo></div>
    <div data-tabela></div>
  `;

  let usuarioId = null;
  const usuarioSelect = criarSearchableSelect({ buscar: buscarUsuarios, placeholder: 'Pesquisar usuario...', onChange: (id) => { usuarioId = id; tabela.recarregar(); } });
  container.querySelector('[data-filtro-usuario]').appendChild(usuarioSelect.el);

  const inputTabela = container.querySelector('[data-filtro-tabela]');
  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const selectAgrupar = container.querySelector('[data-agrupar]');
  const resumoGrupoEl = container.querySelector('[data-resumo-grupo]');
  inputTabela.addEventListener('input', () => { clearTimeout(debounceId); debounceId = setTimeout(() => tabela.recarregar(), 300); });
  let debounceId = null;
  for (const input of [inputDataDe, inputDataAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }
  selectAgrupar.addEventListener('change', () => tabela.recarregar());

  function calcularGrupo(dados) {
    const agruparPor = selectAgrupar.value;
    if (!agruparPor) return null;
    const grupos = new Map();
    for (const r of dados) {
      const chave = r[agruparPor] || '-';
      grupos.set(chave, (grupos.get(chave) || 0) + 1);
    }
    const linhas = [...grupos.entries()].sort((a, b) => b[1] - a[1]);
    const label = OPCOES_AGRUPAR.find((o) => o.value === agruparPor)?.label || agruparPor;
    return { label, linhas };
  }

  function renderResumoGrupo(dados) {
    const grupo = calcularGrupo(dados);
    if (!grupo) { resumoGrupoEl.innerHTML = ''; return; }
    resumoGrupoEl.innerHTML = `
      <div class="card overflow-x-auto border-gray-300 p-0">
        <div class="px-4 pt-3"><h2 class="font-semibold text-slate-900">Lancamentos por ${grupo.label}</h2></div>
        <table class="mt-2 w-full min-w-max border-collapse">
          <thead class="bg-brand-black"><tr><th class="table-th">${grupo.label}</th><th class="table-th text-right">Qtd</th></tr></thead>
          <tbody>
            ${grupo.linhas.map(([chave, qtd]) => `
              <tr class="border-b border-slate-100 last:border-0"><td class="table-td">${chave}</td><td class="table-td text-right font-medium">${qtd}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'criado_em', titulo: 'Data', render: (r) => formatarDataHoraBr(r.criado_em) },
      { chave: 'usuario_nome', titulo: 'Usuario', render: (r) => r.usuario_nome || '-' },
      { chave: 'tabela_afetada', titulo: 'Tabela', render: (r) => r.tabela_afetada },
      { chave: 'registro_id', titulo: 'Registro', render: (r) => `#${r.registro_id}` },
      { chave: 'acao', titulo: 'Acao', render: (r) => r.acao },
    ],
    ordenacaoInicial: { chave: 'criado_em', direcao: 'desc' },
    exportar: { nomeArquivo: 'atividade-usuarios' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (usuarioId) params.set('usuario_id', usuarioId);
      if (inputTabela.value.trim()) params.set('tabela', inputTabela.value.trim());
      if (inputDataDe.value) params.set('data_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_ate', parseDataBrParaIso(inputDataAte.value));
      const query = params.toString();
      const todos = await get(`/relatorios/atividade-usuarios${query ? `?${query}` : ''}`);
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.usuario_nome, r.tabela_afetada, r.acao].some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      renderResumoGrupo(dados);
      return dados;
    },
    vazio: 'Nenhuma atividade encontrada com estes filtros.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const grupo = calcularGrupo(dados);
    const filtros = [];
    if (usuarioSelect.getValue()) filtros.push(`Usuario: ${usuarioSelect.getLabel()}`);
    if (inputTabela.value.trim()) filtros.push(`Tabela: ${inputTabela.value.trim()}`);
    if (inputDataDe.value) filtros.push(`Data de: ${inputDataDe.value}`);
    if (inputDataAte.value) filtros.push(`Data ate: ${inputDataAte.value}`);
    abrirRelatorioImpressao({
      titulo: 'Atividade por Usuario',
      filtros,
      resumo: [{ label: 'Lancamentos', valor: String(dados.length) }],
      colunas: ['Data', 'Usuario', 'Tabela', 'Registro', 'Acao'],
      linhas: dados.map((r) => [formatarDataHoraBr(r.criado_em), r.usuario_nome || '-', r.tabela_afetada, `#${r.registro_id}`, r.acao]),
      grupo: grupo ? {
        titulo: `Lancamentos por ${grupo.label}`,
        colunas: [grupo.label, { titulo: 'Qtd', alinhar: 'right' }],
        linhas: grupo.linhas.map(([chave, qtd]) => [chave, String(qtd)]),
      } : null,
      tituloVazio: 'Nenhuma atividade encontrada com estes filtros.',
    });
  });
}
