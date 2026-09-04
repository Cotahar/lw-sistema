const db = require('../config/db');

function somar(lista) {
  return lista.reduce((total, valor) => total + (valor || 0), 0);
}

// Media de consumo "tanque cheio a tanque cheio" - o unico jeito confiavel
// de medir litros/km reais (abastecer so uma parte do tanque pra chegar a um
// posto mais barato nao deixa saber quanto sobrou, entao so um evento
// marcado como "tanque completo" fecha a conta com certeza).
//
// So entra na conta abastecimento de Abastecimento (diesel - Arla nao e
// combustivel do motor) com km_abastecimento preenchido. Entre dois
// "tanque completo" consecutivos (ordenados por km), a janela soma TODOS os
// litros no meio (parciais + o cheio que fecha a janela) - o cheio que ABRE
// a janela nao entra (aqueles litros ja foram gastos ANTES da janela
// comecar). Precisa de pelo menos 2 eventos "tanque completo" na viagem;
// antes disso (ou o trecho apos o ultimo tanque completo) nao ha como saber
// o consumo com certeza - retorna null em vez de arriscar um numero errado.
//
// mediaViagemKmL: do primeiro ao ultimo "tanque completo" (a viagem toda que
// da pra confirmar). mediaUltimaAbastecidaKmL: so a ultima janela (penultimo
// ao ultimo "tanque completo") - reflete a condicao mais recente (rota,
// carga, jeito de dirigir), a media da viagem toda e um indicador mais lento
// pra reagir.
function calcularMediasConsumo(despesas, categoriaAbastecimentoId) {
  const abastecimentos = despesas
    .filter((d) => d.categoria_id === categoriaAbastecimentoId && d.km_abastecimento != null && d.litragem)
    .sort((a, b) => a.km_abastecimento - b.km_abastecimento);

  const indicesCompletos = [];
  abastecimentos.forEach((d, i) => { if (d.tanque_completo) indicesCompletos.push(i); });

  if (indicesCompletos.length < 2) {
    return { mediaViagemKmL: null, mediaUltimaAbastecidaKmL: null };
  }

  function mediaEntre(idxInicio, idxFim) {
    const km = abastecimentos[idxFim].km_abastecimento - abastecimentos[idxInicio].km_abastecimento;
    const litros = somar(abastecimentos.slice(idxInicio + 1, idxFim + 1).map((d) => d.litragem));
    return litros > 0 && km > 0 ? km / litros : null;
  }

  const primeiro = indicesCompletos[0];
  const ultimo = indicesCompletos[indicesCompletos.length - 1];
  const mediaViagemKmL = mediaEntre(primeiro, ultimo);

  const penultimo = indicesCompletos.length >= 2 ? indicesCompletos[indicesCompletos.length - 2] : null;
  const mediaUltimaAbastecidaKmL = penultimo !== null ? mediaEntre(penultimo, ultimo) : null;

  return { mediaViagemKmL, mediaUltimaAbastecidaKmL };
}

function buscarCategoriaAbastecimentoId() {
  const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  return categoria ? categoria.id : null;
}

module.exports = { calcularMediasConsumo, buscarCategoriaAbastecimentoId };
