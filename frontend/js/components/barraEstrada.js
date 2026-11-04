import { esc } from '../html.js';

// Barra de progresso da viagem (rota do roteirizador): trilho tracejado de pista, trecho percorrido em azul e o
// caminhao na posicao atual. So desenha o marcador quando ha percentual de verdade (rota + posicao do rastreador);
// sem isso mostra so o que se sabe - nunca um progresso inventado. `rota` vem de viagensAtivas[].rota (Painel) ou de
// viagem.rota (painel do motorista); sem rota (roteirizador desligado, viagem sem frete) devolve ''.
// compacto: texto do progresso numa linha propria, abaixo de origem/destino (cabe na tela estreita do celular).
export function barraEstradaHtml(rota, { compacto = false } = {}) {
  if (!rota) return '';
  const km = (n) => Math.round(n).toLocaleString('pt-BR');
  const total = rota.distancia_prevista_km;
  const pct = rota.percentual;
  let centro;
  if (total == null) {
    centro = rota.calculando ? 'Calculando a rota...' : 'Rota indisponível';
  } else if (pct != null) {
    const horas = rota.restante_min != null ? ` (~${Math.floor(rota.restante_min / 60)} h ${String(rota.restante_min % 60).padStart(2, '0')} min)` : '';
    centro = `${km(total - rota.restante_km)} de ${km(total)} km · faltam ${km(rota.restante_km)} km${horas}`;
  } else {
    centro = `Rota prevista: ${km(total)} km${rota.posicao_conhecida ? ' · calculando a posição...' : ' · sem posição do rastreador'}`;
  }
  const trilho = `
    <div class="estrada" role="img" aria-label="Progresso da viagem">
      <span class="estrada-trilho"></span>
      ${pct != null ? `<span class="estrada-feito" style="width:${pct}%"></span><span class="estrada-caminhao" style="left:${pct}%"></span>` : ''}
    </div>`;
  const origem = `<span class="truncate">${esc(rota.origem.split('/')[0])}</span>`;
  const destino = `<span class="truncate text-right">${esc(rota.destino.split('/')[0])}</span>`;
  if (compacto) {
    return `${trilho}
      <div class="mt-1 flex items-center justify-between gap-3 text-sm text-slate-400">${origem}${destino}</div>
      <p class="mt-1 text-sm font-semibold text-slate-500">${centro}</p>`;
  }
  return `${trilho}
    <div class="mt-1 flex items-center justify-between gap-3 text-xs text-slate-400">
      ${origem}
      <b class="whitespace-nowrap font-semibold text-slate-500">${centro}</b>
      ${destino}
    </div>`;
}
