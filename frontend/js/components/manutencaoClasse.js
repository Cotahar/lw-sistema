import { esc } from '../html.js';

// Manutencao tem duas origens (ver backend/src/utils/manutencoesHelper.js): a Ordem de Servico (revisao/reparo em oficina) e a
// manutencao de beira de estrada lancada como despesa da viagem. A etiqueta deixa clara a diferenca em qualquer tela.
const CLASSES = {
  Preventiva: { classe: 'badge-info', texto: 'OS · Preventiva', dica: 'Ordem de servico preventiva (revisao)' },
  Corretiva: { classe: 'badge-atencao', texto: 'OS · Corretiva', dica: 'Ordem de servico corretiva (reparo em oficina)' },
  Estrada: { classe: 'badge-critico', texto: 'Estrada · viagem', dica: 'Manutencao de beira de estrada, lancada como despesa da viagem do motorista' },
};

export const OPCOES_CLASSE = [
  { value: '', label: 'Todos' },
  { value: 'Preventiva', label: 'OS · Preventiva' },
  { value: 'Corretiva', label: 'OS · Corretiva' },
  { value: 'Estrada', label: 'Beira de estrada (viagem)' },
];

export function textoClasse(r) {
  return (CLASSES[r.classe || r.tipo] || { texto: r.tipo || '-' }).texto;
}

export function badgeClasse(r) {
  const c = CLASSES[r.classe || r.tipo];
  if (!c) return esc(r.tipo || '-');
  return `<span class="${c.classe}" title="${esc(c.dica)}">${c.texto}</span>`;
}

// "OS #12" ou "Viagem #3 · NOME DO MOTORISTA" - de onde veio o lancamento.
export function textoOrigem(r) {
  if (r.origem === 'Viagem') return `Viagem #${r.viagem_id}${r.motorista_nome ? ` · ${r.motorista_nome}` : ''}`;
  return `OS #${r.id}`;
}
