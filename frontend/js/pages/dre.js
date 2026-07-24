import { get } from '../api.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachDataMask, parseDataBrParaIso, hojeIsoLocal } from '../masks.js';

// Periodo padrao ao abrir a tela: mes corrente (dia 1 ate hoje) - antes
// abria sem filtro nenhum (todo o historico), forcando o usuario a
// preencher a data toda vez so pra ver o mes atual, o caso mais comum.
function primeiroDiaMesAtualIso() {
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00`);
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
}

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

function cartao(titulo, valor, cor = 'text-slate-900') {
  return `<div class="card p-4"><p class="text-xs font-medium uppercase tracking-wide text-slate-500">${titulo}</p><p class="mt-1 text-2xl font-bold ${cor}">${valor}</p></div>`;
}

async function renderGeral(resultadoEl, inicio, fim) {
  const qs = new URLSearchParams();
  if (inicio) qs.set('data_inicio', inicio);
  if (fim) qs.set('data_fim', fim);
  const dre = await get(`/dre/geral?${qs.toString()}`);
  resultadoEl.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      ${cartao('Receita Total', formatarMoeda(dre.receitaTotal))}
      ${cartao('Custo Total (frota)', formatarMoeda(dre.custoTotalVeiculos))}
      ${cartao('Despesas Base/Admin', formatarMoeda(dre.despesasBase.total))}
      ${cartao('Lucro Liquido', formatarMoeda(dre.lucroLiquido), dre.lucroLiquido >= 0 ? 'text-emerald-600' : 'text-red-600')}
    </div>
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
  `;
}

async function renderVeiculo(resultadoEl, veiculoId, inicio, fim) {
  const qs = new URLSearchParams();
  if (inicio) qs.set('data_inicio', inicio);
  if (fim) qs.set('data_fim', fim);
  const dre = await get(`/dre/veiculo/${veiculoId}?${qs.toString()}`);
  resultadoEl.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      ${cartao('Receita', formatarMoeda(dre.receita))}
      ${cartao('Custo Total', formatarMoeda(dre.custos.total))}
      ${cartao('Lucro', formatarMoeda(dre.lucro), dre.lucro >= 0 ? 'text-emerald-600' : 'text-red-600')}
    </div>
    <div class="card mt-6 p-4">
      <h2 class="mb-3 font-semibold text-slate-900">Detalhamento de custos - ${dre.veiculo.placa}</h2>
      <div class="space-y-1 text-sm">
        <div class="flex justify-between py-1 text-slate-600"><span>Despesas de viagem</span><span>${formatarMoeda(dre.custos.viagem)}</span></div>
        <div class="flex justify-between py-1 text-slate-600"><span>Pecas (estoque direto)</span><span>${formatarMoeda(dre.custos.pecasDireto)}</span></div>
        <div class="flex justify-between py-1 text-slate-600"><span>Ordens de servico</span><span>${formatarMoeda(dre.custos.ordensServico)}</span></div>
        <div class="flex justify-between py-1 text-slate-600"><span>Pneus</span><span>${formatarMoeda(dre.custos.pneus)}</span></div>
        <div class="flex justify-between py-1 text-slate-600"><span>Despesas fixas</span><span>${formatarMoeda(dre.custos.despesasFixas)}</span></div>
        <div class="flex justify-between py-1 text-slate-600"><span>Financiamento</span><span>${formatarMoeda(dre.custos.financiamento)}</span></div>
      </div>
    </div>
  `;
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">DRE e Relatorios</h1>
    <div class="card mb-6 grid grid-cols-1 gap-3 p-4 sm:grid-cols-5">
      <div><label class="label">De</label><input type="text" class="input" data-inicio /></div>
      <div><label class="label">Ate</label><input type="text" class="input" data-fim /></div>
      <div class="sm:col-span-2"><label class="label">Veiculo (opcional, deixe vazio para DRE geral)</label><div data-veiculo></div></div>
      <div class="flex items-end"><button type="button" class="btn-secondary w-full" data-exportar-pdf>Exportar PDF</button></div>
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
