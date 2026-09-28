import { get, getUsuario } from '../api.js';
import { formatarMoeda, formatarDataBr, hojeIsoLocal } from '../masks.js';
import { navegar } from '../router.js';
import { esqueletoPagina } from '../components/skeleton.js';

// zinc, nao slate/gray: essas duas escalas sao invertidas no
// tailwind.config.js pro dark mode fixo do app (slate-900 vira quase
// branco) - sobre o fundo branco impresso desta pagina isso deixava o
// texto quase invisivel/monotono (mesmo achado do redesign do relatorio de
// acerto, ver acertoRelatorio.js).
function linha(label, valor, destaque = false) {
  return `<div class="flex items-center justify-between py-1.5 ${destaque ? 'text-base font-bold text-zinc-900' : 'text-sm text-zinc-600'}"><span>${label}</span><span class="${destaque ? '' : 'font-medium text-zinc-900'}">${valor}</span></div>`;
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
  root.innerHTML = `<div class="p-8">${esqueletoPagina()}</div>`;
  const usuario = getUsuario();

  const qs = new URLSearchParams();
  if (data_inicio) qs.set('data_inicio', data_inicio);
  if (data_fim) qs.set('data_fim', data_fim);

  const corpo = veiculo_id
    ? await renderizarVeiculo(await get(`/dre/veiculo/${veiculo_id}?${qs.toString()}`))
    : await renderizarGeral(await get(`/dre/geral?${qs.toString()}`));

  root.innerHTML = `
    <style>
      @media print {
        .relatorio-dre, .relatorio-dre * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
      }
    </style>
    <div class="relatorio-dre mx-auto max-w-4xl p-6 print:max-w-none print:p-0">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" class="btn-secondary btn-sm" data-voltar>&larr; Voltar para o DRE</button>
        <button type="button" class="btn-primary btn-sm" data-imprimir>Imprimir / Salvar PDF</button>
      </div>
      <div class="rounded-xl border border-zinc-200 bg-white p-8 text-zinc-900 print:border-0 print:p-0">
        <div class="mb-6 border-b-4 border-brand-yellow pb-4">
          <h1 class="text-2xl font-extrabold text-zinc-900">DRE Detalhado ${veiculo_id ? '- Veiculo' : '- Geral'}</h1>
          <p class="mt-1 text-sm font-medium text-zinc-500">${periodoTexto(data_inicio, data_fim)} &middot; Gerado em ${formatarDataBr(hojeIsoLocal())}${usuario ? ` por ${usuario.nome}` : ''}</p>
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
    <h2 class="mb-2 mt-6 text-base font-bold text-zinc-900">Resultado por veiculo</h2>
    <table class="w-full border-collapse overflow-hidden rounded-lg text-sm">
      <thead><tr class="bg-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-600">
        <th class="px-2 py-1.5">Placa</th><th class="px-2 py-1.5 text-right">Receita</th><th class="px-2 py-1.5 text-right">Custo</th><th class="px-2 py-1.5 text-right">Lucro</th>
      </tr></thead>
      <tbody>
        ${dre.porVeiculo.map((v, i) => `
          <tr class="border-b border-zinc-100 ${i % 2 ? 'bg-zinc-50/60' : ''}">
            <td class="px-2 py-1.5 text-zinc-700">${v.placa}</td>
            <td class="px-2 py-1.5 text-right text-zinc-700">${formatarMoeda(v.receita)}</td>
            <td class="px-2 py-1.5 text-right text-zinc-700">${formatarMoeda(v.custoTotal)}</td>
            <td class="px-2 py-1.5 text-right font-medium ${v.lucro >= 0 ? 'text-emerald-700' : 'text-red-700'}">${formatarMoeda(v.lucro)}</td>
          </tr>
        `).join('') || '<tr><td colspan="4" class="px-2 py-3 text-center text-zinc-400">Sem dados no periodo.</td></tr>'}
      </tbody>
    </table>
  `;
}

async function renderizarVeiculo(dre) {
  return `
    <div class="mb-4 grid grid-cols-2 gap-2">
      <p class="col-span-2 text-sm"><span class="font-medium text-zinc-500">Veiculo:</span> <span class="text-zinc-900">${dre.veiculo.placa}</span></p>
      ${linha('Receita', formatarMoeda(dre.receita))}
      ${linha('Custo total', formatarMoeda(dre.custos.total))}
      ${linha('Lucro', formatarMoeda(dre.lucro), true)}
    </div>
    <h2 class="mb-2 mt-6 text-base font-bold text-zinc-900">Detalhamento de custos</h2>
    <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      ${linha('Despesas de viagem', formatarMoeda(dre.custos.viagem))}
      ${linha('Pecas (estoque direto)', formatarMoeda(dre.custos.pecasDireto))}
      ${linha('Ordens de servico', formatarMoeda(dre.custos.ordensServico))}
      ${linha('Pneus', formatarMoeda(dre.custos.pneus))}
      ${linha('Despesas fixas', formatarMoeda(dre.custos.despesasFixas))}
      ${linha('Financiamento', formatarMoeda(dre.custos.financiamento))}
    </div>
  `;
}
