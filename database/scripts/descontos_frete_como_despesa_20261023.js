// Baixas do tipo DESCONTO dos fretes (seguro de carga, gerenciadora de risco, cintas...) passam a ser DESPESA da placa no DRE
// (categoria DESCONTO NO FRETE, na data da baixa). Este script cria a despesa das baixas de desconto que JA existiam.
// Pedagio abatido do frete continua so receita (decisao do usuario, 23/10/2026).
//   node database/scripts/descontos_frete_como_despesa_20261023.js            (so mostra)
//   node database/scripts/descontos_frete_como_despesa_20261023.js --aplicar
// Idempotente: pula baixa que ja tem despesa.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const aplicar = process.argv.includes('--aplicar');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const NOME_CATEGORIA = 'DESCONTO NO FRETE';
const baixas = db.prepare(`
  SELECT b.*, cr.frete_id, cr.centro_custo_id, cc.nome AS centro_nome
  FROM contas_receber_baixas b
  JOIN contas_receber cr ON cr.id = b.contas_receber_id
  JOIN centros_custo cc ON cc.id = cr.centro_custo_id
  WHERE b.tipo = 'Desconto' ORDER BY b.data, b.id
`).all();

const pendentes = baixas.filter((b) => !b.despesa_fixa_id || !db.prepare('SELECT id FROM despesas_fixas WHERE id = ?').get(b.despesa_fixa_id));
const total = pendentes.reduce((t, b) => t + b.valor, 0);
console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO'} - ${baixas.length} baixa(s) de desconto, ${pendentes.length} ainda sem despesa (R$ ${(total / 100).toFixed(2)}):`);
const porCentro = {};
for (const b of pendentes) {
  porCentro[b.centro_nome] = (porCentro[b.centro_nome] || 0) + b.valor;
  console.log(`  baixa #${b.id} frete #${b.frete_id} ${b.data} ${b.centro_nome} R$ ${(b.valor / 100).toFixed(2)} ${b.descricao || ''}`);
}
console.log('Por placa:', Object.entries(porCentro).map(([c, v]) => `${c} R$ ${(v / 100).toFixed(2)}`).join(' | '));
if (!aplicar) { console.log('\nNada foi alterado. Para aplicar: --aplicar'); process.exit(0); }

try {
  db.exec('BEGIN');
  let categoria = db.prepare('SELECT id FROM categorias_despesa WHERE nome = ?').get(NOME_CATEGORIA);
  if (!categoria) categoria = { id: db.prepare('INSERT INTO categorias_despesa (nome) VALUES (?)').run(NOME_CATEGORIA).lastInsertRowid };
  for (const b of pendentes) {
    const info = db.prepare('INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, descricao) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(b.empresa_id, b.centro_custo_id, categoria.id, b.valor, b.data, `DESCONTO DO FRETE #${b.frete_id}${b.descricao ? ` - ${b.descricao}` : ''}`);
    const despesa = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(info.lastInsertRowid);
    db.prepare('UPDATE contas_receber_baixas SET despesa_fixa_id = ? WHERE id = ?').run(despesa.id, b.id);
    db.prepare("INSERT INTO logs_auditoria (empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois) VALUES (?, NULL, 'despesas_fixas', ?, 'INSERT', NULL, ?)")
      .run(b.empresa_id, despesa.id, JSON.stringify(despesa));
  }
  db.exec('COMMIT');
  console.log(`\nConcluido: ${pendentes.length} despesa(s) criada(s).`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('ERRO (nada foi alterado):', err.message);
  process.exitCode = 1;
}
