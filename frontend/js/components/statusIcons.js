import { hojeIsoLocal } from '../masks.js';

// Icones SVG pros badges de status (multas, alertas, pneus) - a cor sozinha
// nao chega pra quem tem daltonismo distinguir sucesso/atencao/critico;
// forma (check/triangulo/x) da o segundo sinal. `mr-1 inline h-3 w-3`
// deixa do tamanho certo dentro de um .badge (ver input.css).
export const ICONE_SUCESSO = '<svg class="mr-1 inline h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M20 6L9 17l-5-5"/></svg>';
export const ICONE_ATENCAO = '<svg class="mr-1 inline h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.3 3.9L2.7 17a2 2 0 001.7 3h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>';
export const ICONE_CRITICO = '<svg class="mr-1 inline h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M15 9l-6 6M9 9l6 6"/></svg>';
export const ICONE_NEUTRO = '<svg class="mr-1 inline h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>';

// Etiqueta "N dia(s)" / "vence hoje" / "N dia(s) vencido" ao lado de um vencimento em aberto (Contas a Pagar,
// Contas a Receber, Saldos em Aberto). Aparece desde a criacao, nao so depois de vencido - pedido do usuario.
// Nao existe status 'Atrasado' gravado: e sempre a data x hoje. Quitado nao mostra nada.
export function badgePrazoVencimento(dataIso, quitado) {
  if (quitado || !dataIso) return '';
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00Z`);
  const dias = Math.round((new Date(`${dataIso}T00:00:00Z`) - hoje) / 86400000);
  const cor = dias < 0 ? 'badge-critico' : dias <= 5 ? 'badge-atencao' : 'badge-neutro';
  const texto = dias < 0 ? `${Math.abs(dias)} dia(s) vencido` : dias === 0 ? 'vence hoje' : `${dias} dia(s)`;
  return `<span class="${cor} ml-1">${texto}</span>`;
}
