import { get, getUsuario } from '../api.js';
import { formatarMoeda, formatarDataBr, hojeIsoLocal } from '../masks.js';
import { navegar } from '../router.js';

function linha(label, valor, destaque = false) {
  return `<div class="flex items-center justify-between py-1.5 ${destaque ? 'text-base font-semibold text-slate-900' : 'text-sm text-slate-600'}"><span>${label}</span><span>${valor}</span></div>`;
}

function periodoTexto(inicio, fim) {
  if (!inicio && !fim) return 'Periodo completo';
  if (inicio && fim) return `${formatarDataBr(inicio)} a ${formatarDataBr(fim)}`;
  if (inicio) return `A partir de ${formatarDataBr(inicio)}`;
  return `Ate ${formatarDataBr(fim)}`;
}

export async function renderDreRelatorio(root, params, query) {
  if (!localStorage.getItem('frotista_token')) {
    navegar('/login');
    return;
  }
  const { data_inicio, data_fim, veiculo_id } = query;
  root.innerHTML = '<p class="p-8 text-slate-400">Carregando...</p>';
  const usuario = getUsuario();

  const qs = new URLSearchParams();
  if (data_inicio) qs.set('data_inicio', data_inicio);
  if (data_fim) qs.set('data_fim', data_fim);

  const corpo = veiculo_id
    ? await renderizarVeiculo(await get(`/dre/veiculo/${veiculo_id}?${qs.toString()}`))
    : await renderizarGeral(await get(`/dre/geral?${qs.toString()}`));

  root.innerHTML = `
    <div class="mx-auto max-w-4xl p-6 print:max-w-none print:p-0">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" class="btn-secondary btn-sm" data-voltar>&larr; Voltar para o DRE</button>
        <button type="button" class="btn-primary btn-sm" data-imprimir>Imprimir / Salvar PDF</button>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-8 print:border-0 print:p-0">
        <div class="mb-6 border-b border-slate-200 pb-4">
          <h1 class="text-xl font-bold text-slate-900">DRE Detalhado ${veiculo_id ? '- Veiculo' : '- Geral'}</h1>
          <p class="text-sm text-slate-500">${periodoTexto(data_inicio, data_fim)} &middot; Gerado em ${formatarDataBr(hojeIsoLocal())}${usuario ? ` por ${usuario.nome}` : ''}</p>
        </div>
        ${corpo}
      </div>
    </div>
  `;

  root.querySelector('[data-voltar]').addEventListener('click', () => navegar('/dre'));
  root.querySelector('[data-imprimir]').addEventListener('click', () => window.print());
}

async function renderizarGeral(dre) {
  return `
    <div class="mb-4 grid grid-cols-2 gap-2">
      ${linha('Receita total', formatarMoeda(dre.receitaTotal))}
      ${linha('Custo total (frota)', formatarMoeda(dre.custoTotalVeiculos))}
      ${linha('Despesas Base/Admin', formatarMoeda(dre.despesasBase.total))}
      ${linha('Lucro liquido', formatarMoeda(dre.lucroLiquido), true)}
    </div>
    <h2 class="mb-2 mt-6 font-semibold text-slate-900">Resultado por veiculo</h2>
    <table class="w-full text-sm">
      <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
        <th class="py-1">Placa</th><th class="py-1 text-right">Receita</th><th class="py-1 text-right">Custo</th><th class="py-1 text-right">Lucro</th>
      </tr></thead>
      <tbody>
        ${dre.porVeiculo.map((v) => `
          <tr class="border-b border-slate-100">
            <td class="py-1">${v.placa}</td>
            <td class="py-1 text-right">${formatarMoeda(v.receita)}</td>
            <td class="py-1 text-right">${formatarMoeda(v.custoTotal)}</td>
            <td class="py-1 text-right">${formatarMoeda(v.lucro)}</td>
          </tr>
        `).join('') || '<tr><td colspan="4" class="py-2 text-center text-slate-400">Sem dados no periodo.</td></tr>'}
      </tbody>
    </table>
  `;
}

async function renderizarVeiculo(dre) {
  return `
    <div class="mb-4 grid grid-cols-2 gap-2">
      <p class="col-span-2 text-sm"><span class="font-medium">Veiculo:</span> ${dre.veiculo.placa}</p>
      ${linha('Receita', formatarMoeda(dre.receita))}
      ${linha('Custo total', formatarMoeda(dre.custos.total))}
      ${linha('Lucro', formatarMoeda(dre.lucro), true)}
    </div>
    <h2 class="mb-2 mt-6 font-semibold text-slate-900">Detalhamento de custos</h2>
    <div class="rounded-lg bg-slate-50 p-4">
      ${linha('Despesas de viagem', formatarMoeda(dre.custos.viagem))}
      ${linha('Pecas (estoque direto)', formatarMoeda(dre.custos.pecasDireto))}
      ${linha('Ordens de servico', formatarMoeda(dre.custos.ordensServico))}
      ${linha('Pneus', formatarMoeda(dre.custos.pneus))}
      ${linha('Despesas fixas', formatarMoeda(dre.custos.despesasFixas))}
      ${linha('Financiamento', formatarMoeda(dre.custos.financiamento))}
    </div>
  `;
}
