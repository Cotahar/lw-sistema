import { get } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarMultiSearchableSelect } from '../../components/multiSearchableSelect.js';
import { abrirRelatorioImpressao } from '../../components/relatorioImpressao.js';
import { criarRelatoriosSalvos } from '../../components/relatoriosSalvos.js';
import { formatarMoeda, formatarDataBr, hojeIsoLocal, attachDataMask, parseDataBrParaIso } from '../../masks.js';

// Mesmo criterio de "vencido" usado em financeiro/contasReceber.js
// (badgePrazo) - duplicado aqui de proposito (poucas linhas, evita acoplar
// as duas telas por import): nao existe status 'Atrasado' de verdade
// gravado no banco, e sempre a comparacao data_prevista x hoje.
function badgePrazo(r) {
  if (r.status === 'Recebido') return '';
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00Z`);
  const previsto = new Date(`${r.data_prevista}T00:00:00Z`);
  const dias = Math.round((previsto - hoje) / 86400000);
  const cor = dias < 0 ? 'badge-critico' : dias <= 5 ? 'badge-atencao' : 'badge-neutro';
  const texto = dias < 0 ? `${Math.abs(dias)} dia(s) vencido` : dias === 0 ? 'vence hoje' : `${dias} dia(s)`;
  return `<span class="${cor} ml-1">${texto}</span>`;
}

function celulaUltimaBaixa(r) {
  if (!r.ultima_baixa) return '<span class="text-slate-400">Nenhuma baixa</span>';
  return `${formatarDataBr(r.ultima_baixa.data)} <span class="text-slate-400">(${r.ultima_baixa.tipo})</span>`;
}

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}
// Sem endpoint de busca por texto em /viagens - filtra no cliente por id ou
// placa da tratora, mesmo padrao ja usado em buscarConjuntos (pages/viagens.js).
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
    <h1 class="mb-1 text-xl font-bold text-slate-900">Saldos em Aberto</h1>
    <p class="mb-4 text-sm text-slate-500">Fretes com saldo pendente de recebimento das transportadoras.</p>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3" data-resumo></div>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
      <div><label class="label">Motorista</label><div data-filtro-motorista></div></div>
      <div><label class="label">Viagem</label><div data-filtro-viagem></div></div>
      <div><label class="label">Carregamento de</label><input type="text" class="input" data-filtro-carreg-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Carregamento ate</label><input type="text" class="input" data-filtro-carreg-ate placeholder="dd/mm/aaaa" /></div>
      <div class="flex items-center gap-2 pt-6">
        <input type="checkbox" id="filtro-vencidos" class="h-4 w-4" data-filtro-vencidos />
        <label for="filtro-vencidos" class="text-sm text-slate-700">Somente vencidos</label>
      </div>
    </div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div data-relatorios-salvos></div>
      <button type="button" class="btn-secondary btn-sm" data-exportar-pdf>Exportar PDF</button>
    </div>
    <div data-tabela></div>
  `;
  const resumoEl = container.querySelector('[data-resumo]');

  const veiculoSelect = criarMultiSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...', onChange: () => tabela.recarregar() });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);
  const motoristaSelect = criarMultiSearchableSelect({ buscar: buscarMotoristas, placeholder: 'Pesquisar motorista...', onChange: () => tabela.recarregar() });
  container.querySelector('[data-filtro-motorista]').appendChild(motoristaSelect.el);
  const viagemSelect = criarMultiSearchableSelect({ buscar: buscarViagens, placeholder: 'Pesquisar viagem...', onChange: () => tabela.recarregar() });
  container.querySelector('[data-filtro-viagem]').appendChild(viagemSelect.el);

  const inputCarregDe = container.querySelector('[data-filtro-carreg-de]');
  const inputCarregAte = container.querySelector('[data-filtro-carreg-ate]');
  const checkVencidos = container.querySelector('[data-filtro-vencidos]');
  for (const input of [inputCarregDe, inputCarregAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }
  checkVencidos.addEventListener('change', () => tabela.recarregar());

  const tabela = criarDataTable({
    colunas: [
      { chave: 'frete_id', titulo: 'Frete', render: (r) => `<a href="#/viagens/${r.viagem_id}" class="text-gray-900 hover:underline">#${r.frete_id} (viagem #${r.viagem_id})</a>`, exportar: (r) => `#${r.frete_id} (viagem #${r.viagem_id})` },
      { chave: 'conjunto', titulo: 'Conjunto', render: (r) => r.conjunto || '-' },
      { chave: 'motorista_nome', titulo: 'Motorista', render: (r) => r.motorista_nome || '-' },
      { chave: 'data_carregamento', titulo: 'Carregamento', render: (r) => (r.data_carregamento ? formatarDataBr(r.data_carregamento) : '-') },
      { chave: 'rota', titulo: 'Origem/Destino', render: (r) => `${r.origem_cidade}/${r.origem_uf} &rarr; ${r.destino_cidade}/${r.destino_uf}`, exportar: (r) => `${r.origem_cidade}/${r.origem_uf} -> ${r.destino_cidade}/${r.destino_uf}` },
      { chave: 'transportadora_nome', titulo: 'Transportadora', render: (r) => r.transportadora_nome || '-' },
      { chave: 'data_descarga', titulo: 'Entrega', render: (r) => (r.data_descarga ? formatarDataBr(r.data_descarga) : '-') },
      { chave: 'ultima_baixa', titulo: 'Ultima baixa', render: celulaUltimaBaixa, exportar: (r) => (r.ultima_baixa ? `${formatarDataBr(r.ultima_baixa.data)} (${r.ultima_baixa.tipo})` : '-') },
      { chave: 'data_prevista', titulo: 'Vencimento', render: (r) => `${formatarDataBr(r.data_prevista)}${badgePrazo(r)}`, exportar: (r) => formatarDataBr(r.data_prevista) },
      { chave: 'saldo_pendente', titulo: 'Valor Pendente', render: (r) => `<span class="font-semibold text-amber-500">${formatarMoeda(r.saldo_pendente)}</span>`, exportar: (r) => r.saldo_pendente / 100 },
    ],
    ordenacaoInicial: { chave: 'data_prevista', direcao: 'asc' },
    corLinha: (r) => (new Date(`${r.data_prevista}T00:00:00Z`) < new Date(`${hojeIsoLocal()}T00:00:00Z`) ? 'bg-red-950/40' : ''),
    exportar: { nomeArquivo: 'saldos-em-aberto' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      for (const id of veiculoSelect.getValues()) params.append('veiculo_id', id);
      for (const id of motoristaSelect.getValues()) params.append('motorista_id', id);
      for (const id of viagemSelect.getValues()) params.append('viagem_id', id);
      if (inputCarregDe.value) params.set('data_carregamento_de', parseDataBrParaIso(inputCarregDe.value));
      if (inputCarregAte.value) params.set('data_carregamento_ate', parseDataBrParaIso(inputCarregAte.value));
      if (checkVencidos.checked) params.set('somente_vencidos', '1');
      const query = params.toString();
      const todos = await get(`/relatorios/saldos-em-aberto${query ? `?${query}` : ''}`);
      // A caixa "Pesquisar..." da tabela generica so filtra o que ja veio do
      // servidor (os filtros estruturados acima e que restringem a consulta)
      // - cobre conjunto/motorista/rota/transportadora, os campos textuais
      // mais faceis de digitar de cabeca.
      const termoLower = (termo || '').toLowerCase();
      const dados = termoLower
        ? todos.filter((r) => [r.conjunto, r.motorista_nome, r.transportadora_nome, r.origem_cidade, r.destino_cidade]
            .some((v) => (v || '').toLowerCase().includes(termoLower)))
        : todos;
      const saldoTotal = dados.reduce((t, r) => t + r.saldo_pendente, 0);
      const vencidos = dados.filter((r) => new Date(`${r.data_prevista}T00:00:00Z`) < new Date(`${hojeIsoLocal()}T00:00:00Z`)).length;
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Saldo pendente total</p><p class="mt-1 text-2xl font-bold text-amber-400">${formatarMoeda(saldoTotal)}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Fretes com saldo pendente</p><p class="mt-1 text-2xl font-bold text-slate-900">${dados.length}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Fretes vencidos</p><p class="mt-1 text-2xl font-bold ${vencidos ? 'text-red-600' : 'text-slate-900'}">${vencidos}</p></div>
      `;
      return dados;
    },
    vazio: 'Nenhum saldo pendente encontrado.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  const relatoriosSalvos = criarRelatoriosSalvos({
    rota: '/relatorios/saldos-em-aberto',
    obterFiltros: () => ({
      veiculoIds: veiculoSelect.getValues(), veiculoLabels: veiculoSelect.getLabels(),
      motoristaIds: motoristaSelect.getValues(), motoristaLabels: motoristaSelect.getLabels(),
      viagemIds: viagemSelect.getValues(), viagemLabels: viagemSelect.getLabels(),
      carregDe: inputCarregDe.value, carregAte: inputCarregAte.value, vencidos: checkVencidos.checked,
    }),
    aplicarFiltros: (f) => {
      veiculoSelect.setValues(f.veiculoIds || [], f.veiculoLabels || []);
      motoristaSelect.setValues(f.motoristaIds || [], f.motoristaLabels || []);
      viagemSelect.setValues(f.viagemIds || [], f.viagemLabels || []);
      inputCarregDe.value = f.carregDe || '';
      inputCarregAte.value = f.carregAte || '';
      checkVencidos.checked = Boolean(f.vencidos);
      tabela.recarregar();
    },
  });
  container.querySelector('[data-relatorios-salvos]').appendChild(relatoriosSalvos.el);

  function filtrosAtivos() {
    const filtros = [];
    if (veiculoSelect.getValues().length) filtros.push(`Veiculo: ${veiculoSelect.getLabels().join(', ')}`);
    if (motoristaSelect.getValues().length) filtros.push(`Motorista: ${motoristaSelect.getLabels().join(', ')}`);
    if (viagemSelect.getValues().length) filtros.push(`Viagem: ${viagemSelect.getLabels().join(', ')}`);
    if (inputCarregDe.value) filtros.push(`Carregamento de: ${inputCarregDe.value}`);
    if (inputCarregAte.value) filtros.push(`Carregamento ate: ${inputCarregAte.value}`);
    if (checkVencidos.checked) filtros.push('Somente vencidos');
    return filtros;
  }

  // Exporta exatamente o que esta na tela agora (mesmos filtros/ordenacao
  // ja aplicados pela tabela) - tabela.dados() devolve o array atual, sem
  // precisar refazer a chamada a API.
  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const dados = tabela.dados();
    const saldoTotal = dados.reduce((t, r) => t + r.saldo_pendente, 0);
    const vencidos = dados.filter((r) => new Date(`${r.data_prevista}T00:00:00Z`) < new Date(`${hojeIsoLocal()}T00:00:00Z`)).length;
    abrirRelatorioImpressao({
      titulo: 'Saldos em Aberto',
      filtros: filtrosAtivos(),
      resumo: [
        { label: 'Saldo pendente total', valor: formatarMoeda(saldoTotal), cor: 'amber' },
        { label: 'Fretes com saldo pendente', valor: String(dados.length) },
        { label: 'Fretes vencidos', valor: String(vencidos), cor: vencidos ? 'red' : 'zinc' },
      ],
      colunas: [
        'Frete', 'Conjunto', 'Motorista', 'Carregamento', 'Origem/Destino', 'Transportadora',
        'Entrega', 'Ultima baixa', 'Vencimento', { titulo: 'Valor Pendente', alinhar: 'right' },
      ],
      linhas: dados.map((r) => [
        `#${r.frete_id} (viagem #${r.viagem_id})`,
        r.conjunto || '-',
        r.motorista_nome || '-',
        r.data_carregamento ? formatarDataBr(r.data_carregamento) : '-',
        `${r.origem_cidade}/${r.origem_uf} -> ${r.destino_cidade}/${r.destino_uf}`,
        r.transportadora_nome || '-',
        r.data_descarga ? formatarDataBr(r.data_descarga) : '-',
        r.ultima_baixa ? `${formatarDataBr(r.ultima_baixa.data)} (${r.ultima_baixa.tipo})` : '-',
        formatarDataBr(r.data_prevista),
        formatarMoeda(r.saldo_pendente),
      ]),
      tituloVazio: 'Nenhum saldo pendente encontrado.',
    });
  });
}
