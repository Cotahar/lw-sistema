const db = require('../config/db');

const stmt = db.prepare(`
  INSERT INTO logs_auditoria (usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Registra quem alterou o que. "antes"/"depois" sao objetos (ou null) serializados em JSON.
function registrarAuditoria({ usuarioId, tabela, registroId, acao, antes = null, depois = null }) {
  stmt.run(
    usuarioId ?? null,
    tabela,
    registroId,
    acao,
    antes ? JSON.stringify(antes) : null,
    depois ? JSON.stringify(depois) : null
  );
}

module.exports = { registrarAuditoria };
