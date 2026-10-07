// Corrige a data prevista de recebimento (contas_receber.data_prevista) dos
// fretes cadastrados ANTES da regra "descarga + 3 dias": quando o usuario nao
// informava a previsao, o sistema gravava o INICIO DA VIAGEM - fretes de
// viagens longas apareciam "vencidos ha 40 dias" no mesmo dia do cadastro.
//
// Corrige so os recebiveis ainda NAO totalmente recebidos cuja previsao e
// exatamente o inicio da viagem (a assinatura do bug). Nova data = (data de
// descarga, senao data de carregamento, senao o dia do cadastro) + 3 dias.
//
// Por padrao so SIMULA (mostra o que mudaria). Para gravar: --aplicar
//   node database/scripts/corrigir_previsao_recebimento.js
//   node database/scripts/corrigir_previsao_recebimento.js --aplicar
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const aplicar = process.argv.includes('--aplicar');
const db = new DatabaseSync(DB_PATH);

function somarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

try {
  const candidatos = db.prepare(`
    SELECT cr.id, cr.frete_id, f.viagem_id, cr.status, cr.data_prevista,
           f.data_descarga, f.data_carregamento, date(cr.criado_em) AS cadastro, vg.data_inicio
    FROM contas_receber cr
    JOIN fretes f ON f.id = cr.frete_id
    JOIN viagens vg ON vg.id = f.viagem_id
    WHERE cr.status != 'Recebido' AND cr.data_prevista = vg.data_inicio
    ORDER BY cr.id
  `).all();

  console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO (nada sera gravado)'} - ${candidatos.length} recebivel(is) com previsao igual ao inicio da viagem:\n`);
  const atualizar = db.prepare('UPDATE contas_receber SET data_prevista = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const c of candidatos) {
      const base = c.data_descarga || c.data_carregamento || c.cadastro;
      const origem = c.data_descarga ? 'descarga' : c.data_carregamento ? 'carregamento' : 'cadastro';
      const nova = somarDias(base, 3);
      console.log(`  conta #${c.id} (frete #${c.frete_id}, viagem #${c.viagem_id}, ${c.status}): ${c.data_prevista} -> ${nova}  [${origem} ${base} + 3 dias]`);
      if (aplicar && nova !== c.data_prevista) atualizar.run(nova, c.id);
    }
    db.exec(aplicar ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(aplicar ? '\nDatas atualizadas.' : '\nNada foi gravado. Rode com --aplicar para gravar.');
} catch (err) {
  console.error('\nAbortado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
