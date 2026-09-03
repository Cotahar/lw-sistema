// Diagnostico pontual (read-only): confere o DEFAULT real gravado em TODAS
// as tabelas do banco vivo, procurando datetime('now')/date('now') sem o
// ajuste de -3h (fuso Brasilia). Usuario reportou horario de inclusao de
// ocorrencias 3h adiantado. Le direto do sqlite_master, que reflete o que
// REALMENTE esta em vigor na tabela viva - editar o texto de uma migracao
// depois que ela ja rodou nao muda o DEFAULT de uma tabela ja criada.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const tabelas = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();

console.log('=== Colunas com datetime(\'now\')/date(\'now\') SEM ajuste -3h ===');
let totalAfetadas = 0;
for (const { name, sql } of tabelas) {
  const linhas = sql.split('\n').filter((l) => /datetime\('now'\)|date\('now'\)/i.test(l) && !/-3 hours/i.test(l));
  if (linhas.length) {
    totalAfetadas++;
    console.log(`\n${name}:`);
    linhas.forEach((l) => console.log('  ' + l.trim()));
  }
}
console.log(`\nTotal de tabelas afetadas: ${totalAfetadas}`);

console.log('\n=== Colunas JA corretas (com -3 hours), para referencia ===');
for (const { name, sql } of tabelas) {
  const linhas = sql.split('\n').filter((l) => /-3 hours/i.test(l));
  if (linhas.length) console.log(`${name}: ${linhas.map((l) => l.trim()).join(' | ')}`);
}

console.log('\n=== hora atual do container vs esperado Brasilia ===');
console.log('datetime(\'now\')            (UTC, sem ajuste):', db.prepare("SELECT datetime('now') AS v").get().v);
console.log('datetime(\'now\',\'-3 hours\')  (Brasilia, correto):', db.prepare("SELECT datetime('now', '-3 hours') AS v").get().v);

db.close();
