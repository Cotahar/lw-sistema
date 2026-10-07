const db = require('../config/db');
const { hodometroDoConjuntoDoVeiculo, veiculosDoMesmoConjunto } = require('./conjuntoRelatorioHelper');

// Compara o hodometro atual do veiculo com as regras ativas dele e abre uma
// ocorrencia quando o intervalo e atingido (se ainda nao houver uma Pendente
// para a mesma regra). Chamado sempre que o hodometro de um veiculo muda
// (ajuste manual, integracao Onixsat, ou fechamento de viagem).
//
// O hodometro que vale e o do CONJUNTO: carreta nao tem hodometro proprio
// (so a tratora e atualizada), entao a regra de uma carreta conta os km
// rodados pela composicao dela - ver hodometroDoConjuntoDoVeiculo.
function verificarAlertasDoVeiculo(veiculoId) {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(veiculoId);
  if (!veiculo) return [];

  const regras = db.prepare('SELECT * FROM alertas_regras WHERE veiculo_id = ? AND ativo = 1').all(veiculoId);
  if (!regras.length) return [];
  const hodometro = hodometroDoConjuntoDoVeiculo(veiculo);
  const novasOcorrencias = [];

  for (const regra of regras) {
    if (hodometro - regra.km_referencia < regra.intervalo_km) continue;

    const jaPendente = db
      .prepare("SELECT id FROM alertas_ocorrencias WHERE regra_id = ? AND status = 'Pendente'")
      .get(regra.id);
    if (jaPendente) continue;

    const info = db.prepare(`
      INSERT INTO alertas_ocorrencias (empresa_id, regra_id, veiculo_id, km_atual_no_disparo)
      VALUES (?, ?, ?, ?)
    `).run(veiculo.empresa_id, regra.id, veiculoId, hodometro);
    novasOcorrencias.push(db.prepare('SELECT * FROM alertas_ocorrencias WHERE id = ?').get(info.lastInsertRowid));
  }

  return novasOcorrencias;
}

// Quando o hodometro de uma unidade muda, as regras de TODAS as unidades do
// conjunto dela (a carreta que anda junto com o cavalo) passam a ter km novo.
function verificarAlertasDoConjunto(veiculoId) {
  return veiculosDoMesmoConjunto(veiculoId).flatMap((id) => verificarAlertasDoVeiculo(id));
}

module.exports = { verificarAlertasDoVeiculo, verificarAlertasDoConjunto };
