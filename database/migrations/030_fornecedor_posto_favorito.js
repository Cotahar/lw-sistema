// Migracao unica: adiciona os campos de "posto favorito" em fornecedores -
// favorito (estrelinha), se assina nota por padrao, prazo em dias (usado
// pra calcular o vencimento automatico quando assina nota), forma de
// pagamento e preco ja acertado de diesel/arla. Generico o bastante pra
// nao exigir tabela nova (mesmo padrao de "localizacao", ja adicionado
// direto em fornecedores na migracao 018) - so fazem sentido pra postos,
// mas ficam disponiveis (nulos/zerados) pra qualquer fornecedor.
// Idempotente. Rodar: `node database/migrations/030_fornecedor_posto_favorito.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const COLUNAS = [
  { nome: 'favorito', sql: 'ALTER TABLE fornecedores ADD COLUMN favorito INTEGER NOT NULL DEFAULT 0 CHECK (favorito IN (0, 1))' },
  { nome: 'posto_assina_nota', sql: 'ALTER TABLE fornecedores ADD COLUMN posto_assina_nota INTEGER NOT NULL DEFAULT 0 CHECK (posto_assina_nota IN (0, 1))' },
  { nome: 'posto_prazo_dias', sql: 'ALTER TABLE fornecedores ADD COLUMN posto_prazo_dias INTEGER' },
  { nome: 'posto_forma_pagamento', sql: 'ALTER TABLE fornecedores ADD COLUMN posto_forma_pagamento TEXT' },
  { nome: 'posto_preco_diesel', sql: 'ALTER TABLE fornecedores ADD COLUMN posto_preco_diesel INTEGER' },
  { nome: 'posto_preco_arla', sql: 'ALTER TABLE fornecedores ADD COLUMN posto_preco_arla INTEGER' },
];

try {
  const colunasAtuais = db.prepare('PRAGMA table_info(fornecedores)').all().map((c) => c.name);
  for (const coluna of COLUNAS) {
    if (!colunasAtuais.includes(coluna.nome)) {
      db.exec(coluna.sql);
      console.log(`fornecedores.${coluna.nome} adicionada.`);
    } else {
      console.log(`fornecedores.${coluna.nome} ja existia.`);
    }
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
