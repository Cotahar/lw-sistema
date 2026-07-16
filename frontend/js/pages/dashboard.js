import { get } from '../api.js';
import { formatarMoeda, formatarDataBr } from '../masks.js';
import { mostrarErro } from '../components/toast.js';

function cartaoResumo(titulo, valor, cor = 'text-slate-900') {
  return `
    <div class="card p-4">
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500">${titulo}</p>
      <p class="mt-1 text-2xl font-bold ${cor}">${valor}</p>
    </div>
  `;
}

export async function render(container) {
  container.innerHTML = '<p class="text-slate-400">Carregando...</p>';
  try {
    const resumo = await get('/dashboard/resumo');
    container.innerHTML = `
      <h1 class="mb-4 text-xl font-bold text-slate-900">Painel</h1>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${cartaoResumo('Saldo em caixa', formatarMoeda(resumo.saldoTotalContas))}
        ${cartaoResumo('Viagens em andamento', resumo.viagensEmAndamento)}
        ${cartaoResumo('Aguardando acerto', resumo.viagensAguardandoAcerto)}
        ${cartaoResumo('Alertas pendentes', resumo.alertasPendentes.length, resumo.alertasPendentes.length ? 'text-amber-600' : 'text-slate-900')}
      </div>

      <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div class="card p-4 lg:col-span-1">
          <h2 class="mb-3 font-semibold text-slate-900">Alertas de manutencao pendentes</h2>
          <div data-lista-alertas class="space-y-2"></div>
        </div>
        <div class="card p-4 lg:col-span-1">
          <h2 class="mb-3 font-semibold text-slate-900">Contas a pagar vencidas</h2>
          <div data-lista-pagar class="space-y-2"></div>
        </div>
        <div class="card p-4 lg:col-span-1">
          <h2 class="mb-3 font-semibold text-slate-900">Contas a receber vencidas</h2>
          <div data-lista-receber class="space-y-2"></div>
        </div>
      </div>
    `;

    const listaAlertas = container.querySelector('[data-lista-alertas]');
    listaAlertas.innerHTML = resumo.alertasPendentes.length
      ? resumo.alertasPendentes.map((a) => `
          <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <p class="font-medium text-amber-800">${a.placa} - ${a.regra_descricao}</p>
            <p class="text-xs text-amber-700">Disparado em ${a.km_atual_no_disparo.toLocaleString('pt-BR')} km</p>
          </div>
        `).join('')
      : '<p class="text-sm text-slate-400">Nenhum alerta pendente.</p>';

    const listaPagar = container.querySelector('[data-lista-pagar]');
    listaPagar.innerHTML = resumo.contasPagarVencidas.length
      ? resumo.contasPagarVencidas.map((c) => `
          <div class="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
            <span class="text-red-800">${c.descricao}</span>
            <span class="font-medium text-red-800">${formatarMoeda(c.valor - c.valor_pago)}</span>
          </div>
        `).join('')
      : '<p class="text-sm text-slate-400">Nenhuma conta vencida.</p>';

    const listaReceber = container.querySelector('[data-lista-receber]');
    listaReceber.innerHTML = resumo.contasReceberVencidas.length
      ? resumo.contasReceberVencidas.map((c) => `
          <div class="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <span class="text-amber-800">Frete #${c.frete_id} (${formatarDataBr(c.data_prevista)})</span>
            <span class="font-medium text-amber-800">${formatarMoeda(c.valor - c.valor_recebido - c.valor_descontado)}</span>
          </div>
        `).join('')
      : '<p class="text-sm text-slate-400">Nenhuma conta vencida.</p>';
  } catch (err) {
    mostrarErro(err);
    container.innerHTML = '<p class="text-red-600">Nao foi possivel carregar o painel.</p>';
  }
}
