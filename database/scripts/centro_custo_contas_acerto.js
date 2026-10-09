// Coloca a conta a pagar de cada ACERTO (saldo a pagar ao motorista) no centro de custo
// do CAVALO da viagem (a unidade tratora manda no conjunto). Mexe so em contas com
// origem_tipo = 'AcertoViagem' cujo centro de custo esta vazio ou diferente do cavalo.
//   node database/scripts/centro_custo_contas_acerto.js            (simula)
//   node database/scripts/centro_custo_contas_acerto.js --aplicar  (grava)
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const aplicar = process.argv.includes('--aplicar');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const contas = db.prepare(`
  SELECT cp.id AS conta_id, cp.descricao, cp.status, cp.centro_custo_id AS centro_atual, a.id AS acerto_id, vg.id AS viagem_id, vg.conjunto_id,
         (SELECT v.id FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id
          WHERE ci.conjunto_id = vg.conjunto_id AND v.tipo IN ('Cavalo', 'Truck', 'Toco') ORDER BY ci.ordem LIMIT 1) AS tratora_id
  FROM contas_pagar cp
  JOIN acertos_viagem a ON a.id = cp.origem_id
  JOIN viagens vg ON vg.id = a.viagem_id
  WHERE cp.origem_tipo = 'AcertoViagem'
  ORDER BY cp.id
`).all();

console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO'} - ${contas.length} conta(s) de acerto`);
let alteradas = 0;
try {
  if (aplicar) db.exec('BEGIN');
  for (const c of contas) {
    const centro = c.tratora_id ? db.prepare('SELECT id, nome FROM centros_custo WHERE veiculo_id = ?').get(c.tratora_id) : null;
    const atual = c.centro_atual ? db.prepare('SELECT id, nome FROM centros_custo WHERE id = ?').get(c.centro_atual) : null;
    if (!centro) { console.log(`  #${c.conta_id} (viagem #${c.viagem_id}): cavalo sem centro de custo - nada a fazer`); continue; }
    if (c.centro_atual === centro.id) { console.log(`  #${c.conta_id} (viagem #${c.viagem_id}): ja esta em ${centro.nome}`); continue; }
    console.log(`  #${c.conta_id} (viagem #${c.viagem_id}, ${c.status}): ${atual ? atual.nome : '(vazio)'} -> ${centro.nome}`);
    alteradas++;
    if (aplicar) {
      db.prepare('UPDATE contas_pagar SET centro_custo_id = ? WHERE id = ?').run(centro.id, c.conta_id);
      db.prepare(`INSERT INTO logs_auditoria (empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois)
                  VALUES ((SELECT empresa_id FROM contas_pagar WHERE id = ?), NULL, 'contas_pagar', ?, 'UPDATE', ?, ?)`)
        .run(c.conta_id, c.conta_id, JSON.stringify({ centro_custo_id: c.centro_atual }), JSON.stringify({ centro_custo_id: centro.id }));
    }
  }
  if (aplicar) db.exec('COMMIT');
  console.log(aplicar ? `Concluido: ${alteradas} conta(s) ajustada(s).` : `Simulacao: ${alteradas} conta(s) seriam ajustadas. Rode com --aplicar para gravar.`);
} catch (err) {
  if (aplicar) db.exec('ROLLBACK');
  console.error('ERRO:', err.message);
  process.exitCode = 1;
}
