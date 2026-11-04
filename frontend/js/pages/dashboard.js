import { get } from '../api.js';
import { formatarMoeda, formatarDataBr, formatarDataHoraBr, hojeIsoLocal } from '../masks.js';
import { mostrarErro } from '../components/toast.js';
import { criarBotaoSincronizarOnixsat } from '../components/onixsatSync.js';
import { modalAberto } from '../components/modal.js';
import { esqueletoPagina } from '../components/skeleton.js';
import { esc } from '../html.js';
import { placaHtml } from '../components/placa.js';

const TITULO_PAINEL = 'font-display text-xl font-bold uppercase leading-none tracking-wide text-slate-900';

// Dias entre duas datas ISO (positivo = a primeira e posterior a segunda).
function diasEntre(maisRecenteIso, maisAntigaIso) {
  return Math.round((new Date(`${maisRecenteIso}T00:00:00Z`) - new Date(`${maisAntigaIso}T00:00:00Z`)) / 86400000);
}

// Valores vem em centavos. "R$ 184.300" (sem centavos) cabe no numero grande do card.
function moedaCurta(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function linhaViagem(v) {
  const consumo = v.media_consumo_atual ? v.media_consumo_atual.toFixed(2).replace('.', ',') : '-';
  const dias = Math.max(1, diasEntre(hojeIsoLocal(), v.data_inicio));
  const localizacao = v.localizacao_cidade
    ? `${esc(v.localizacao_cidade)}/${esc(v.localizacao_uf)} <span class="text-slate-400">· ${formatarDataHoraBr(v.localizacao_atualizado_em)}</span>`
    : '<span class="text-slate-400">Localização não informada</span>';
  return `
    <a href="#/viagens/${v.viagem_id}" class="grid grid-cols-2 items-center gap-x-3 gap-y-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-brand-dark lg:grid-cols-[88px_minmax(0,1.25fr)_minmax(0,1fr)_52px_88px_88px]">
      <div>${placaHtml(v.placa)}</div>
      <div class="min-w-0">
        <p class="truncate text-base font-semibold text-slate-900">${esc(v.motorista_nome)}</p>
        <p class="truncate text-sm text-slate-500">${localizacao}</p>
      </div>
      <div class="lg:text-right"><p class="font-semibold text-slate-900">${v.km_rodado.toLocaleString('pt-BR')} km</p><p class="text-xs text-slate-400">${dias} dia(s) · desde ${formatarDataBr(v.data_inicio)}</p></div>
      <div class="lg:text-right"><p class="font-semibold text-slate-900">${consumo}</p><p class="text-xs text-slate-400">km/l</p></div>
      <div class="lg:text-right"><p class="font-semibold text-success">${moedaCurta(v.faturamento_total)}</p><p class="text-xs text-slate-400">faturado</p></div>
      <div class="lg:text-right"><p class="font-semibold text-danger">${moedaCurta(v.despesas_total)}</p><p class="text-xs text-slate-400">despesas</p></div>
    </a>
  `;
}

// Cartao de numero: ponto colorido + rotulo em caixa alta, numero em letreiro, detalhe e atalho.
function cartaoResumo({ rotulo, valor, detalhe, rota, acao, ponto }) {
  return `
    <a href="#${rota}" class="card block p-5 hover:border-accent-fg">
      <p class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-400"><i class="inline-block h-2 w-2 rounded-sm ${ponto}"></i>${rotulo}</p>
      <p class="mt-3 font-display text-5xl font-bold leading-none text-slate-900">${valor}</p>
      <p class="mt-2 text-sm text-slate-500">${detalhe}</p>
      <p class="mt-3 text-sm font-semibold text-accent-fg">${acao} &rarr;</p>
    </a>
  `;
}

// Linha do painel "Precisa de atencao": faixa colorida a esquerda (cor = urgencia) + titulo, detalhe e prazo.
function itemAtencao({ tom, titulo, detalhe, direita, href }) {
  return `
    <a href="#${href}" class="grid grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-brand-dark">
      <span class="h-full min-h-[34px] rounded-sm ${tom}"></span>
      <div class="min-w-0"><p class="truncate font-semibold text-slate-900">${titulo}</p><p class="truncate text-sm text-slate-400">${detalhe}</p></div>
      <span class="whitespace-nowrap text-right text-sm font-semibold text-slate-500">${direita}</span>
    </a>
  `;
}

function montarAtencao(resumo, hojeIso) {
  const itens = [];
  for (const c of resumo.contasPagarVencidas) {
    const dias = diasEntre(hojeIso, c.data_vencimento);
    itens.push({ ordem: 0 - dias, tom: 'bg-danger', titulo: `${esc(c.descricao)}`, detalhe: `Conta a pagar vencida há ${dias} dia(s)`, direita: formatarMoeda(c.valor - c.valor_pago), href: '/contas-pagar' });
  }
  for (const s of resumo.saldosFretePendentes) {
    const dias = diasEntre(hojeIso, s.data_prevista);
    if (dias <= 0) continue;
    itens.push({ ordem: 1000 - dias, tom: 'bg-danger', titulo: `${esc(s.origem_cidade)}/${esc(s.origem_uf)} &rarr; ${esc(s.destino_cidade)}/${esc(s.destino_uf)}`, detalhe: `Saldo de frete previsto há ${dias} dia(s)`, direita: formatarMoeda(s.valor - s.valor_recebido - s.valor_descontado), href: `/viagens/${s.viagem_id}` });
  }
  for (const a of resumo.alertasPendentes) {
    itens.push({ ordem: 2000, tom: 'bg-warning', titulo: `${esc(a.placa)} · ${esc(a.regra_descricao)}`, detalhe: 'Alerta de manutenção pendente', direita: `${a.km_atual_no_disparo.toLocaleString('pt-BR')} km`, href: '/alertas' });
  }
  return itens.sort((a, b) => a.ordem - b.ordem);
}

// Fluxo de caixa dos proximos 30 dias: o que as contas a receber/pagar EM ABERTO preveem por dia (o que ja
// venceu cai no "hoje"). Area azul = entradas, linha tracejada amarela = saidas.
function graficoFluxo(entradas, saidas) {
  const W = 720; const H = 230; const L = 50; const R = 12; const T = 12; const B = 28; const n = entradas.length;
  const maxReais = Math.max(1, ...entradas, ...saidas) / 100;
  const passo = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000].find((p) => maxReais / p <= 4) || 1000000;
  const topo = Math.ceil(maxReais / passo) * passo;
  const x = (i) => L + (i * (W - L - R)) / (n - 1);
  const y = (v) => T + (H - T - B) * (1 - v / 100 / topo);
  const linha = (a) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const rotulo = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR')} mil` : String(v));
  let g = '<defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B63F0" stop-opacity=".38"/><stop offset="1" stop-color="#2B63F0" stop-opacity="0"/></linearGradient></defs>';
  for (let v = 0; v <= topo; v += passo) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v * 100)}" y2="${y(v * 100)}" stroke="#262A31" stroke-dasharray="2 5"/><text x="${L - 8}" y="${y(v * 100) + 4}" text-anchor="end" fill="#7B8290" font-size="12">${rotulo(v)}</text>`;
  }
  for (let i = 0; i < n; i += 5) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" fill="#7B8290" font-size="12">${i === 0 ? 'hoje' : `+${i} d`}</text>`;
  g += `<path d="${linha(entradas)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z" fill="url(#gArea)"/><path d="${linha(entradas)}" fill="none" stroke="#7EA4FF" stroke-width="2.4" stroke-linejoin="round"/>`;
  g += `<path d="${linha(saidas)}" fill="none" stroke="#F5B800" stroke-width="2.2" stroke-dasharray="7 5" stroke-linejoin="round"/>`;
  g += `<line x1="${x(0)}" x2="${x(0)}" y1="${T}" y2="${H - B}" stroke="#ECEEF2" stroke-opacity=".45"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Fluxo de caixa previsto dos próximos 30 dias">${g}</svg>`;
}

async function buscarFluxo(hojeIso) {
  const fim = new Date(`${hojeIso}T00:00:00Z`);
  fim.setUTCDate(fim.getUTCDate() + 30);
  const ate = fim.toISOString().slice(0, 10);
  const [pagar, receber] = await Promise.all([
    get(`/contas-pagar?status=Pendente&data_vencimento_ate=${ate}`),
    get(`/contas-receber?status=Pendente&data_vencimento_ate=${ate}`),
  ]);
  const entradas = new Array(31).fill(0);
  const saidas = new Array(31).fill(0);
  const dia = (iso) => Math.min(30, Math.max(0, diasEntre(iso, hojeIso)));
  for (const c of pagar) saidas[dia(c.data_vencimento)] += Math.max(0, c.valor - c.valor_pago - (c.valor_descontado || 0));
  for (const c of receber) entradas[dia(c.data_prevista)] += Math.max(0, c.valor - c.valor_recebido - c.valor_descontado);
  return { entradas, saidas };
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
    const hojeIso = hojeIsoLocal();
    const totalVencidoPagar = resumo.contasPagarVencidas.reduce((s, c) => s + (c.valor - c.valor_pago), 0);
    const maisAntiga = resumo.contasPagarVencidas.length ? diasEntre(hojeIso, resumo.contasPagarVencidas[0].data_vencimento) : 0;
    const totalReceber = resumo.saldosFretePendentes.reduce((s, c) => s + (c.valor - c.valor_recebido - c.valor_descontado), 0);
    const receberVencidos = resumo.saldosFretePendentes.filter((s) => s.data_prevista < hojeIso).length;
    const atencao = montarAtencao(resumo, hojeIso);

    container.innerHTML = `
      <div class="mb-5 flex items-center justify-between gap-3">
        <h1 class="text-3xl font-bold text-slate-900">Painel</h1>
        <div data-onixsat-botao></div>
      </div>

      <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">
        ${cartaoResumo({ rotulo: 'Viagens em andamento', valor: resumo.viagensEmAndamento, detalhe: `${resumo.viagensAtivas.length} veículo(s) na estrada`, rota: '/viagens', acao: 'Ver viagens', ponto: 'bg-accent-fg' })}
        ${cartaoResumo({ rotulo: 'Aguardando acerto', valor: resumo.viagensAguardandoAcerto, detalhe: 'viagens prontas para fechar', rota: '/acertos', acao: 'Ver acertos', ponto: 'bg-warning' })}
        ${cartaoResumo({ rotulo: 'Vencido a pagar', valor: moedaCurta(totalVencidoPagar), detalhe: resumo.contasPagarVencidas.length ? `${resumo.contasPagarVencidas.length} conta(s) · a mais antiga há ${maisAntiga} dia(s)` : 'nenhuma conta vencida', rota: '/contas-pagar', acao: 'Ver contas a pagar', ponto: 'bg-danger' })}
        ${cartaoResumo({ rotulo: 'Saldos de frete a receber', valor: moedaCurta(totalReceber), detalhe: `${resumo.saldosFretePendentes.length} saldo(s)${receberVencidos ? ` · ${receberVencidos} vencido(s)` : ''}`, rota: '/contas-receber', acao: 'Ver contas a receber', ponto: 'bg-success' })}
      </div>

      <div class="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <section class="card overflow-hidden">
          <div class="flex items-center gap-3 border-b border-line px-5 py-4">
            <h2 class="${TITULO_PAINEL}">Na estrada agora</h2><span class="badge-neutro">${resumo.viagensAtivas.length} viagem(ns)</span>
            <a href="#/viagens" class="ml-auto text-sm font-semibold text-accent-fg hover:underline">Ver todas &rarr;</a>
          </div>
          <div data-veiculos-viagem></div>
        </section>
        <section class="card overflow-hidden">
          <div class="flex items-center gap-3 border-b border-line px-5 py-4">
            <h2 class="${TITULO_PAINEL}">Precisa de atenção</h2><span class="badge-neutro">${atencao.length}</span>
            <a href="#/alertas" class="ml-auto text-sm font-semibold text-accent-fg hover:underline">Ver todos &rarr;</a>
          </div>
          <div data-atencao></div>
        </section>
      </div>

      <section class="card mt-4 hidden overflow-hidden" data-fluxo>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-5 py-4">
          <h2 class="${TITULO_PAINEL}">Fluxo de caixa previsto · 30 dias</h2>
          <div class="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500" data-fluxo-legenda></div>
        </div>
        <div class="px-3 pb-3 pt-2" data-fluxo-grafico></div>
      </section>
    `;

    container.querySelector('[data-onixsat-botao]').appendChild(criarBotaoSincronizarOnixsat({
      onAtualizar: () => { if (!modalAberto()) render(container); },
    }));

    container.querySelector('[data-veiculos-viagem]').innerHTML = resumo.viagensAtivas.length
      ? resumo.viagensAtivas.map(linhaViagem).join('')
      : '<p class="px-5 py-8 text-center text-sm text-slate-400">Nenhuma viagem em andamento.</p>';

    container.querySelector('[data-atencao]').innerHTML = atencao.length
      ? atencao.slice(0, 6).map(itemAtencao).join('') + (atencao.length > 6 ? `<p class="px-5 py-3 text-sm text-slate-400">+ ${atencao.length - 6} item(ns) em "Ver todos"</p>` : '')
      : '<p class="px-5 py-8 text-center text-sm text-slate-400">Nada pendente. Tudo em dia.</p>';

    // O fluxo depende dos modulos Contas a Pagar/Receber e de uma empresa ativa (nao funciona em "Todas"):
    // se qualquer chamada falhar, o painel some em silencio - o resto da tela nao depende dele.
    buscarFluxo(hojeIso).then(({ entradas, saidas }) => {
      const soma = (a) => a.reduce((s, v) => s + v, 0);
      const el = container.querySelector('[data-fluxo]');
      if (!el) return;
      el.classList.remove('hidden');
      el.querySelector('[data-fluxo-grafico]').innerHTML = graficoFluxo(entradas, saidas);
      el.querySelector('[data-fluxo-legenda]').innerHTML = `
        <span><i class="mr-1.5 inline-block h-[3px] w-3 rounded-sm bg-accent-fg align-middle"></i>Entradas ${moedaCurta(soma(entradas))}</span>
        <span><i class="mr-1.5 inline-block h-[3px] w-3 rounded-sm bg-warning align-middle"></i>Saídas ${moedaCurta(soma(saidas))}</span>
        <span class="font-semibold ${soma(entradas) - soma(saidas) >= 0 ? 'text-success' : 'text-danger'}">Saldo previsto ${moedaCurta(soma(entradas) - soma(saidas))}</span>`;
    }).catch(() => { /* painel opcional */ });
  } catch (err) {
    mostrarErro(err);
    container.innerHTML = '<p class="text-danger">Nao foi possivel carregar o painel.</p>';
  }
}
