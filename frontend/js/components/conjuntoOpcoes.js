import { get } from '../api.js';

// Opcoes de "Conjunto" (composicao: cavalo + carreta) para os filtros dos
// relatorios e das telas: "NOME (PLACA1 + PLACA2)". Segue o formato esperado
// por criarSearchableSelect/criarMultiSearchableSelect (value + label).
export function rotuloConjunto(c) {
  return `${c.nome || `Conjunto #${c.id}`} (${c.itens.map((i) => i.placa).join(' + ')})`;
}

export async function buscarConjuntos(termo) {
  const conjuntos = await get('/conjuntos');
  const t = (termo || '').toLowerCase();
  return conjuntos
    .map((c) => ({ value: c.id, label: rotuloConjunto(c) }))
    .filter((o) => !t || o.label.toLowerCase().includes(t));
}
