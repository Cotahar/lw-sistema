const path = require('node:path');
const fs = require('node:fs');
const db = require('../config/db');

// Mesma pasta usada por routes/anexos.routes.js (UPLOAD_DIR/anexos).
const PASTA_ANEXOS = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'), 'anexos');

// Apaga os anexos (linha + arquivo em disco) de registros que estao sendo excluidos, para nao deixar arquivo orfao.
function removerAnexosDaEntidade(entidadeTipo, ids) {
  for (const id of ids) {
    const anexos = db.prepare('SELECT id, nome_arquivo FROM anexos WHERE entidade_tipo = ? AND entidade_id = ?').all(entidadeTipo, id);
    for (const a of anexos) {
      db.prepare('DELETE FROM anexos WHERE id = ?').run(a.id);
      fs.unlink(path.join(PASTA_ANEXOS, path.basename(a.nome_arquivo)), () => {});
    }
  }
}

module.exports = { removerAnexosDaEntidade, PASTA_ANEXOS };
