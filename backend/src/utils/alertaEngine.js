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
//
// O intervalo e contado DESDE O KM 0: uma regra de 25.000 em 25.000 km alerta em
// 25.000, 50.000, 75.000... - nao "km em que foi cadastrada + 25.000". Se o
// caminhao esta com 28.000 km quando a regra e cadastrada, o proximo alerta e em
// 50.000. A km_referencia (km do cadastro ou do ultimo alerta resolvido) so diz
// "de onde partir"; o proximo alerta e sempre o proximo multiplo do intervalo
// acima dela (ver proximoKmDoAlerta).
function proximoKmDoAlerta(regra) {
  return (Math.floor(regra.km_referencia / regra.intervalo_km) + 1) * regra.intervalo_km;
}

function verificarAlertasDoVeiculo(veiculoId) {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(veiculoId);
  if (!veiculo) return [];

  const regras = db.prepare('SELECT * FROM alertas_regras WHERE veiculo_id = ? AND ativo = 1').all(veiculoId);
  if (!regras.length) return [];
  const hodometro = hodometroDoConjuntoDoVeiculo(veiculo);
  const novasOcorrencias = [];

  for (const regra of regras) {
    if (hodometro < proximoKmDoAlerta(regra)) continue;

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

module.exports = { verificarAlertasDoVeiculo, verificarAlertasDoConjunto, proximoKmDoAlerta };
