import { get } from '../api.js';
import { formatarMoeda, formatarDataBr, formatarDataHoraBr, hojeIsoLocal } from '../masks.js';
import { mostrarErro } from '../components/toast.js';
import { criarBotaoSincronizarOnixsat } from '../components/onixsatSync.js';
import { modalAberto } from '../components/modal.js';
import { esqueletoPagina } from '../components/skeleton.js';

function cartaoVeiculoViagem(v) {
  const consumo = v.media_consumo_atual ? `${v.media_consumo_atual.toFixed(2)} km/l` : '-';
  const localizacao = v.localizacao_cidade
    ? `${v.localizacao_cidade}/${v.localizacao_uf} <span class="text-slate-400">(${formatarDataHoraBr(v.localizacao_atualizado_em)})</span>`
    : '-';
  return `
    <a href="#/viagens/${v.viagem_id}" class="card block p-4 hover:border-brand-yellow hover:shadow-sm">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-base font-bold text-slate-900">${v.placa}</p>
        <span class="text-xs text-slate-500">${v.motorista_nome}</span>
      </div>
      <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt class="text-slate-500">Inicio da viagem</dt><dd class="text-right text-slate-900">${formatarDataBr(v.data_inicio)}</dd>
        <dt class="text-slate-500">Km rodado</dt><dd class="text-right text-slate-900">${v.km_rodado.toLocaleString('pt-BR')} km</dd>
        <dt class="text-slate-500">Media de consumo</dt><dd class="text-right text-slate-900">${consumo}</dd>
        <dt class="text-slate-500">Faturamento</dt><dd class="text-right font-medium text-emerald-400">${formatarMoeda(v.faturamento_total)}</dd>
        <dt class="text-slate-500">Despesas</dt><dd class="text-right font-medium text-red-400">${formatarMoeda(v.despesas_total)}</dd>
        <dt class="text-slate-500">Localizacao</dt><dd class="text-right text-slate-900">${localizacao}</dd>
      </dl>
    </a>
  `;
}

// Icones dos cards de resumo (SVG inline - ver revisao de design, "Icones no
// menu e nos cards"): o olho tinha onde "pousar" antes de ler o numero.
const ICONE_VIAGENS = '<svg class="mb-2 h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 13h2l2-5h10l2 5h2M5 13v5a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-5"/></svg>';
const ICONE_ACERTO = '<svg class="mb-2 h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
const iconeAlertas = (ativo) => `<svg class="mb-2 h-5 w-5 ${ativo ? 'text-amber-500' : 'text-slate-400'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9L2.7 17a2 2 0 001.7 3h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>`;

function cartaoResumo(titulo, valor, { cor = 'text-slate-900', rota, icone } = {}) {
  const classes = `card block p-4${rota ? ' hover:border-brand-yellow hover:shadow-sm' : ''}`;
  const tag = rota ? `a href="#${rota}"` : 'div';
  const fechoTag = rota ? 'a' : 'div';
  return `
    <${tag} class="${classes}">
      ${icone || '<div class="mb-2 h-1 w-8 rounded-full bg-brand-yellow"></div>'}
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500">${titulo}</p>
      <p class="mt-1 text-2xl font-bold ${cor}">${valor}</p>
    </${fechoTag}>
  `;
}

let intervaloAtualizacao = null;

export async function render(container) {
  // Onixsat sincroniza sozinho a cada 5min no backend, mas sem isso a tela
  // so refletiria os dados novos depois de um F5 ou clique manual no botao.
  if (intervaloAtualizacao) clearInterval(intervaloAtualizacao);
  const hashInicio = window.location.hash;
  intervaloAtualizacao = setInterval(() => {
    if (window.location.hash !== hashInicio) { clearInterval(intervaloAtualizacao); return; }
    // Nunca atualiza com um modal aberto em cima (o Painel nao tem formulario
    // proprio, mas os cards linkam pra outras telas que podem ter aberto um) -
    // so tenta de novo no proximo ciclo.
    if (modalAberto()) return;
    render(container);
  }, 5 * 60 * 1000);

  container.innerHTML = esqueletoPagina();
  try {
    const resumo = await get('/dashboard/resumo');
    container.innerHTML = `
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-xl font-bold text-slate-900">Painel</h1>
        <div data-onixsat-botao></div>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${cartaoResumo('Viagens em andamento', resumo.viagensEmAndamento, { rota: '/viagens', icone: ICONE_VIAGENS })}
        ${cartaoResumo('Aguardando acerto', resumo.viagensAguardandoAcerto, { rota: '/acertos', icone: ICONE_ACERTO })}
        ${cartaoResumo('Alertas pendentes', resumo.alertasPendentes.length, { cor: resumo.alertasPendentes.length ? 'text-amber-600' : 'text-slate-900', rota: '/alertas', icone: iconeAlertas(resumo.alertasPendentes.length > 0) })}
      </div>

      <div class="mt-6">
        <h2 class="mb-3 font-semibold text-slate-900">Veiculos em viagem</h2>
        <div data-veiculos-viagem class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"></div>
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
          <h2 class="mb-3 font-semibold text-slate-900">Saldos de frete pendentes</h2>
          <div data-lista-receber class="space-y-2"></div>
        </div>
      </div>
    `;

    container.querySelector('[data-onixsat-botao]').appendChild(criarBotaoSincronizarOnixsat({
      onAtualizar: () => { if (!modalAberto()) render(container); },
    }));

    const listaVeiculosViagem = container.querySelector('[data-veiculos-viagem]');
    listaVeiculosViagem.innerHTML = resumo.viagensAtivas.length
      ? resumo.viagensAtivas.map(cartaoVeiculoViagem).join('')
      : '<p class="text-sm text-slate-400">Nenhuma viagem em andamento.</p>';

    const listaAlertas = container.querySelector('[data-lista-alertas]');
    listaAlertas.innerHTML = resumo.alertasPendentes.length
      ? resumo.alertasPendentes.map((a) => `
          <div class="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm">
            <p class="font-medium text-amber-400">${a.placa} - ${a.regra_descricao}</p>
            <p class="text-xs text-amber-500">Disparado em ${a.km_atual_no_disparo.toLocaleString('pt-BR')} km</p>
          </div>
        `).join('')
      : '<p class="text-sm text-slate-400">Nenhum alerta pendente.</p>';

    const listaPagar = container.querySelector('[data-lista-pagar]');
    listaPagar.innerHTML = resumo.contasPagarVencidas.length
      ? resumo.contasPagarVencidas.map((c) => `
          <div class="flex items-center justify-between rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm">
            <span class="text-red-400">${c.descricao}</span>
            <span class="font-medium text-red-400">${formatarMoeda(c.valor - c.valor_pago)}</span>
          </div>
        `).join('')
      : '<p class="text-sm text-slate-400">Nenhuma conta vencida.</p>';

    const listaReceber = container.querySelector('[data-lista-receber]');
    const hojeIso = hojeIsoLocal();
    listaReceber.innerHTML = resumo.saldosFretePendentes.length
      ? resumo.saldosFretePendentes.map((c) => {
          const vencido = c.data_prevista < hojeIso;
          const cor = vencido ? 'border-red-800 bg-red-950/40 text-red-400' : 'border-amber-800 bg-amber-950/40 text-amber-400';
          return `
            <a href="#/viagens/${c.viagem_id}" class="flex items-center justify-between rounded-lg border ${cor} px-3 py-2 text-sm hover:opacity-80">
              <span>${c.origem_cidade}/${c.origem_uf} &rarr; ${c.destino_cidade}/${c.destino_uf} (${formatarDataBr(c.data_prevista)})</span>
              <span class="font-medium">${formatarMoeda(c.valor - c.valor_recebido - c.valor_descontado)}</span>
            </a>
          `;
        }).join('')
      : '<p class="text-sm text-slate-400">Nenhum saldo de frete pendente.</p>';
  } catch (err) {
    mostrarErro(err);
    container.innerHTML = '<p class="text-red-600">Nao foi possivel carregar o painel.</p>';
  }
}
