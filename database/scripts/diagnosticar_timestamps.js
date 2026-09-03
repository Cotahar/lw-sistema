// Diagnostico pontual (read-only): confere o DEFAULT real gravado em cada
// tabela candidata a ter o bug "datetime('now') sem ajuste de -3h" (usuario
// reportou horario de inclusao de ocorrencias 3h adiantado). Le direto do
// sqlite_master, que reflete o que REALMENTE esta em vigor na tabela viva -
// editar o texto de uma migracao depois que ela ja rodou nao muda o DEFAULT
// de uma tabela ja criada.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const TABELAS = [
  'ocorrencias', 'alertas_ocorrencias', 'multas', 'checklist_vistorias',
  'logs_auditoria', 'usuarios', 'motoristas', 'veiculos', 'despesas_viagem',
  'viagens', 'fretes', 'contas_pagar', 'contas_receber', 'contas_receber_baixas',
];

for (const tabela of TABELAS) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela);
  if (!row) { console.log(`${tabela}: TABELA NAO EXISTE`); continue; }
  const linhasComDatetime = row.sql.split('\n').filter((l) => /datetime\(|DEFAULT.*date\(/i.test(l));
  if (!linhasComDatetime.length) { console.log(`${tabela}: sem coluna datetime('now')/date('now') automatica`); continue; }
  console.log(`\n=== ${tabela} ===`);
  linhasComDatetime.forEach((l) => console.log('  ' + l.trim()));
}

console.log('\n=== hora atual do container vs esperado Brasilia ===');
console.log('datetime(\'now\')          (UTC, sem ajuste):', db.prepare("SELECT datetime('now') AS v").get().v);
console.log('datetime(\'now\',\'-3 hours\') (Brasilia, correto):', db.prepare("SELECT datetime('now', '-3 hours') AS v").get().v);

console.log('\n=== ultimas 3 ocorrencias (se houver) ===');
console.log(JSON.stringify(db.prepare('SELECT id, criado_em FROM ocorrencias ORDER BY id DESC LIMIT 3').all(), null, 2));

db.close();
