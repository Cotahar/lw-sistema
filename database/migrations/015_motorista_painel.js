// Migracao unica: suporte ao painel novo do motorista (validacao de despesas
// lancadas pelo app, distincao Pago no ato/Assinar nota, e captura da
// telemetria de combustivel do tanque via Onixsat).
//   - despesas_viagem ganha:
//       forma_pagamento_posto: só para abastecimento lançado pelo app -
//         'Imediato' (contas_pagar criada na hora, como já era) ou
//         'AssinarNota' (contas_pagar só nasce quando o escritório validar
//         e informar o vencimento real, que o motorista não sabe).
//       validado_por/validado_em: NULL = pendente de validação (só
//         lançamentos vindos do app do motorista nascem assim; despesas do
//         escritório e importação Drivvo já nascem validadas).
//       despesa_arla_id: liga a despesa de diesel a sua Arla irma (hoje as
//         duas linhas nao tem elo nenhum) - usado na validacao para somar
//         os dois valores numa unica conta a pagar combinada.
//   - hodometro_eventos e veiculos ganham nivel_tanque_litros: a Onixsat
//     retorna "lt" (litros no tanque) em toda mensagem de posicao/hodometro
//     (RequestMensagemCB), mas o codigo atual descarta esse campo - ver
//     onixsatSync.js. Mesmo padrao cache+historico de hodometro_atual.
// Idempotente (checa antes de cada mudanca). Backfill: despesas ja
// existentes viram "ja validadas" (validado_em = criado_em), nenhuma
// aparece como pendente retroativamente.
// Rodar: `node database/migrations/015_motorista_painel.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

function adicionarColuna(tabela, nome, ddl) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all();
  if (colunas.some((c) => c.name === nome)) {
    console.log(`${tabela}.${nome} ja existia.`);
  } else {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${ddl}`);
    console.log(`${tabela}.${nome} adicionada.`);
  }
}

try {
  adicionarColuna('despesas_viagem', 'forma_pagamento_posto', "TEXT CHECK (forma_pagamento_posto IN ('Imediato', 'AssinarNota'))");
  adicionarColuna('despesas_viagem', 'validado_por', 'INTEGER REFERENCES usuarios(id)');
  adicionarColuna('despesas_viagem', 'validado_em', 'TEXT');
  adicionarColuna('despesas_viagem', 'despesa_arla_id', 'INTEGER REFERENCES despesas_viagem(id)');

  adicionarColuna('hodometro_eventos', 'nivel_tanque_litros', 'REAL');
  adicionarColuna('veiculos', 'nivel_tanque_litros', 'REAL');

  const resultado = db.prepare(`
    UPDATE despesas_viagem SET validado_por = criado_por, validado_em = criado_em WHERE validado_em IS NULL
  `).run();
  console.log(`${resultado.changes} despesa(s) existente(s) marcada(s) como ja validada(s) (backfill).`);

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
