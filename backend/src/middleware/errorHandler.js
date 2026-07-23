const ApiError = require('../utils/ApiError');

module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.status).json({ erro: err.message });
  }

  // node:sqlite sempre reporta err.code = 'ERR_SQLITE_ERROR' (o codigo real do
  // SQLite fica em err.message/err.errcode) - checar 'SQLITE_CONSTRAINT_*'
  // direto em err.code nunca dava match, entao toda violacao de constraint
  // (FK, UNIQUE, NOT NULL, CHECK) caia no 500 generico abaixo.
  if (err && err.code === 'ERR_SQLITE_ERROR') {
    const msg = String(err.message || '');
    if (msg.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ erro: 'Ja existe um registro com esse valor unico (verifique CPF/CNPJ/placa/etc.).' });
    }
    if (msg.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ erro: 'Nao e possivel concluir: este registro esta sendo usado em outro lugar do sistema (viagens, despesas, lancamentos etc. vinculados a ele).' });
    }
    if (msg.includes('NOT NULL constraint failed')) {
      return res.status(400).json({ erro: 'Campo obrigatorio ausente.' });
    }
    if (msg.includes('CHECK constraint failed')) {
      return res.status(400).json({ erro: 'Valor nao permitido para este campo.' });
    }
    return res.status(400).json({ erro: 'Operacao violaria uma regra de integridade do banco.' });
  }

  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
};
