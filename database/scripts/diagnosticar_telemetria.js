// Script de diagnostico pontual (read-only) - investiga por que a "media
// rastreador" (telemetria de tanque) do painel do motorista aparece "-".
// Nao faz parte da cadeia de migracoes.
// Rodar: `node database/scripts/diagnosticar_telemetria.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log('=== veiculos.nivel_tanque_litros (todos) ===');
console.log(JSON.stringify(db.prepare('SELECT id, placa, tipo, hodometro_atual, nivel_tanque_litros FROM veiculos').all(), null, 2));

console.log('\n=== hodometro_eventos com nivel_tanque_litros preenchido (ultimos 5) ===');
console.log(JSON.stringify(db.prepare('SELECT id, veiculo_id, km, nivel_tanque_litros, data_hora FROM hodometro_eventos WHERE nivel_tanque_litros IS NOT NULL ORDER BY id DESC LIMIT 5').all(), null, 2));

console.log('\n=== hodometro_eventos totais (ultimos 5, com ou sem nivel_tanque) ===');
console.log(JSON.stringify(db.prepare('SELECT id, veiculo_id, km, nivel_tanque_litros, origem, data_hora FROM hodometro_eventos ORDER BY id DESC LIMIT 5').all(), null, 2));

console.log('\n=== viagens EmAndamento + despesas de Abastecimento com km_abastecimento ===');
const viagens = db.prepare("SELECT id, conjunto_id, motorista_id FROM viagens WHERE status = 'EmAndamento'").all();
console.log(JSON.stringify(viagens, null, 2));
for (const v of viagens) {
  const despesas = db.prepare(`
    SELECT dv.id, dv.categoria_id, cat.nome AS categoria, dv.km_abastecimento, dv.criado_em
    FROM despesas_viagem dv JOIN categorias_despesa cat ON cat.id = dv.categoria_id
    WHERE dv.viagem_id = ? AND lower(trim(cat.nome)) = 'abastecimento'
    ORDER BY dv.id DESC
  `).all(v.id);
  console.log(`viagem #${v.id} despesas Abastecimento:`, JSON.stringify(despesas, null, 2));
}

db.close();
