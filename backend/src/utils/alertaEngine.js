const db = require('../config/db');

// Compara o hodometro atual do veiculo com as regras ativas dele e abre uma
// ocorrencia quando o intervalo e atingido (se ainda nao houver uma Pendente
// para a mesma regra). Chamado sempre que o hodometro de um veiculo muda
// (ajuste manual, futura integracao Onixsat, ou fechamento de viagem).
function verificarAlertasDoVeiculo(veiculoId) {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(veiculoId);
  if (!veiculo) return [];

  const regras = db.prepare('SELECT * FROM alertas_regras WHERE veiculo_id = ? AND ativo = 1').all(veiculoId);
  const novasOcorrencias = [];

  for (const regra of regras) {
    if (veiculo.hodometro_atual - regra.km_referencia < regra.intervalo_km) continue;

    const jaPendente = db
      .prepare("SELECT id FROM alertas_ocorrencias WHERE regra_id = ? AND status = 'Pendente'")
      .get(regra.id);
    if (jaPendente) continue;

    const info = db.prepare(`
      INSERT INTO alertas_ocorrencias (empresa_id, regra_id, veiculo_id, km_atual_no_disparo)
      VALUES (?, ?, ?, ?)
    `).run(veiculo.empresa_id, regra.id, veiculoId, veiculo.hodometro_atual);
    novasOcorrencias.push(db.prepare('SELECT * FROM alertas_ocorrencias WHERE id = ?').get(info.lastInsertRowid));
  }

  return novasOcorrencias;
}

module.exports = { verificarAlertasDoVeiculo };
