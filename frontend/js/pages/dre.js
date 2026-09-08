import { get } from '../api.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { mostrarErro } from '../components/toast.js';
import { formatarMoeda, formatarDataBr, attachDataMask, parseDataBrParaIso, hojeIsoLocal } from '../masks.js';

// Periodo padrao ao abrir a tela: mes corrente (dia 1 ate hoje) - antes
// abria sem filtro nenhum (todo o historico), forcando o usuario a
// preencher a data toda vez so pra ver o mes atual, o caso mais comum.
function primeiroDiaMesAtualIso() {
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00`);
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
}

function isoDe(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

// Atalhos de periodo (Bloco 4 do parecer de refatoracao): a app ja usa campo
// de texto com mascara propria (dd/mm/aaaa) em vez de <input type="date">
// nativo - trocar por uma lib externa (Flatpickr) seria regredir isso, entao
// os atalhos so preenchem os dois campos existentes, sem trocar o input.
function periodoAtalho(chave) {
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00`);
  if (chave === '7dias') {
    const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - 6);
    return [isoDe(inicio), isoDe(hoje)];
  }
  if (chave === '30dias') {
    const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - 29);
    return [isoDe(inicio), isoDe(hoje)];
  }
  if (chave === 'mesAtual') {
    return [primeiroDiaMesAtualIso(), isoDe(hoje)];
  }
  if (chave === 'mesPassado') {
    const primeiroMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoMesPassado = new Date(primeiroMesAtual); ultimoMesPassado.setDate(ultimoMesPassado.getDate() - 1);
    const primeiroMesPassado = new Date(ultimoMesPassado.getFullYear(), ultimoMesPassado.getMonth(), 1);
    return [isoDe(primeiroMesPassado), isoDe(ultimoMesPassado)];
  }
  return [null, null];
}

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

function cartao(titulo, valor, cor = 'text-slate-900') {
  return `<div class="card p-4"><p class="text-xs font-medium uppercase tracking-wide text-slate-500">${titulo}</p><p class="mt-1 text-2xl font-bold ${cor}">${valor}</p></div>`;
}

// Seta + cor de acordo com a variacao (%), positiva ou negativa - inverteVerdeRuim
// deixa "custo caiu" verde mesmo sendo uma queda numerica (o oposto de receita/lucro,
// onde subir e bom).
function deltaPercentual(atual, anterior, inverterCores = false) {
  if (!anterior) return '<span class="text-xs text-slate-400">sem periodo anterior</span>';
  const variacao = ((atual - anterior) / Math.abs(anterior)) * 100;
  const subiu = variacao >= 0;
  const bom = inverterCores ? !subiu : subiu;
  const cor = variacao === 0 ? 'text-slate-400' : bom ? 'text-emerald-600' : 'text-red-600';
  const seta = variacao === 0 ? '' : subiu ? '&uarr;' : '&darr;';
  return `<span class="text-xs font-medium ${cor}">${seta} ${Math.abs(variacao).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>`;
}

function linhaComparativo(label, atual, anterior, formatador, inverterCores = false) {
  return `
    <tr class="border-b border-slate-100 last:border-0">
      <td class="table-td">${label}</td>
      <td class="table-td text-right">${formatador(atual)}</td>
      <td class="table-td text-right text-slate-500">${formatador(anterior)}</td>
      <td class="table-td text-right">${deltaPercentual(atual, anterior, inverterCores)}</td>
    </tr>
  `;
}

async function renderComparativo(container, inicio, fim) {
  if (!inicio || !fim) { container.innerHTML = ''; return; }
  try {
    const qs = new URLSearchParams({ data_inicio: inicio, data_fim: fim });
    const comp = await get(`/dre/comparativo?${qs.toString()}`);
    container.innerHTML = `
      <div class="card mt-6 overflow-x-auto border-gray-300 p-0">
        <div class="flex items-center justify-between px-4 pt-3">
          <h2 class="font-semibold text-slate-900">Comparativo com o periodo anterior</h2>
          <p class="text-xs text-slate-400">${formatarDataBr(comp.anterior.periodo.inicio)} a ${formatarDataBr(comp.anterior.periodo.fim)}</p>
        </div>
        <table class="mt-2 w-full min-w-max border-collapse">
          <thead class="bg-brand-black"><tr>
            <th class="table-th">Indicador</th><th class="table-th text-right">Periodo atual</th><th class="table-th text-right">Periodo anterior</th><th class="table-th text-right">Variacao</th>
          </tr></thead>
          <tbody>
            ${linhaComparativo('Receita', comp.atual.dre.receitaTotal, comp.anterior.dre.receitaTotal, formatarMoeda)}
            ${linhaComparativo('Custo total', comp.atual.dre.custoTotal, comp.anterior.dre.custoTotal, formatarMoeda, true)}
            ${linhaComparativo('Lucro liquido', comp.atual.dre.lucroLiquido, comp.anterior.dre.lucroLiquido, formatarMoeda)}
            ${linhaComparativo('Acertos fechados', comp.atual.acertos.quantidade, comp.anterior.acertos.quantidade, (v) => v.toLocaleString('pt-BR'))}
            ${linhaComparativo('Saldo de acertos', comp.atual.acertos.somaSaldoFinal, comp.anterior.acertos.somaSaldoFinal, formatarMoeda)}
          </tbody>
        </table>
      </div>
    `;
  } catch {
    container.innerHTML = '';
  }
}

async function renderGeral(resultadoEl, inicio, fim) {
  const qs = new URLSearchParams();
  if (inicio) qs.set('data_inicio', inicio);
  if (fim) qs.set('data_fim', fim);
  const dre = await get(`/dre/geral?${qs.toString()}`);
  // No modo "Todas as empresas" o backend nao manda despesasBase no nivel
  // raiz (manda um por empresa em porEmpresa, ja que agregar o centro Base
  // de empresas diferentes num so numero seria enganoso) - sem este guard a
  // tela quebrava inteira (encontrado testando DRE sem nenhuma empresa
  // selecionada/cadastrada).
  const despesasBaseTotal = dre.despesasBase
    ? dre.despesasBase.total
    : (dre.porEmpresa || []).reduce((t, e) => t + e.despesasBase.total, 0);
  const semNenhumValor = dre.receitaTotal === 0 && dre.custoTotalVeiculos === 0 && despesasBaseTotal === 0 && dre.porVeiculo.length > 0;
  resultadoEl.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      ${cartao('Receita Total', formatarMoeda(dre.receitaTotal))}
      ${cartao('Custo Total (frota)', formatarMoeda(dre.custoTotalVeiculos))}
      ${cartao('Despesas Base/Admin', formatarMoeda(despesasBaseTotal))}
      ${cartao('Lucro Liquido', formatarMoeda(dre.lucroLiquido), dre.lucroLiquido >= 0 ? 'text-emerald-600' : 'text-red-600')}
    </div>
    ${semNenhumValor ? `
      <p class="mt-3 text-xs text-slate-400">Tudo zerado neste periodo (${formatarDataBr(inicio) || 'inicio'} a ${formatarDataBr(fim) || 'hoje'}), mas ha veiculos cadastrados. Se esperava ver valores, confira se o filtro de datas acima cobre a data das viagens/despesas lancadas.</p>
    ` : ''}
    <div class="card mt-6 overflow-x-auto border-gray-300 p-0">
      <table class="w-full min-w-max border-collapse">
        <thead class="bg-brand-black"><tr>
          <th class="table-th">Placa</th><th class="table-th text-right">Receita</th><th class="table-th text-right">Custo</th><th class="table-th text-right">Lucro</th>
        </tr></thead>
        <tbody>
          ${dre.porVeiculo.map((v) => `
            <tr class="border-b border-slate-100">
              <td class="table-td">${v.placa}</td>
              <td class="table-td text-right">${formatarMoeda(v.receita)}</td>
              <td class="table-td text-right">${formatarMoeda(v.custoTotal)}</td>
              <td class="table-td text-right ${v.lucro >= 0 ? 'text-emerald-600' : 'text-red-600'}">${formatarMoeda(v.lucro)}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" class="table-td py-6 text-center text-slate-400">Sem dados no periodo.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div data-comparativo></div>
  `;
  await renderComparativo(resultadoEl.querySelector('[data-comparativo]'), inicio, fim);
}

// Rotulo de cada categoria de custo (chave usada tanto no objeto dre.custos
// quanto na rota de drill-down GET /dre/veiculo/:id/detalhe/:categoria).
const CATEGORIAS_CUSTO = [
  { chave: 'viagem', titulo: 'Despesas de viagem' },
  { chave: 'pecasDireto', titulo: 'Pecas (estoque direto)' },
  { chave: 'ordensServico', titulo: 'Ordens de servico' },
  { chave: 'pneus', titulo: 'Pneus' },
  { chave: 'despesasFixas', titulo: 'Despesas fixas' },
  { chave: 'financiamento', titulo: 'Financiamento' },
];

function linhaDetalheDre(item) {
  const label = item.categoria_nome || item.item_nome || item.numero_fogo || item.descricao
    || (item.viagem_id ? `Viagem #${item.viagem_id}` : item.numero_parcela ? `Parcela ${item.numero_parcela}` : '-');
  return `<div class="flex justify-between border-b border-slate-100 py-1 last:border-0"><span class="text-slate-600">${formatarDataBr(item.data)} - ${label}</span><span class="font-medium text-slate-900">${formatarMoeda(item.valor || 0)}</span></div>`;
}

// Drill-down (sem grafico, so a lista): cada linha do detalhamento vira um
// <details> que busca os lancamentos individuais so quando aberto pela
// primeira vez (evita 6 chamadas de rede toda vez que a DRE carrega, quando
// a maioria das vezes o usuario nem confere o detalhe).
function montarLinhaExpansivel(categoria, titulo, valorTotal, veiculoId, inicio, fim) {
  const id = `dre-detalhe-${categoria}`;
  return `
    <details class="group border-b border-slate-100 last:border-0" data-detalhe="${categoria}">
      <summary class="flex cursor-pointer list-none items-center justify-between py-1.5 text-sm text-slate-600 hover:text-slate-900">
        <span class="flex items-center gap-1.5">
          <svg class="h-3 w-3 shrink-0 text-slate-400 transition-transform group-open:rotate-90" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          ${titulo}
        </span>
        <span>${formatarMoeda(valorTotal)}</span>
      </summary>
      <div id="${id}" class="mb-2 ml-4 rounded-lg bg-slate-50 px-3 py-2 text-xs">
        <p class="text-slate-400" data-carregando>Carregando...</p>
      </div>
    </details>
  `;
}

async function renderVeiculo(resultadoEl, veiculoId, inicio, fim) {
  const qs = new URLSearchParams();
  if (inicio) qs.set('data_inicio', inicio);
  if (fim) qs.set('data_fim', fim);
  const dre = await get(`/dre/veiculo/${veiculoId}?${qs.toString()}`);
  const semNenhumValor = dre.receita === 0 && dre.custos.total === 0;
  resultadoEl.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      ${cartao('Receita', formatarMoeda(dre.receita))}
      ${cartao('Custo Total', formatarMoeda(dre.custos.total))}
      ${cartao('Lucro', formatarMoeda(dre.lucro), dre.lucro >= 0 ? 'text-emerald-600' : 'text-red-600')}
    </div>
    ${semNenhumValor ? `
      <p class="mt-3 text-xs text-slate-400">Tudo zerado neste veiculo entre ${formatarDataBr(inicio) || 'o inicio'} e ${formatarDataBr(fim) || 'hoje'}. Se esperava ver valores, confira se o periodo filtrado acima cobre a data das viagens/despesas lancadas.</p>
    ` : ''}
    <div class="card mt-6 p-4">
      <h2 class="mb-1 font-semibold text-slate-900">Detalhamento de custos - ${dre.veiculo.placa}</h2>
      <p class="mb-2 text-xs text-slate-400">Clique numa linha para ver os lancamentos individuais.</p>
      <div>
        ${CATEGORIAS_CUSTO.map((c) => montarLinhaExpansivel(c.chave, c.titulo, dre.custos[c.chave], veiculoId, inicio, fim)).join('')}
      </div>
    </div>
  `;

  resultadoEl.querySelectorAll('[data-detalhe]').forEach((details) => {
    let carregado = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || carregado) return;
      carregado = true;
      const categoria = details.dataset.detalhe;
      const corpo = details.querySelector(`#dre-detalhe-${categoria}`);
      try {
        const dqs = new URLSearchParams();
        if (inicio) dqs.set('data_inicio', inicio);
        if (fim) dqs.set('data_fim', fim);
        const itens = await get(`/dre/veiculo/${veiculoId}/detalhe/${categoria}?${dqs.toString()}`);
        corpo.innerHTML = itens.length
          ? itens.map(linhaDetalheDre).join('')
          : '<p class="text-slate-400">Nenhum lancamento no periodo.</p>';
      } catch (err) {
        corpo.innerHTML = `<p class="text-red-600">${err.message}</p>`;
      }
    });
  });
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">DRE e Relatorios</h1>
    <div class="card mb-6 p-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div><label class="label">De</label><input type="text" class="input" data-inicio /></div>
        <div><label class="label">Ate</label><input type="text" class="input" data-fim /></div>
        <div class="sm:col-span-2"><label class="label">Veiculo (opcional, deixe vazio para DRE geral)</label><div data-veiculo></div></div>
        <div class="flex items-end"><button type="button" class="btn-secondary w-full" data-exportar-pdf>Exportar PDF</button></div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="btn-secondary btn-sm" data-atalho="7dias">Ultimos 7 dias</button>
        <button type="button" class="btn-secondary btn-sm" data-atalho="30dias">Ultimos 30 dias</button>
        <button type="button" class="btn-secondary btn-sm" data-atalho="mesAtual">Este mes</button>
        <button type="button" class="btn-secondary btn-sm" data-atalho="mesPassado">Mes passado</button>
      </div>
    </div>
    <div data-resultado></div>
  `;
  const inicioInput = container.querySelector('[data-inicio]');
  const fimInput = container.querySelector('[data-fim]');
  // Mes corrente por padrao (ver primeiroDiaMesAtualIso acima) - o usuario
  // ainda pode limpar/trocar livremente pra ver outro periodo.
  attachDataMask(inicioInput, primeiroDiaMesAtualIso());
  attachDataMask(fimInput, hojeIsoLocal());
  const resultadoEl = container.querySelector('[data-resultado]');

  let veiculoId = null;
  const veiculoSelect = criarSearchableSelect({
    buscar: buscarVeiculos,
    placeholder: 'Pesquisar placa...',
    onChange: (id) => { veiculoId = id; atualizar(); },
  });
  container.querySelector('[data-veiculo]').appendChild(veiculoSelect.el);

  container.querySelectorAll('[data-atalho]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [inicioIso, fimIso] = periodoAtalho(btn.dataset.atalho);
      inicioInput.value = formatarDataBr(inicioIso);
      fimInput.value = formatarDataBr(fimIso);
      atualizar();
    });
  });

  async function atualizar() {
    const inicio = inicioInput.value ? parseDataBrParaIso(inicioInput.value) : null;
    const fim = fimInput.value ? parseDataBrParaIso(fimInput.value) : null;
    try {
      if (veiculoId) await renderVeiculo(resultadoEl, veiculoId, inicio, fim);
      else await renderGeral(resultadoEl, inicio, fim);
    } catch (err) {
      mostrarErro(err);
    }
  }

  let debounceId = null;
  [inicioInput, fimInput].forEach((el) => el.addEventListener('input', () => {
    clearTimeout(debounceId);
    debounceId = setTimeout(atualizar, 400);
  }));

  container.querySelector('[data-exportar-pdf]').addEventListener('click', () => {
    const qs = new URLSearchParams();
    const inicio = inicioInput.value ? parseDataBrParaIso(inicioInput.value) : null;
    const fim = fimInput.value ? parseDataBrParaIso(fimInput.value) : null;
    if (inicio) qs.set('data_inicio', inicio);
    if (fim) qs.set('data_fim', fim);
    if (veiculoId) qs.set('veiculo_id', veiculoId);
    window.open(`${window.location.pathname}#/dre/relatorio?${qs.toString()}`, '_blank');
  });

  await atualizar();
}
