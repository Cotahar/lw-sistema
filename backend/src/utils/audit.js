const db = require('../config/db');

const stmt = db.prepare(`
  INSERT INTO logs_auditoria (empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Registra quem alterou o que. "antes"/"depois" sao objetos (ou null) serializados em JSON.
// empresaId vem de req.empresaId no chamador; aceita null (fica de fora do
// filtro por empresa da tela de Auditoria) para nao quebrar chamadores ainda
// nao retrofitados durante a migracao incremental para multi-empresa.
function registrarAuditoria({ usuarioId, empresaId = null, tabela, registroId, acao, antes = null, depois = null }) {
  stmt.run(
    empresaId,
    usuarioId ?? null,
    tabela,
    registroId,
    acao,
    antes ? JSON.stringify(antes) : null,
    depois ? JSON.stringify(depois) : null
  );
}

module.exports = { registrarAuditoria };
