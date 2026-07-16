const db = require('../config/db');

// A "unidade tratora" de um conjunto e o veiculo autopropulsado que carrega o
// hodometro real da composicao (Cavalo, ou Truck/Toco quando rodam sozinhos,
// sem cavalo mecanico). E dela que puxamos o km_inicial sugerido da proxima
// viagem e o centro de custo ao qual a receita/despesa da viagem pertence.
function buscarUnidadeTratora(conjuntoId) {
  return db.prepare(`
    SELECT v.* FROM conjunto_itens ci
    JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.conjunto_id = ? AND v.tipo IN ('Cavalo', 'Truck', 'Toco')
    ORDER BY ci.ordem
    LIMIT 1
  `).get(conjuntoId);
}

function buscarCentroCustoDoVeiculo(veiculoId) {
  return db.prepare('SELECT * FROM centros_custo WHERE veiculo_id = ?').get(veiculoId);
}

module.exports = { buscarUnidadeTratora, buscarCentroCustoDoVeiculo };
