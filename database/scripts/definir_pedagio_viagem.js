// Define o pedagio INFORMATIVO de uma viagem (viagens.valor_pedagio, em
// centavos) quando o valor digitado na tela do acerto nao ficou gravado. Nao
// mexe em nenhum total do acerto. Registra a alteracao na auditoria.
//   node database/scripts/definir_pedagio_viagem.js <viagem_id> <centavos>          (simula)
//   node database/scripts/definir_pedagio_viagem.js <viagem_id> <centavos> --aplicar (grava)
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const [viagemIdArg, centavosArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const aplicar = process.argv.includes('--aplicar');
const viagemId = Number(viagemIdArg);
const centavos = Number(centavosArg);
if (!Number.isInteger(viagemId) || !Number.isInteger(centavos) || centavos < 0) {
  console.error('Uso: definir_pedagio_viagem.js <viagem_id> <valor_em_centavos> [--aplicar]');
  process.exit(1);
}

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);
try {
  const antes = db.prepare('SELECT * FROM viagens WHERE id = ?').get(viagemId);
  if (!antes) throw new Error(`Viagem #${viagemId} nao encontrada.`);
  console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO'} - viagem #${viagemId} (${antes.status}): pedagio ${antes.valor_pedagio} -> ${centavos} centavos`);
  if (aplicar) {
    db.exec('BEGIN');
    db.prepare('UPDATE viagens SET valor_pedagio = ? WHERE id = ?').run(centavos, viagemId);
    const depois = db.prepare('SELECT * FROM viagens WHERE id = ?').get(viagemId);
    db.prepare(`
      INSERT INTO logs_auditoria (empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois)
      VALUES (?, NULL, 'viagens', ?, 'UPDATE', ?, ?)
    `).run(antes.empresa_id, viagemId, JSON.stringify(antes), JSON.stringify(depois));
    db.exec('COMMIT');
    console.log('Pedagio gravado.');
  } else {
    console.log('Nada foi gravado. Rode com --aplicar.');
  }
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* sem transacao aberta */ }
  console.error('Abortado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
