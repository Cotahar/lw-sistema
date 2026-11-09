// Multas: (1) anexos passam a aceitar entidade 'Multa' (PDF da notificacao de autuacao/penalidade e fotos);
// (2) a multa guarda os dados do auto que a notificacao traz e que o Senatran usa como chave
//     (codigo do orgao + AIT + codigo da infracao), mais RENAINF e local da infracao.
// SQLite nao altera CHECK: recria a tabela anexos (mesma tecnica da 028), por isso desligarChavesEstrangeiras.
module.exports.desligarChavesEstrangeiras = true;

module.exports.up = function up(db) {
  const colunasMultas = db.prepare('PRAGMA table_info(multas)').all().map((c) => c.name);
  for (const [coluna, tipo] of [['codigo_orgao', 'TEXT'], ['codigo_infracao', 'TEXT'], ['renainf', 'TEXT'], ['local_infracao', 'TEXT']]) {
    if (!colunasMultas.includes(coluna)) db.exec(`ALTER TABLE multas ADD COLUMN ${coluna} ${tipo}`);
  }

  const atual = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'anexos'").get();
  if (!atual) throw new Error('Tabela anexos nao encontrada - schema inesperado.');
  if (/'Multa'/.test(atual.sql)) return;

  const checkNovo = /CHECK\s*\(entidade_tipo IN \(([^)]*)\)\)/i;
  if (!checkNovo.test(atual.sql)) throw new Error('Nao foi possivel localizar o CHECK de anexos.entidade_tipo - schema mudou?');
  const nomeTemp = 'anexos__novo_039';
  const sqlNovo = atual.sql
    .replace(/CREATE TABLE\s+"?anexos"?/i, `CREATE TABLE ${nomeTemp}`)
    .replace(checkNovo, (_, lista) => `CHECK (entidade_tipo IN (${lista}, 'Multa'))`);

  const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'anexos' AND sql IS NOT NULL").all();
  const colunas = db.prepare('PRAGMA table_info(anexos)').all().map((c) => `"${c.name}"`).join(', ');
  db.exec(sqlNovo);
  db.exec(`INSERT INTO ${nomeTemp} (${colunas}) SELECT ${colunas} FROM anexos`);
  db.exec('DROP TABLE anexos');
  db.exec(`ALTER TABLE ${nomeTemp} RENAME TO anexos`);
  for (const idx of indices) db.exec(idx.sql);
};
