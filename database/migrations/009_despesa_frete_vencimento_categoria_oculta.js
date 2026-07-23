// Migracao unica: adiciona frete_id e data_vencimento em despesas_viagem
// (vinculo com o frete especifico da viagem, e vencimento para despesas
// faturadas ligadas ao Contas a Pagar); adiciona oculta_na_busca em
// categorias_despesa e marca a categoria 'Arla' como oculta (ela some da
// busca de categoria no formulario de despesa, mas continua existindo -
// os lancamentos de Arla passam a ser criados via o bloco expansivel
// dentro de Abastecimento, nao mais escolhida diretamente). Idempotente.
// Rodar: `node database/migrations/009_despesa_frete_vencimento_categoria_oculta.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunasDespesa = db.prepare('PRAGMA table_info(despesas_viagem)').all();
  if (!colunasDespesa.some((c) => c.name === 'frete_id')) {
    db.exec('ALTER TABLE despesas_viagem ADD COLUMN frete_id INTEGER REFERENCES fretes(id)');
    console.log('despesas_viagem.frete_id adicionada.');
  } else {
    console.log('despesas_viagem.frete_id ja existia.');
  }
  if (!colunasDespesa.some((c) => c.name === 'data_vencimento')) {
    db.exec('ALTER TABLE despesas_viagem ADD COLUMN data_vencimento TEXT');
    console.log('despesas_viagem.data_vencimento adicionada.');
  } else {
    console.log('despesas_viagem.data_vencimento ja existia.');
  }
  if (!colunasDespesa.some((c) => c.name === 'contas_pagar_id')) {
    db.exec('ALTER TABLE despesas_viagem ADD COLUMN contas_pagar_id INTEGER REFERENCES contas_pagar(id)');
    console.log('despesas_viagem.contas_pagar_id adicionada.');
  } else {
    console.log('despesas_viagem.contas_pagar_id ja existia.');
  }

  const colunasCategoria = db.prepare('PRAGMA table_info(categorias_despesa)').all();
  if (!colunasCategoria.some((c) => c.name === 'oculta_na_busca')) {
    db.exec("ALTER TABLE categorias_despesa ADD COLUMN oculta_na_busca INTEGER NOT NULL DEFAULT 0 CHECK (oculta_na_busca IN (0, 1))");
    console.log('categorias_despesa.oculta_na_busca adicionada.');
  } else {
    console.log('categorias_despesa.oculta_na_busca ja existia.');
  }

  const arla = db.prepare("SELECT id, oculta_na_busca FROM categorias_despesa WHERE lower(trim(nome)) = 'arla'").get();
  if (arla && !arla.oculta_na_busca) {
    db.exec(`UPDATE categorias_despesa SET oculta_na_busca = 1 WHERE id = ${arla.id}`);
    console.log('Categoria Arla marcada como oculta_na_busca.');
  } else if (arla) {
    console.log('Categoria Arla ja estava oculta.');
  } else {
    console.log('AVISO: categoria "Arla" nao encontrada - crie manualmente e marque oculta_na_busca=1, ou rode a migracao de novo depois de cria-la.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
