import { esc } from '../html.js';

// Placa Mercosul como "chip" de identificacao do veiculo (assinatura visual do sistema):
// faixa azul "BRASIL" no topo, caracteres em fonte mono sobre fundo claro. So decoracao ao
// redor do texto - a placa continua sendo texto selecionavel/pesquisavel. Estilo em
// src/input.css (.placa). Sem valor (veiculo nao informado) devolve "-", como as tabelas fazem.
export function placaHtml(placa, { pequena = false } = {}) {
  if (!placa) return '-';
  return `<span class="placa${pequena ? ' placa-sm' : ''}"><i aria-hidden="true">BRASIL</i><b>${esc(placa)}</b></span>`;
}
