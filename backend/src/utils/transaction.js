// node:sqlite (DatabaseSync) nao tem um helper .transaction() como o better-sqlite3.
// Isto envolve BEGIN/COMMIT/ROLLBACK manualmente para operacoes multi-statement atomicas.
function withTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { withTransaction };
