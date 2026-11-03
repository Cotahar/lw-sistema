const fs = require('node:fs');
const path = require('node:path');
const { withTransaction } = require('./transaction');

// Migracoes AUTOMATICAS: rodam sozinhas quando o servidor sobe, antes de qualquer rota usar o banco.
// Antes eram so scripts manuais (`railway ssh` + `node database/migrations/NNN_...js`): esquecer de rodar
// depois do deploy quebrava a tela que usava a coluna nova ate alguem perceber.
//
// Regras (ver database/migrations/LEIAME.md):
//  - a partir da 037, todo arquivo database/migrations/NNN_nome.js exporta `up(db)`; as 000-036 sao os
//    scripts manuais antigos (rodam ao serem carregados) e NUNCA sao executadas aqui;
//  - cada uma roda uma vez so (tabela schema_migracoes), em ordem, numa transacao: se falhar, nada dela
//    fica gravado e o servidor nao sobe (melhor fora do ar do que codigo novo num banco velho);
//  - antes de aplicar qualquer pendente, o banco e copiado para a pasta de backups;
//  - banco NOVO nasce do schema.sql, que ja tem tudo: as migracoes so sao marcadas como aplicadas.
//    Por isso toda migracao nova tambem precisa estar refletida no schema.sql.
const PRIMEIRA_AUTOMATICA = 37;
const PASTA_PADRAO = path.resolve(__dirname, '../../../database/migrations');

function listarMigracoesAutomaticas(pasta = PASTA_PADRAO) {
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta)
    .map((arquivo) => ({ arquivo, m: arquivo.match(/^(\d{3})_[\w-]+\.js$/) }))
    .filter((x) => x.m && Number(x.m[1]) >= PRIMEIRA_AUTOMATICA)
    .map((x) => ({ nome: x.arquivo.replace(/\.js$/, ''), caminho: path.join(pasta, x.arquivo) }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

function garantirTabela(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migracoes (
      nome        TEXT PRIMARY KEY,
      aplicada_em TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
    )
  `);
}

// Copia consistente do banco antes de mexer na estrutura (VACUUM INTO, mesmo mecanismo do backup diario).
function backupAntesDaMigracao(db, pastaBackups, primeira) {
  fs.mkdirSync(pastaBackups, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const destino = path.join(pastaBackups, `frotista-antes-da-migracao-${primeira}-${carimbo}.db`);
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  return destino;
}

function aplicarMigracoes({ db, bancoNovo = false, pasta = PASTA_PADRAO, pastaBackups, log = console }) {
  garantirTabela(db);
  const aplicadas = new Set(db.prepare('SELECT nome FROM schema_migracoes').all().map((r) => r.nome));
  const pendentes = listarMigracoesAutomaticas(pasta).filter((m) => !aplicadas.has(m.nome));
  if (!pendentes.length) return { aplicadas: [], marcadas: [] };

  const registrar = db.prepare('INSERT INTO schema_migracoes (nome) VALUES (?)');
  if (bancoNovo) {
    for (const m of pendentes) registrar.run(m.nome);
    return { aplicadas: [], marcadas: pendentes.map((m) => m.nome) };
  }

  const copia = pastaBackups ? backupAntesDaMigracao(db, pastaBackups, pendentes[0].nome) : null;
  if (copia) log.log(`Migracoes pendentes: ${pendentes.map((m) => m.nome).join(', ')}. Banco copiado antes para ${path.basename(copia)}.`);

  const feitas = [];
  for (const m of pendentes) {
    const migracao = require(m.caminho); // eslint-disable-line global-require, import/no-dynamic-require
    if (typeof migracao.up !== 'function') throw new Error(`Migracao ${m.nome} nao exporta up(db).`);
    // Recriar tabela (ALTER que o SQLite nao tem) exige chaves estrangeiras desligadas, e isso so muda FORA
    // de transacao. A migracao pede com `desligarChavesEstrangeiras: true`; a integridade e conferida no fim.
    if (migracao.desligarChavesEstrangeiras) db.exec('PRAGMA foreign_keys = OFF');
    try {
      withTransaction(db, () => {
        migracao.up(db);
        if (migracao.desligarChavesEstrangeiras) {
          const quebradas = db.prepare('PRAGMA foreign_key_check').all();
          if (quebradas.length) throw new Error(`${quebradas.length} referencia(s) quebrada(s) apos a migracao.`);
        }
        registrar.run(m.nome);
      });
    } catch (err) {
      throw new Error(`Migracao ${m.nome} FALHOU e foi desfeita: ${err.message}`);
    } finally {
      if (migracao.desligarChavesEstrangeiras) db.exec('PRAGMA foreign_keys = ON');
    }
    feitas.push(m.nome);
    log.log(`Migracao aplicada: ${m.nome}`);
  }
  return { aplicadas: feitas, marcadas: [], copia };
}

module.exports = { aplicarMigracoes, listarMigracoesAutomaticas, PRIMEIRA_AUTOMATICA };
